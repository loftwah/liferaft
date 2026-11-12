use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use fs2::FileExt;
use rune::Waker;
use serde::Deserialize;
use serde_json::{Value, json};

const MAX_REPLY: u64 = 8 * 1024 * 1024;

pub fn data_path() -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os("LIFERAFT_DATA_DIR").map(PathBuf::from) {
        if path.is_absolute() {
            return Ok(path);
        }
        return Err(io::Error::other(
            "LIFERAFT_DATA_DIR must be an absolute path.",
        ));
    }
    let home =
        std::env::home_dir().ok_or_else(|| io::Error::other("Your home folder is unavailable."))?;
    let base = if cfg!(target_os = "macos") {
        home.join("Library/Application Support")
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| io::Error::other("APPDATA is unavailable."))?
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| home.join(".config"))
    };
    Ok(base.join("liferaft"))
}

pub fn command(mode: &str, data: &Path) -> io::Result<Command> {
    let exe = std::env::current_exe()?;
    let packaged = exe
        .parent()
        .and_then(Path::parent)
        .map(|parent| parent.join("Resources/engine"));
    let (node, entry) = match packaged.filter(|folder| folder.is_dir()) {
        Some(folder) => (folder.join("node"), folder.join("engine.mjs")),
        None if cfg!(debug_assertions) => (
            PathBuf::from("node"),
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../out/native/engine.mjs"),
        ),
        None => {
            return Err(io::Error::other(
                "The Liferaft bundle is missing its recovery engine.",
            ));
        }
    };
    let mut command = Command::new(node);
    command
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .arg(entry)
        .arg(mode)
        .arg(data);
    Ok(command)
}

fn lock(data: &Path) -> io::Result<File> {
    fs::create_dir_all(data)?;
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(data.join("native-desktop.lock"))?;
    FileExt::try_lock_exclusive(&file).map_err(|error| {
        if error.kind() == io::ErrorKind::WouldBlock {
            io::Error::other("Liferaft is already open for this catalogue.")
        } else {
            error
        }
    })?;
    Ok(file)
}

#[derive(Deserialize)]
struct Frame {
    id: u64,
    #[serde(default)]
    result: Value,
    error: Option<String>,
}

pub struct Engine {
    send: Option<SyncSender<Value>>,
    receive: Receiver<Result<Value, String>>,
    worker: Option<JoinHandle<()>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
}

impl Engine {
    pub fn start(waker: Waker) -> io::Result<Self> {
        let data = data_path()?;
        fs::create_dir_all(&data)?;
        let data = fs::canonicalize(data)?;
        let exclusive = lock(&data)?;
        let mut command = command("--desktop", &data)?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            use std::os::unix::process::CommandExt;
            let lock_fd = exclusive.as_raw_fd();
            // Inherit only this lock descriptor so a GUI crash cannot let a
            // second writer start while the old engine drains its work.
            unsafe {
                command.pre_exec(move || {
                    if libc::fcntl(lock_fd, libc::F_SETFD, 0) == -1 {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        let stdin = Arc::new(Mutex::new(child.stdin.take()));
        let input = stdin.clone();
        let stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
        let (send, requests) = mpsc::sync_channel(1);
        let (answers, receive) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            let _exclusive = exclusive;
            exchange(&input, stdout, requests, answers, &waker);
            input.lock().expect("engine input lock").take();
            let _ = child.wait();
            waker();
        });
        Ok(Self {
            send: Some(send),
            receive,
            worker: Some(worker),
            stdin,
        })
    }

    pub fn request(&self, input: Value) -> bool {
        self.send
            .as_ref()
            .is_some_and(|tx| tx.try_send(input).is_ok())
    }

    pub fn result(&self) -> Result<Option<Result<Value, String>>, TryRecvError> {
        match self.receive.try_recv() {
            Ok(value) => Ok(Some(value)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.send.take();
        self.stdin.lock().expect("engine input lock").take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn exchange(
    input: &Mutex<Option<ChildStdin>>,
    mut stdout: impl BufRead,
    requests: Receiver<Value>,
    answers: SyncSender<Result<Value, String>>,
    waker: &Waker,
) {
    for (offset, request) in requests.into_iter().enumerate() {
        let result = (|| {
            let id = offset as u64 + 1;
            {
                let mut input = input.lock().expect("engine input lock");
                let stdin = input
                    .as_mut()
                    .ok_or_else(|| io::Error::other("Liferaft is closing."))?;
                serde_json::to_writer(&mut *stdin, &json!({"id": id, "request": request}))?;
                stdin.write_all(b"\n")?;
                stdin.flush()?;
            }
            let mut line = Vec::new();
            let size =
                std::io::Read::take(&mut stdout, MAX_REPLY + 1).read_until(b'\n', &mut line)?;
            if size == 0 || size as u64 > MAX_REPLY + 1 || line.last() != Some(&b'\n') {
                return Err(io::Error::other(
                    "The recovery engine returned an incomplete response.",
                ));
            }
            let response: Frame = serde_json::from_slice(&line)?;
            if response.id != id {
                return Err(io::Error::other(
                    "The recovery engine returned an unexpected response.",
                ));
            }
            Ok(response.error.map_or_else(|| Ok(response.result), Err))
        })();
        let (answer, stopped) = match result {
            Ok(answer) => (answer, false),
            Err(error) => (Err(error.to_string()), true),
        };
        if answers.try_send(answer).is_err() {
            break;
        }
        waker();
        if stopped {
            break;
        }
    }
}
