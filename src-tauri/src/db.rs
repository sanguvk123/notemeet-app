use crate::Note;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = PathBuf::from(&home).join("NoteMeet");
        std::fs::create_dir_all(&dir).map_err(|e| format!("DB dir: {}", e))?;

        let path = dir.join("notemeet.db");
        eprintln!("[NoteMeet] DB path: {}", path.display());

        let conn = Connection::open(&path).map_err(|e| format!("DB open: {}", e))?;

        // Drop old schema and recreate (beta — we'll migrate properly later)
        conn.execute_batch(
            "DROP TABLE IF EXISTS notes;
            CREATE TABLE notes (
                id           TEXT PRIMARY KEY,
                title        TEXT NOT NULL DEFAULT '',
                date         TEXT NOT NULL,
                short_summary TEXT NOT NULL DEFAULT '',
                full_summary TEXT NOT NULL DEFAULT '',
                action_items TEXT NOT NULL DEFAULT '[]',
                promises     TEXT NOT NULL DEFAULT '[]',
                speakers     TEXT NOT NULL DEFAULT '[]',
                tone         TEXT NOT NULL DEFAULT '',
                speaker_tone TEXT NOT NULL DEFAULT '{}',
                transcript   TEXT NOT NULL DEFAULT '',
                meeting_type TEXT NOT NULL DEFAULT 'meeting',
                audio_file   TEXT NOT NULL DEFAULT '',
                audio_duration_s REAL NOT NULL DEFAULT 0.0,
                created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .map_err(|e| format!("DB init: {}", e))?;

        eprintln!("[NoteMeet] DB initialized");
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn save_note(&self, note: &Note) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;

        let to_json = |v: &Vec<String>| -> String {
            serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
        };

        let speaker_tone_json =
            serde_json::to_string(&note.speaker_tone).unwrap_or_else(|_| "{}".to_string());

        conn.execute(
            "INSERT OR REPLACE INTO notes (id, title, date, short_summary, full_summary, action_items, promises, speakers, tone, speaker_tone, transcript, meeting_type, audio_file, audio_duration_s)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                note.id,
                note.title,
                note.date,
                note.short_summary,
                note.full_summary,
                to_json(&note.action_items),
                to_json(&note.promises),
                to_json(&note.speakers),
                note.tone,
                speaker_tone_json,
                note.transcript,
                note.meeting_type,
                note.audio_file,
                note.audio_duration_s,
            ],
        )
        .map_err(|e| format!("DB insert: {}", e))?;

        Ok(())
    }

    pub fn load_notes(&self) -> Result<Vec<Note>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, date, short_summary, full_summary, action_items, promises, speakers, tone, speaker_tone, transcript, meeting_type, audio_file, audio_duration_s
                 FROM notes ORDER BY created_at DESC",
            )
            .map_err(|e| format!("DB prepare: {}", e))?;

        let parse_json = |s: &str| -> Vec<String> {
            serde_json::from_str(s).unwrap_or_default()
        };
        let parse_map = |s: &str| -> std::collections::HashMap<String, String> {
            serde_json::from_str(s).unwrap_or_default()
        };

        let notes = stmt
            .query_map([], |row| {
                Ok(Note {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    date: row.get(2)?,
                    short_summary: row.get(3)?,
                    full_summary: row.get(4)?,
                    action_items: parse_json(&row.get::<_, String>(5)?),
                    promises: parse_json(&row.get::<_, String>(6)?),
                    speakers: parse_json(&row.get::<_, String>(7)?),
                    tone: row.get(8)?,
                    speaker_tone: parse_map(&row.get::<_, String>(9)?),
                    transcript: row.get(10)?,
                    meeting_type: row.get(11)?,
                    audio_file: row.get(12)?,
                    audio_duration_s: row.get(13)?,
                })
            })
            .map_err(|e| format!("DB query: {}", e))?;

        let mut result = Vec::new();
        for note in notes {
            result.push(note.map_err(|e| format!("DB row: {}", e))?);
        }

        Ok(result)
    }
}
