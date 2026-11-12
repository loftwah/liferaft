use rune::tok::{TextStyle, type_};
use rune::{
    Color, Cx, El, GrowthSpec, LiveRegion, ScrollSpec, TextEdit, Tx, col, el, row, text, text_input,
};
use serde_json::json;

use crate::{Archive, Pending, Preview, State, basename};

fn colour(hex: &str) -> Color {
    rune::color::hex(hex).expect("valid palette colour")
}
fn navy() -> Color {
    colour("#23394a")
}
fn muted() -> Color {
    colour("#4e626c")
}
fn paper() -> Color {
    colour("#faf7ef")
}
fn light() -> Color {
    colour("#fffdf7")
}
fn line() -> Color {
    colour("#d9d8cc")
}
fn blue() -> Color {
    colour("#deebed")
}
fn accent() -> Color {
    colour("#28546a")
}

fn label(value: impl Into<String>) -> El {
    text(value).font(type_::LABEL).color(muted())
}

fn body(value: impl Into<String>) -> El {
    text(value)
        .font(TextStyle::new(14.0, 400.0).lh(22.0))
        .color(navy())
        .wrap_anywhere()
}

fn title(value: impl Into<String>, size: f32) -> El {
    text(value).font(TextStyle::new(size, 650.0)).color(navy())
}

fn heading(value: impl Into<String>, size: f32, level: u32) -> El {
    title(value, size)
        .wrap_anywhere()
        .role("heading")
        .level(level)
}

fn separator() -> El {
    el().h(1.0).w_full().fill(line())
}
fn divider() -> El {
    el().w(1.0).h_full().fill(line())
}

fn button(
    key: impl Into<String>,
    caption: &str,
    active: bool,
    primary: bool,
    action: impl Fn(&mut State, &mut Tx) + 'static,
) -> El {
    let background = if primary { accent() } else { light() };
    let foreground = if primary { Color::WHITE } else { navy() };
    let mut control = row()
        .key(key.into())
        .h(32.0)
        .px(10.0)
        .center()
        .radius(5.0)
        .role("button")
        .label(caption)
        .focusable(true)
        .disabled(!active)
        .fill(if active {
            background
        } else {
            colour("#efeee6")
        })
        .border(1.0, if primary && active { accent() } else { line() })
        .focus_ring(2.0, 2.0, accent())
        .child(
            text(caption)
                .font(type_::LABEL)
                .color(if active { foreground } else { muted() }),
        );
    if active {
        control = control
            .hover(if primary { navy() } else { blue() })
            .on_press_tx(action);
    }
    control
}

fn check(
    key: impl Into<String>,
    caption: &str,
    checked: bool,
    active: bool,
    action: impl Fn(&mut State, &mut Tx) + 'static,
) -> El {
    let mut control = row()
        .key(key.into())
        .min_h(30.0)
        .gap(8.0)
        .center_y()
        .role("checkbox")
        .label(caption)
        .checked(checked)
        .focusable(true)
        .disabled(!active)
        .focus_ring(2.0, 2.0, accent())
        .child(
            el().size(15.0, 15.0)
                .radius(3.0)
                .border(1.0, accent())
                .fill(if checked { accent() } else { light() }),
        )
        .child(body(caption));
    if active {
        control = control.on_press_tx(action);
    }
    control
}

fn field(
    key: &'static str,
    caption: &str,
    placeholder: &str,
    edit: &TextEdit,
    bind: fn(&mut State) -> &mut TextEdit,
) -> El {
    row()
        .grow(1.0)
        .min_w(0.0)
        .h(34.0)
        .center_y()
        .radius(5.0)
        .px(10.0)
        .fill(light())
        .border(1.0, line())
        .child(
            text_input(edit, type_::BODY)
                .key(key)
                .label(caption)
                .single_line()
                .grow(1.0)
                .min_w(0.0)
                .color(navy())
                .placeholder(placeholder, muted())
                .on_edit(bind)
                .on_submit(State::search),
        )
}

fn scroll(key: &str, content: El) -> El {
    col()
        .key(key.to_owned())
        .grow(1.0)
        .min_h(0.0)
        .w_full()
        .scroll(ScrollSpec {
            stick_bottom: false,
        })
        .child(content)
}

fn archive_row(
    id: Option<String>,
    caption: &str,
    detail: String,
    selected: bool,
    active: bool,
) -> El {
    let key = id.as_deref().unwrap_or("all");
    let mut item = col()
        .key(format!("archive-{key}"))
        .w_full()
        .px(10.0)
        .py(8.0)
        .gap(3.0)
        .fill(if selected { blue() } else { paper() })
        .radius(4.0)
        .role("button")
        .label(format!("{caption}, {detail}"))
        .focusable(true)
        .focus_ring(2.0, 1.0, accent())
        .child(title(caption, 13.0).truncate())
        .child(label(detail).wrap_anywhere());
    if active {
        item = item
            .hover(blue())
            .on_press_tx(move |s: &mut State, tx| s.choose_archive(id.clone(), tx));
    }
    item
}

fn count(value: u64, singular: &str, plural: &str) -> String {
    format!("{value} {}", if value == 1 { singular } else { plural })
}

fn archive_detail(a: &Archive) -> String {
    if a.needs_reindex {
        return "Reindex required".into();
    }
    match a.status.as_str() {
        "indexing" => a.progress.as_ref().map_or_else(
            || "Starting index…".into(),
            |p| {
                let percent = p
                    .bytes_processed
                    .saturating_mul(100)
                    .checked_div(p.total_bytes)
                    .unwrap_or(0);
                format!(
                    "Indexing · {}% · {} messages",
                    percent.min(100),
                    p.messages_processed
                )
            },
        ),
        "ready" => format!(
            "{} · {}",
            count(a.message_count, "message", "messages"),
            count(a.attachment_count, "attachment", "attachments")
        ),
        _ => "Indexing failed".into(),
    }
}

fn archives(s: &State) -> El {
    let busy_index = s.archives.iter().any(|a| a.status == "indexing");
    let mut list = col().w_full().padding(9.0).gap(3.0).child(archive_row(
        None,
        "All archives",
        format!("{} in this catalogue", s.archives.len()),
        s.archive.is_none(),
        s.ready(),
    ));
    for a in &s.archives {
        list = list.child(archive_row(
            Some(a.id.clone()),
            &a.name,
            archive_detail(a),
            s.archive.as_ref() == Some(&a.id),
            s.ready(),
        ));
    }
    let mut section = col()
        .w(224.0)
        .h_full()
        .fill(paper())
        .child(
            row()
                .h(48.0)
                .px(18.0)
                .center_y()
                .child(heading("Archives", 14.0, 2)),
        )
        .child(separator())
        .child(scroll("archive-scroll", list));
    if let Some(a) = s
        .archives
        .iter()
        .find(|a| Some(&a.id) == s.archive.as_ref())
    {
        let mut details = col()
            .padding(12.0)
            .gap(6.0)
            .child(label(format!("Local index · {}", size(a.index_size_bytes))));
        if let Some(error) = &a.last_error {
            details = details.child(body(error));
        }
        if a.status == "indexing" {
            details = details.child(label("The source is open read-only."));
        } else if s.remove_confirm {
            details = details
                .child(body(
                    "Remove the local index? The source archive stays in place.",
                ))
                .child(button(
                    "confirm-remove",
                    "Remove local index",
                    s.ready(),
                    false,
                    |s, _| s.archive_action("remove"),
                ))
                .child(button(
                    "cancel-remove",
                    "Keep index",
                    true,
                    false,
                    |s, tx| {
                        s.remove_confirm = false;
                        tx.focus("remove", true);
                    },
                ));
        } else {
            details = details
                .child(button(
                    "reindex",
                    "Reindex archive",
                    s.ready() && !busy_index,
                    false,
                    |s, _| s.archive_action("reindex"),
                ))
                .child(button(
                    "remove",
                    "Remove local index",
                    s.ready(),
                    false,
                    |s, tx| {
                        s.remove_confirm = true;
                        tx.focus("cancel-remove", true);
                    },
                ));
        }
        section = section.child(separator()).child(details);
    }
    section
}

fn results(s: &State) -> El {
    let busy = matches!(s.pending, Some(Pending::Search));
    let hint = if busy {
        "Searching local indexes…".to_owned()
    } else if s.capped {
        "Showing 500 matches · Narrow the search to see more".to_owned()
    } else if s.searched {
        count(s.results.len() as u64, "match", "matches")
    } else {
        "Search by subject, sender or filename".to_owned()
    };
    let mut pane = col()
        .grow(1.0)
        .min_w(300.0)
        .h_full()
        .fill(light())
        .child(
            col()
                .h(48.0)
                .px(14.0)
                .gap(2.0)
                .py(5.0)
                .child(heading("Results", 14.0, 2))
                .child(label(hint).truncate()),
        )
        .child(separator());
    if s.skipped > 0 {
        pane = pane.child(
            col().px(14.0).py(7.0).child(
                label(format!(
                    "{} archive indexes need repair and were skipped.",
                    s.skipped
                ))
                .wrap(),
            ),
        );
    }
    if s.results.is_empty() {
        let message = if busy {
            "Looking for matches…"
        } else if s.searched {
            "No matches. Change the search or clear a filter."
        } else if s.archives.is_empty() {
            "Add an MBOX archive to search its messages and attachments."
        } else {
            "Enter a search or select an archive to browse its messages."
        };
        pane = pane.child(col().padding(16.0).child(body(message)));
    } else {
        pane = pane.child(scroll(
            "result-scroll",
            col()
                .w_full()
                .key("result-rows")
                .growth(GrowthSpec::default())
                .virtual_rows_version(s.result_revision)
                .virtual_rows(
                    s.results.len(),
                    82.0,
                    |s: &State, index| format!("result-{}", s.results[index].result_id).into(),
                    result_row,
                ),
        ));
    }
    pane
}

fn result_row(s: &State, index: usize) -> El {
    let found = &s.results[index];
    let id = found.result_id.clone();
    let selected = s.selected.as_ref() == Some(&id);
    let main = found
        .attachment_filename
        .as_deref()
        .unwrap_or(&found.subject);
    let details = if found.attachment_filename.is_some() {
        found.subject.as_str()
    } else if found.snippet.is_empty() {
        found.from_text.as_str()
    } else {
        found.snippet.as_str()
    };
    let origin = format!(
        "{} · {} · {}",
        found.from_text,
        date(found.date.as_deref()),
        found.archive_name
    );
    col()
        .h(82.0)
        .w_full()
        .fill(if selected { blue() } else { light() })
        .hover(blue())
        .role("button")
        .label(format!("{main}. {origin}"))
        .focusable(true)
        .focus_ring(2.0, -2.0, accent())
        .on_press_tx(move |s: &mut State, tx| s.select(&id, tx))
        .child(
            col()
                .grow(1.0)
                .min_h(0.0)
                .w_full()
                .px(14.0)
                .gap(3.0)
                .py(9.0)
                .child(title(main, 13.0).truncate())
                .child(label(details).truncate())
                .child(label(origin).truncate()),
        )
        .child(separator())
}

fn date(value: Option<&str>) -> &str {
    value.and_then(|s| s.get(..10)).unwrap_or("No date")
}

fn preview(s: &State) -> El {
    let selected = s
        .results
        .iter()
        .find(|r| Some(&r.result_id) == s.selected.as_ref());
    let mut pane = col()
        .grow(1.55)
        .min_w(460.0)
        .h_full()
        .fill(paper())
        .child(
            row()
                .h(48.0)
                .px(18.0)
                .gap(10.0)
                .center_y()
                .child(heading("Message preview", 14.0, 2))
                .child(el().grow(1.0))
                .child(button(
                    "recover-message",
                    "Recover .eml",
                    s.ready() && selected.is_some(),
                    false,
                    |s, tx| {
                        if let Some(subject) = s
                            .results
                            .iter()
                            .find(|r| Some(&r.result_id) == s.selected.as_ref())
                            .map(|r| r.message_filename.clone())
                        {
                            s.recover(None, &subject, "recover-message", tx);
                        }
                    },
                )),
        )
        .child(separator());
    if let Some(message) = &s.preview {
        let mut content = col()
            .w_full()
            .padding(18.0)
            .gap(13.0)
            .selection_group(true)
            .child(heading(&message.subject, 22.0, 3).selectable(true))
            .child(header("From", &message.from_text))
            .child(header("To", &message.to_text));
        if !message.cc_text.is_empty() {
            content = content.child(header("Cc", &message.cc_text));
        }
        content = content
            .child(header("Date", message.date.as_deref().unwrap_or("Unknown")))
            .child(header("Archive", &message.archive_name))
            .child(separator())
            .child(attachment_list(s, message))
            .child(separator())
            .child(heading("Message body", 14.0, 3))
            .child(
                body(if message.text.is_empty() {
                    "This message has no text body."
                } else {
                    &message.text
                })
                .selectable(true),
            );
        if message.truncated {
            content = content.child(
                label("Preview shortened. Recover the original .eml for the full message.").wrap(),
            );
        }
        pane = pane.child(scroll("preview-scroll", content));
    } else {
        let mut content = col().padding(18.0).gap(12.0).child(body(
            if matches!(s.pending, Some(Pending::Preview)) {
                "Reading the original message…"
            } else if selected.is_some() {
                "Preview unavailable. You can still try to recover a copy."
            } else {
                "Select a result to inspect its source and recover a copy."
            },
        ));
        if let Some(found) = selected {
            if let Some(id) = found.attachment_id {
                let name = found
                    .suggested_filename
                    .clone()
                    .unwrap_or_else(|| "attachment".into());
                content = content.child(button(
                    "recover-result",
                    "Recover selected attachment",
                    s.ready(),
                    true,
                    move |s, tx| {
                        s.recover(Some(id), &name, "recover-result", tx);
                    },
                ));
            }
        }
        pane = pane.child(content);
    }
    pane
}

fn header(key: &str, value: &str) -> El {
    row()
        .w_full()
        .gap(10.0)
        .child(label(key).w(52.0))
        .child(body(value).grow(1.0).min_w(0.0).selectable(true))
}

fn size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KiB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MiB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn attachment_list(s: &State, message: &Preview) -> El {
    let mut area = col().w_full().gap(7.0).child(
        row()
            .gap(10.0)
            .center_y()
            .child(heading("Attachments", 14.0, 3))
            .child(el().grow(1.0))
            .child(button(
                "recover-all",
                "Recover all",
                s.ready() && message.attachments.len() > 1,
                false,
                State::recover_all,
            )),
    );
    if message.attachments.is_empty() {
        return area.child(label("No attachments"));
    }
    let active = s
        .results
        .iter()
        .find(|r| Some(&r.result_id) == s.selected.as_ref())
        .and_then(|r| r.attachment_id);
    for a in &message.attachments {
        let id = a.id;
        let name = a.filename.clone().unwrap_or_else(|| "attachment".into());
        let key = format!("recover-{id}");
        let focus = key.clone();
        let suggested = a.suggested_filename.clone();
        area = area.child(
            row()
                .w_full()
                .min_h(51.0)
                .padding(8.0)
                .gap(10.0)
                .center_y()
                .fill(if active == Some(id) { blue() } else { light() })
                .radius(4.0)
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
                        .gap(3.0)
                        .child(title(&name, 13.0).wrap_anywhere().selectable(true))
                        .child(
                            label(format!(
                                "{} · estimated {}",
                                a.content_type
                                    .as_deref()
                                    .and_then(|value| value.split(';').next())
                                    .unwrap_or("File"),
                                size(a.size_estimate)
                            ))
                            .wrap_anywhere(),
                        ),
                )
                .child(
                    button(
                        key,
                        "Recover",
                        s.ready(),
                        active == Some(id),
                        move |s, tx| s.recover(Some(id), &suggested, &focus, tx),
                    )
                    .label(format!("Recover {name}")),
                ),
        );
    }
    if message.attachments.len() == 100 {
        area = area.child(
            label("Showing up to 100 attachments. Recover all to save the full set.").wrap(),
        );
    }
    area
}

fn access_panel(s: &State) -> El {
    let mut panel = col().w_full().gap(13.0).padding(22.0)
        .child(row().center_y().gap(12.0)
            .child(heading("Agent access", 24.0, 2))
            .child(el().grow(1.0))
            .child(button("close-access", "Back to recovery", !s.chooser, false, State::close_access)))
        .child(body(if s.access.enabled { "Agent access is on." } else { "Agent access is off." }))
        .child(body("Choose the indexed archives and one recovery folder your local agent can use. Your agent may send returned mail details to its model provider."));
    if let Some(error) = &s.access.error {
        panel = panel.child(body(error));
    }
    if s.archives
        .iter()
        .all(|a| a.status != "ready" || a.needs_reindex)
    {
        panel = panel.child(body(
            "Index an archive to make it available for agent access.",
        ));
    }
    for a in s
        .archives
        .iter()
        .filter(|a| a.status == "ready" && !a.needs_reindex)
    {
        let id = a.id.clone();
        panel = panel.child(check(
            format!("grant-{id}"),
            &a.name,
            s.grant_ids.contains(&id),
            s.ready(),
            move |s, _| {
                if !s.grant_ids.remove(&id) {
                    if s.grant_ids.len() < 32 {
                        s.grant_ids.insert(id.clone());
                    } else {
                        s.error = "Choose at most 32 archives.".into();
                    }
                }
            },
        ));
    }
    for folder in &s.access.export_directories {
        panel = panel
            .child(body(format!("Approved recovery folder: {}", folder.path)).selectable(true));
    }
    panel = panel
        .child(check(
            "sharing",
            "I understand that my agent may share returned mail with its provider.",
            s.acknowledge,
            s.ready(),
            |s, _| s.acknowledge = !s.acknowledge,
        ))
        .child(
            row()
                .gap(8.0)
                .child(button(
                    "grant",
                    "Choose folder and enable access",
                    s.ready() && s.acknowledge && !s.grant_ids.is_empty(),
                    true,
                    State::grant,
                ))
                .child(button(
                    "revoke",
                    "Revoke access",
                    s.ready() && (s.access.enabled || s.access.error.is_some()),
                    false,
                    |s, _| s.request(Pending::Access, json!({"op":"revoke"})),
                )),
        );
    if s.access.enabled {
        if let Ok(exe) = std::env::current_exe() {
            let path = exe.to_string_lossy();
            let codex = format!(
                "[mcp_servers.liferaft]\ncommand = {}\nargs = [\"--mcp\"]",
                json!(path)
            );
            let opencode = serde_json::to_string_pretty(&json!({"mcp":{"servers":{"liferaft":{"type":"local","command":[path,"--mcp"],"codemode":false}}}})).unwrap_or_default();
            for (key, name, config) in [
                ("codex", "Codex", codex),
                ("opencode", "OpenCode", opencode),
            ] {
                panel = panel
                    .child(separator())
                    .child(
                        row()
                            .center_y()
                            .child(heading(format!("{name} configuration"), 14.0, 3))
                            .child(el().grow(1.0))
                            .child(button(
                                format!("copy-{key}"),
                                "Copy configuration",
                                true,
                                false,
                                {
                                    let config = config.clone();
                                    move |_, tx| tx.copy(&config)
                                },
                            )),
                    )
                    .child(body(config).selectable(true));
            }
        }
    }
    scroll("agent-scroll", panel)
}

pub fn view(s: &State, _: &mut Cx<State>) -> El {
    let icon = el().size(30.0, 30.0).a11y_hidden();
    let icon = if let Some(image) = &s.icon {
        icon.pixels(image.pixels())
    } else {
        icon
    };
    let import = if let Some(archive) = s.archives.iter().find(|a| a.status == "indexing") {
        let id = archive.id.clone();
        button(
            "cancel-import",
            "Cancel indexing",
            s.ready() && !s.access_open,
            false,
            move |s, _| {
                s.notice = "Stopping the local index…".into();
                s.request(Pending::Change, json!({"op":"cancelImport","archiveId":id}));
            },
        )
    } else {
        button(
            "import",
            "Add archive…",
            s.ready() && !s.access_open,
            true,
            State::import,
        )
    };
    let mut root = col()
        .key("liferaft")
        .w_full()
        .h_full()
        .fill(paper())
        .child(
            row()
                .h(56.0)
                .w_full()
                .px(16.0)
                .gap(9.0)
                .center_y()
                .fill(light())
                .child(icon)
                .child(heading("Liferaft", 19.0, 1))
                .child(el().grow(1.0))
                .child(label("Local MBOX recovery"))
                .child(button(
                    "agent-access",
                    "Agent access",
                    s.ready() && !s.access_open,
                    false,
                    State::open_access,
                ))
                .child(import),
        )
        .child(separator());

    if s.access_open {
        root = root.child(access_panel(s));
    } else {
        let search_bar = row()
            .h(53.0)
            .w_full()
            .px(12.0)
            .gap(8.0)
            .center_y()
            .child(field(
                "query",
                "Search archives",
                "Search subject, sender, text or filename",
                &s.query,
                |s| &mut s.query,
            ))
            .child(button("search", "Search", s.ready(), true, State::search))
            .child(button(
                "filters",
                if s.filters {
                    "Hide filters"
                } else {
                    "Show filters"
                },
                true,
                false,
                |s, _| s.filters = !s.filters,
            ));
        root = root.child(search_bar).child(separator());
        if s.filters {
            root = root
                .child(
                    row()
                        .h(47.0)
                        .px(12.0)
                        .gap(9.0)
                        .center_y()
                        .child(field(
                            "sender",
                            "Filter by sender",
                            "Sender",
                            &s.sender,
                            |s| &mut s.sender,
                        ))
                        .child(field(
                            "after",
                            "Start date (YYYY-MM-DD)",
                            "From YYYY-MM-DD",
                            &s.after,
                            |s| &mut s.after,
                        ))
                        .child(field(
                            "before",
                            "End date (YYYY-MM-DD)",
                            "To YYYY-MM-DD",
                            &s.before,
                            |s| &mut s.before,
                        ))
                        .child(check(
                            "has-attachments",
                            "Has attachments",
                            s.has_attachments,
                            s.ready(),
                            |s, tx| {
                                s.has_attachments = !s.has_attachments;
                                s.search(tx);
                            },
                        ))
                        .child(check(
                            "prefer-attachments",
                            "Prioritise files",
                            s.prefer_attachments,
                            s.ready(),
                            |s, tx| {
                                s.prefer_attachments = !s.prefer_attachments;
                                s.search(tx);
                            },
                        )),
                )
                .child(separator());
        }
        root = root.child(
            row()
                .grow(1.0)
                .min_h(0.0)
                .w_full()
                .child(archives(s))
                .child(divider())
                .child(results(s))
                .child(divider())
                .child(preview(s)),
        );
    }
    let status = if !s.error.is_empty() {
        s.error.as_str()
    } else if matches!(s.pending, Some(Pending::Recover)) {
        "Recovering a copy…"
    } else if s.notice.is_empty() {
        "Original archives are opened read-only."
    } else {
        s.notice.as_str()
    };
    root.child(separator()).child(
        row()
            .min_h(30.0)
            .py(6.0)
            .px(13.0)
            .center_y()
            .gap(8.0)
            .fill(light())
            .child(
                text(status)
                    .font(type_::LABEL)
                    .color(if s.error.is_empty() {
                        muted()
                    } else {
                        colour("#863d2d")
                    })
                    .wrap_anywhere()
                    .selectable(true)
                    .live_region(LiveRegion::Polite),
            )
            .child(el().grow(1.0))
            .child(
                label(
                    s.archive
                        .as_ref()
                        .and_then(|id| s.archives.iter().find(|a| &a.id == id))
                        .map_or("Liferaft", |a| basename(&a.name)),
                )
                .truncate(),
            ),
    )
}
