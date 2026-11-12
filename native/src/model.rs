use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub id: String,
    pub name: String,
    pub status: String,
    pub message_count: u64,
    pub attachment_count: u64,
    pub index_size_bytes: u64,
    pub last_error: Option<String>,
    pub needs_reindex: bool,
    pub progress: Option<Progress>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub messages_processed: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub result_id: String,
    pub index_revision: String,
    pub archive_id: String,
    pub archive_name: String,
    pub id: u64,
    pub subject: String,
    pub from_text: String,
    pub date: Option<String>,
    pub snippet: String,
    pub attachment_id: Option<u64>,
    pub attachment_filename: Option<String>,
    pub suggested_filename: Option<String>,
    pub message_filename: String,
}

#[derive(Deserialize)]
pub struct Results {
    pub rows: Vec<Match>,
    pub capped: bool,
    pub skipped: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: u64,
    pub index_revision: String,
    pub archive_id: String,
    pub archive_name: String,
    pub subject: String,
    pub from_text: String,
    pub to_text: String,
    pub cc_text: String,
    pub date: Option<String>,
    pub text: String,
    pub truncated: bool,
    pub attachments: Vec<Attachment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: u64,
    pub filename: Option<String>,
    pub suggested_filename: String,
    pub content_type: Option<String>,
    pub size_estimate: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub archive_id: String,
    pub message_id: u64,
    pub index_revision: String,
}

impl From<&Match> for Reference {
    fn from(row: &Match) -> Self {
        Self {
            archive_id: row.archive_id.clone(),
            message_id: row.id,
            index_revision: row.index_revision.clone(),
        }
    }
}

impl From<&Preview> for Reference {
    fn from(message: &Preview) -> Self {
        Self {
            archive_id: message.archive_id.clone(),
            message_id: message.id,
            index_revision: message.index_revision.clone(),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub enabled: bool,
    pub archive_ids: Vec<String>,
    pub export_directories: Vec<Folder>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct Folder {
    pub path: String,
}

#[derive(Deserialize)]
pub struct Receipt {
    pub path: Option<String>,
    pub paths: Option<Vec<String>>,
    pub error: Option<String>,
}
