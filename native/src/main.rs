mod engine;
mod model;
mod view;

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use rune::{AppSpec, FileDialogOptions, Key, KeyEvent, TextEdit, Tx, Waker};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use engine::Engine;
use model::{Access, Archive, Match, Preview, Receipt, Reference, Results};

enum Pending {
    Archives,
    Change,
    Search,
    Preview,
    Recover,
    Access,
}

#[derive(Default)]
struct State {
    engine: Option<Engine>,
    icon: Option<rune::Image>,
    pending: Option<Pending>,
    notice: String,
    error: String,
    archives: Vec<Archive>,
    archive: Option<String>,
    results: Vec<Match>,
    result_revision: u64,
    capped: bool,
    skipped: u64,
    searched: bool,
    selected: Option<String>,
    preview: Option<Preview>,
    query: TextEdit,
    sender: TextEdit,
    after: TextEdit,
    before: TextEdit,
    filters: bool,
    prefer_attachments: bool,
    has_attachments: bool,
    access_open: bool,
    access: Access,
    grant_ids: BTreeSet<String>,
    acknowledge: bool,
    remove_confirm: bool,
    refresh: bool,
    next_archive_poll: f64,
    chooser: bool,
    focus_after: Option<String>,
}

impl State {
    fn ready(&self) -> bool {
        self.engine.is_some() && self.pending.is_none() && !self.chooser
    }

    fn request(&mut self, kind: Pending, request: Value) {
        if !self.ready() {
            return;
        }
        if self
            .engine
            .as_ref()
            .is_some_and(|engine| engine.request(request))
        {
            self.error.clear();
            self.pending = Some(kind);
        } else {
            self.error = "The recovery engine stopped. Reopen Liferaft to continue.".into();
        }
    }

    fn list(&mut self) {
        self.request(Pending::Archives, json!({"op":"archives"}));
    }

    fn clear_results(&mut self) {
        self.results.clear();
        self.result_revision += 1;
        self.selected = None;
        self.preview = None;
        self.capped = false;
        self.skipped = 0;
    }

    fn choose_archive(&mut self, id: Option<String>, tx: &mut Tx) {
        if !self.ready() {
            return;
        }
        self.archive = id;
        self.remove_confirm = false;
        self.search(tx);
    }

    fn search(&mut self, tx: &mut Tx) {
        if !self.ready() {
            return;
        }
        self.clear_results();
        self.searched = false;
        tx.scroll_to_instant("result-scroll", 0.0, 0.0);
        let Some(after) = date_filter(&self.after.text) else {
            self.error = "Enter the start date as YYYY-MM-DD.".into();
            return;
        };
        let Some(before) = date_filter(&self.before.text) else {
            self.error = "Enter the end date as YYYY-MM-DD.".into();
            return;
        };
        self.request(
            Pending::Search,
            json!({
                "op":"search",
                "text": limit(&self.query.text, 500),
                "archiveId":self.archive,
                "sender":limit(&self.sender.text, 120),
                "dateFrom":after,
                "dateTo":before,
                "hasAttachments":self.has_attachments,
                "preferAttachments":self.prefer_attachments
            }),
        );
    }

    fn select(&mut self, id: &str, tx: &mut Tx) {
        if !self.ready() {
            return;
        }
        let Some(row) = self.results.iter().find(|row| row.result_id == id) else {
            return;
        };
        let mut input = json!(Reference::from(row));
        input["op"] = json!("preview");
        self.selected = Some(id.into());
        self.preview = None;
        tx.scroll_to_instant("preview-scroll", 0.0, 0.0);
        self.request(Pending::Preview, input);
    }

    fn import(&mut self, tx: &mut Tx) {
        if !self.ready() {
            return;
        }
        self.chooser = true;
        tx.open_file(
            FileDialogOptions {
                title: "Choose an MBOX archive".into(),
                ..Default::default()
            },
            |s: &mut Self, result, _tx| {
                s.focus_after = Some("import".into());
                s.with_path(result, |s, path| {
                    s.notice = "Starting the local index…".into();
                    s.request(Pending::Change, json!({"op":"import","sourcePath":path}));
                });
            },
        );
    }

    fn with_path(&mut self, result: rune::FileDialogResult, action: impl FnOnce(&mut Self, &str)) {
        self.chooser = false;
        match result {
            Ok(Some(path)) => match path.to_str() {
                Some(path) => action(self, path),
                None => self.error = "Choose a path with a valid Unicode name.".into(),
            },
            Ok(None) => {}
            Err(error) => self.error = error.to_string(),
        }
    }

    fn archive_action(&mut self, op: &str) {
        let Some(id) = self.archive.clone() else {
            return;
        };
        if matches!(op, "remove" | "reindex") {
            self.clear_results();
        }
        self.remove_confirm = false;
        self.request(Pending::Change, json!({"op":op,"archiveId":id}));
    }

    fn recover(&mut self, attachment_id: Option<u64>, name: &str, focus: &str, tx: &mut Tx) {
        if !self.ready() {
            return;
        }
        let Some(row) = self
            .results
            .iter()
            .find(|r| Some(&r.result_id) == self.selected.as_ref())
        else {
            return;
        };
        let mut input = json!(Reference::from(row));
        input["op"] = json!("recover");
        input["attachmentId"] = json!(attachment_id);
        let focus = focus.to_owned();
        let name = name.to_owned();
        self.chooser = true;
        tx.save_file(
            FileDialogOptions {
                title: "Save a recovered copy".into(),
                file_name: Some(name),
                ..Default::default()
            },
            move |s: &mut Self, result, _tx| {
                s.focus_after = Some(focus);
                s.with_path(result, |s, path| {
                    let mut input = input.clone();
                    input["destination"] = json!(path);
                    s.request(Pending::Recover, input);
                });
            },
        );
    }

    fn recover_all(&mut self, tx: &mut Tx) {
        if !self.ready() {
            return;
        }
        let Some(message) = self.preview.as_ref() else {
            return;
        };
        let mut input = json!(Reference::from(message));
        input["op"] = json!("recoverAll");
        self.chooser = true;
        tx.open_folder(
            FileDialogOptions {
                title: "Choose the attachment recovery folder".into(),
                ..Default::default()
            },
            move |s: &mut Self, result, _tx| {
                s.focus_after = Some("recover-all".into());
                s.with_path(result, |s, path| {
                    let mut input = input.clone();
                    input["destination"] = json!(path);
                    s.request(Pending::Recover, input);
                });
            },
        );
    }

    fn open_access(&mut self, tx: &mut Tx) {
        if !self.ready() {
            return;
        }
        self.access_open = true;
        self.acknowledge = false;
        self.request(Pending::Access, json!({"op":"access"}));
        tx.focus("close-access", true);
    }

    fn close_access(&mut self, tx: &mut Tx) {
        self.access_open = false;
        tx.focus("agent-access", true);
    }

    fn grant(&mut self, tx: &mut Tx) {
        if !self.ready() || !self.acknowledge || self.grant_ids.is_empty() {
            return;
        }
        let ids = self.grant_ids.clone();
        self.chooser = true;
        tx.open_folder(
            FileDialogOptions {
                title: "Choose the agent recovery folder".into(),
                ..Default::default()
            },
            move |s: &mut Self, result, _tx| {
                s.focus_after = Some("close-access".into());
                s.with_path(result, |s, path| {
                    s.request(Pending::Access,
                    json!({"op":"grant","archiveIds":ids,"destination":path,"acknowledged":true}))
                });
            },
        );
    }

    fn apply(&mut self, kind: Pending, data: Value) -> Result<(), String> {
        match kind {
            Pending::Archives => {
                let was_indexing = self.archives.iter().any(|a| a.status == "indexing");
                self.archives = decode(data)?;
                let indexing = self.archives.iter().any(|a| a.status == "indexing");
                if self
                    .archive
                    .as_ref()
                    .is_some_and(|id| !self.archives.iter().any(|a| &a.id == id))
                {
                    self.archive = None;
                }
                if was_indexing && !indexing {
                    self.notice = "Indexing finished. Review the archive status.".into();
                } else if indexing {
                    self.notice = "Indexing locally. The source archive is open read-only.".into();
                }
            }
            Pending::Change => self.refresh = true,
            Pending::Search => {
                let results: Results = decode(data)?;
                self.results = results.rows;
                self.capped = results.capped;
                self.skipped = results.skipped;
                self.result_revision += 1;
                self.searched = true;
            }
            Pending::Preview => self.preview = Some(decode(data)?),
            Pending::Recover => {
                let receipt: Receipt = decode(data)?;
                let files = receipt.paths.unwrap_or_default();
                if let Some(error) = receipt.error {
                    self.notice = files
                        .first()
                        .map_or_else(String::new, |path| format!("First recovered copy: {path}"));
                    self.error = error;
                } else if let Some(path) = receipt.path {
                    self.notice = format!("Saved a recovered copy to {path}");
                } else {
                    self.notice = format!("Saved {} recovered copies.", files.len());
                }
            }
            Pending::Access => {
                self.access = decode(data)?;
                self.grant_ids = self
                    .access
                    .archive_ids
                    .iter()
                    .filter(|id| {
                        self.archives
                            .iter()
                            .any(|a| a.id == **id && a.status == "ready" && !a.needs_reindex)
                    })
                    .cloned()
                    .collect();
                self.acknowledge = false;
            }
        }
        Ok(())
    }
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("Could not read the recovery engine response. {error}"))
}

fn date_filter(text: &str) -> Option<&str> {
    let text = text.trim();
    let valid = text.len() == 10
        && text.bytes().enumerate().all(|(i, byte)| {
            if i == 4 || i == 7 {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        });
    (text.is_empty() || valid).then_some(text)
}

fn limit(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

fn setup(state: &mut State, waker: Waker) {
    state.icon = Some(
        rune::ImageCache::new(waker.clone()).load(include_bytes!("../assets/icon.png").as_slice()),
    );
    match Engine::start(waker) {
        Ok(engine) => {
            state.engine = Some(engine);
            state.list();
        }
        Err(error) => state.error = format!("Could not start Liferaft. {error}"),
    }
}

fn poll(state: &mut State, clock: f64, tx: &mut Tx) -> bool {
    let mut changed = false;
    if let Some(engine) = &state.engine {
        match engine.result() {
            Ok(Some(response)) => {
                if let Some(kind) = state.pending.take() {
                    if let Err(error) = response.and_then(|data| state.apply(kind, data)) {
                        state.error = error;
                    }
                }
                changed = true;
            }
            Err(_) => {
                state.pending = None;
                state.engine = None;
                if state.error.is_empty() {
                    state.error =
                        "The recovery engine stopped. Reopen Liferaft to continue.".into();
                }
                changed = true;
            }
            Ok(None) => {}
        }
    }
    if state.ready() && !state.refresh {
        if let Some(key) = state.focus_after.take() {
            tx.focus(key, true);
            changed = true;
        }
    }
    if state.ready() && state.refresh {
        state.refresh = false;
        state.list();
        return true;
    }
    if state.archives.iter().any(|a| a.status == "indexing") {
        if clock >= state.next_archive_poll {
            state.next_archive_poll = clock + 0.35;
            if state.ready() {
                state.list();
            }
        }
        tx.wake_after(Duration::from_secs_f64(
            (state.next_archive_poll - clock).max(0.01),
        ));
    }
    changed
}

fn on_key(s: &mut State, event: &KeyEvent, tx: &mut Tx) -> bool {
    if s.access_open {
        if matches!(event.key, Key::Escape) && !s.chooser {
            s.close_access(tx);
            return true;
        }
        return false;
    }
    match event.key {
        Key::Command('f') => tx.focus("query", true),
        Key::Command('o') => s.import(tx),
        Key::Down | Key::Up if tx.focused().is_some_and(|key| key.starts_with("result-")) => {
            if !s.ready() {
                return true;
            }
            let current = s
                .results
                .iter()
                .position(|row| Some(&row.result_id) == s.selected.as_ref());
            let index = match (event.key.clone(), current) {
                (Key::Down, Some(index)) => (index + 1).min(s.results.len().saturating_sub(1)),
                (Key::Up, Some(index)) => index.saturating_sub(1),
                _ => 0,
            };
            if let Some(id) = s.results.get(index).map(|row| row.result_id.clone()) {
                let key = format!("result-{id}");
                tx.scroll_into_view(&key);
                tx.focus(key, true);
                s.select(&id, tx);
            }
        }
        _ => return false,
    }
    true
}

fn mcp() -> std::io::Result<()> {
    let data = engine::data_path()?;
    let mut command = engine::command("--mcp", &data)?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        Err(command.exec())
    }
    #[cfg(not(unix))]
    {
        let code = command.status()?.code().unwrap_or(1);
        std::process::exit(code);
    }
}

fn main() {
    if std::env::args_os().nth(1).is_some_and(|arg| arg == "--mcp") {
        if let Err(error) = mcp() {
            eprintln!("Could not start Liferaft agent access. {error}");
            std::process::exit(1);
        }
        return;
    }
    rune::App::new(AppSpec {
        min_size: Some((1060.0, 670.0)),
        setup: Some(setup),
        poll: Some(poll),
        on_key: Some(on_key),
        ..AppSpec::new("Liferaft", (1320.0, 830.0), State::default, view::view)
    })
    .tab_visits_controls(true)
    .chrome(rune::Chrome {
        full_size_content: false,
        ..rune::Chrome::DEFAULT
    })
    .run();
}

fn basename(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
}
