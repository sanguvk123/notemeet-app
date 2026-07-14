use crate::Note;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

fn to_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
}

fn parse_json(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn parse_map(s: &str) -> HashMap<String, String> {
    serde_json::from_str(s).unwrap_or_default()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub date: String,
    pub time: String,
    pub notes: String,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = PathBuf::from(&home).join("NoteMeet");
        Self::new_at(&dir)
    }

    pub fn new_at(dir: &PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("DB dir: {}", e))?;

        let path = dir.join("notemeet.db");
        eprintln!("[NoteMeet] DB path: {}", path.display());

        let conn = Connection::open(&path).map_err(|e| format!("DB open: {}", e))?;

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap_or(0);

        if version < 1 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS notes (
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
                );
                CREATE TABLE IF NOT EXISTS calendar_events (
                    id     TEXT PRIMARY KEY,
                    title  TEXT NOT NULL,
                    date   TEXT NOT NULL,
                    time   TEXT NOT NULL DEFAULT '',
                    notes  TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date, time);
                PRAGMA user_version = 1;",
            )
            .map_err(|e| format!("DB init: {}", e))?;
            eprintln!("[NoteMeet] DB migrated to version 1");
        }

        if version < 2 {
            let _ = conn.execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                    id UNINDEXED, title, short_summary, full_summary, transcript, action_items_text,
                    content='notes', content_rowid='rowid'
                );
                INSERT INTO notes_fts(rowid, id, title, short_summary, full_summary, transcript, action_items_text)
                SELECT rowid, id, title, short_summary, full_summary, transcript, action_items FROM notes;
                PRAGMA user_version = 2;"
            );
            eprintln!("[NoteMeet] DB migrated to version 2 (FTS5)");
        }

        eprintln!("[NoteMeet] DB initialized");
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn save_note(&self, note: &Note) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;

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

        let rowid = conn.last_insert_rowid();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO notes_fts(rowid, id, title, short_summary, full_summary, transcript, action_items_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                rowid,
                note.id,
                note.title,
                note.short_summary,
                note.full_summary,
                note.transcript,
                to_json(&note.action_items),
            ],
        );

        Ok(())
    }

    pub fn search_notes(&self, query: &str, limit: usize) -> Result<Vec<Note>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        let fts_query = query.split_whitespace().map(|w| format!("\"{}\"", w)).collect::<Vec<_>>().join(" OR ");
        let mut stmt = conn
            .prepare(&format!(
                "SELECT n.id, n.title, n.date, n.short_summary, n.full_summary, n.action_items, n.promises, n.speakers, n.tone, n.speaker_tone, n.transcript, n.meeting_type, n.audio_file, n.audio_duration_s
                 FROM notes n JOIN notes_fts f ON n.id = f.id
                 WHERE notes_fts MATCH ?1
                 ORDER BY rank
                 LIMIT ?2"
            ))
            .map_err(|e| format!("DB search prepare: {}", e))?;

        let notes = stmt
            .query_map(rusqlite::params![fts_query, limit as i64], |row| {
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
            .map_err(|e| format!("DB search query: {}", e))?;

        let mut result = Vec::new();
        for note in notes {
            result.push(note.map_err(|e| format!("DB search row: {}", e))?);
        }
        Ok(result)
    }

    pub fn load_notes(&self) -> Result<Vec<Note>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, date, short_summary, full_summary, action_items, promises, speakers, tone, speaker_tone, transcript, meeting_type, audio_file, audio_duration_s
                 FROM notes ORDER BY created_at DESC",
            )
            .map_err(|e| format!("DB prepare: {}", e))?;

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

    pub fn load_notes_by_ids(&self, ids: &[String]) -> Result<Vec<Note>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT id, title, date, short_summary, full_summary, action_items, promises, speakers, tone, speaker_tone, transcript, meeting_type, audio_file, audio_duration_s
             FROM notes WHERE id IN ({}) ORDER BY created_at DESC",
            placeholders.join(",")
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("DB prepare: {}", e))?;
        let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
        let notes = stmt
            .query_map(params.as_slice(), |row| {
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

    pub fn add_event(&self, event: &CalendarEvent) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        conn.execute(
            "INSERT INTO calendar_events (id, title, date, time, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![event.id, event.title, event.date, event.time, event.notes],
        )
        .map_err(|e| format!("DB event insert: {}", e))?;
        Ok(())
    }

    pub fn load_events(&self) -> Result<Vec<CalendarEvent>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        let mut stmt = conn
            .prepare("SELECT id, title, date, time, notes FROM calendar_events ORDER BY date ASC, time ASC")
            .map_err(|e| format!("DB prepare events: {}", e))?;

        let events = stmt
            .query_map([], |row| {
                Ok(CalendarEvent {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    date: row.get(2)?,
                    time: row.get(3)?,
                    notes: row.get(4)?,
                })
            })
            .map_err(|e| format!("DB events query: {}", e))?;

        let mut result = Vec::new();
        for event in events {
            result.push(event.map_err(|e| format!("DB event row: {}", e))?);
        }
        Ok(result)
    }

    pub fn update_note(&self, note: &Note) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;

        let speaker_tone_json =
            serde_json::to_string(&note.speaker_tone).unwrap_or_else(|_| "{}".to_string());

        conn.execute(
            "UPDATE notes SET title=?1, short_summary=?2, full_summary=?3, action_items=?4, promises=?5, speakers=?6, tone=?7, speaker_tone=?8, transcript=?9, meeting_type=?10, audio_file=?11, audio_duration_s=?12 WHERE id=?13",
            rusqlite::params![
                note.title,
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
                note.id,
            ],
        )
        .map_err(|e| format!("DB update note: {}", e))?;

        let rowid: i64 = conn.query_row(
            "SELECT rowid FROM notes WHERE id=?1", rusqlite::params![note.id],
            |row| row.get(0),
        ).unwrap_or(0);
        let _ = conn.execute(
            "UPDATE notes_fts SET id=?2, title=?3, short_summary=?4, full_summary=?5, transcript=?6, action_items_text=?7 WHERE rowid=?1",
            rusqlite::params![
                rowid,
                note.id,
                note.title,
                note.short_summary,
                note.full_summary,
                note.transcript,
                to_json(&note.action_items),
            ],
        );

        Ok(())
    }

    pub fn delete_note(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        let rowid: i64 = conn.query_row(
            "SELECT rowid FROM notes WHERE id=?1", rusqlite::params![id],
            |row| row.get(0),
        ).unwrap_or(0);
        conn.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| format!("DB delete note: {}", e))?;
        let _ = conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", rusqlite::params![rowid]);
        Ok(())
    }

    pub fn delete_event(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
        conn.execute("DELETE FROM calendar_events WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| format!("DB event delete: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_note(id: &str, title: &str) -> Note {
        let mut speaker_tone = std::collections::HashMap::new();
        speaker_tone.insert("Alice".to_string(), "confident".to_string());

        Note {
            id: id.to_string(),
            title: title.to_string(),
            date: "2026-01-15T10:00:00Z".to_string(),
            short_summary: "Quick sync on roadmap.".to_string(),
            full_summary: "Discussed Q1 priorities. Alice will handle the API. Bob will work on the frontend.".to_string(),
            action_items: vec!["Alice: Ship API by Friday".into(), "Bob: UI mockups by Monday".into()],
            promises: vec!["Alice will send the spec".into()],
            speakers: vec!["Alice".into(), "Bob".into()],
            tone: "professional".to_string(),
            speaker_tone,
            transcript: "Hello everyone. Let's talk about the roadmap.".to_string(),
            meeting_type: "meeting".to_string(),
            audio_file: "/tmp/test.wav".to_string(),
            audio_duration_s: 120.5,
        }
    }

    fn make_test_db() -> (Database, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let db = Database::new_at(&tmp.path().to_path_buf()).expect("Failed to create test DB");
        (db, tmp)
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let (db, _tmp) = make_test_db();
        let note = make_test_note("test-1", "Sprint Planning");

        db.save_note(&note).expect("Failed to save note");
        let loaded = db.load_notes().expect("Failed to load notes");

        assert_eq!(loaded.len(), 1);
        let n = &loaded[0];
        assert_eq!(n.id, "test-1");
        assert_eq!(n.title, "Sprint Planning");
        assert_eq!(n.short_summary, "Quick sync on roadmap.");
        assert_eq!(n.action_items.len(), 2);
        assert_eq!(n.action_items[0], "Alice: Ship API by Friday");
        assert_eq!(n.promises.len(), 1);
        assert_eq!(n.speakers, vec!["Alice", "Bob"]);
        assert_eq!(n.tone, "professional");
        assert_eq!(n.speaker_tone.get("Alice"), Some(&"confident".to_string()));
        assert_eq!(n.meeting_type, "meeting");
        assert!((n.audio_duration_s - 120.5).abs() < 0.001);
        assert_eq!(n.audio_file, "/tmp/test.wav");
    }

    #[test]
    fn test_load_empty_db() {
        let (db, _tmp) = make_test_db();
        let loaded = db.load_notes().expect("Failed to load");
        assert!(loaded.is_empty());
    }

    #[test]
    fn test_save_multiple_notes() {
        let (db, _tmp) = make_test_db();
        let n1 = make_test_note("note-1", "Meeting A");
        let n2 = make_test_note("note-2", "Meeting B");
        let n3 = make_test_note("note-3", "Meeting C");

        db.save_note(&n1).unwrap();
        db.save_note(&n2).unwrap();
        db.save_note(&n3).unwrap();

        let loaded = db.load_notes().unwrap();
        assert_eq!(loaded.len(), 3);
    }

    #[test]
    fn test_replace_existing_note() {
        let (db, _tmp) = make_test_db();
        let mut note = make_test_note("replace-1", "Original Title");
        db.save_note(&note).unwrap();

        note.title = "Updated Title".to_string();
        db.save_note(&note).unwrap();

        let loaded = db.load_notes().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "Updated Title");
    }

    #[test]
    fn test_save_note_with_empty_fields() {
        let (db, _tmp) = make_test_db();
        let note = Note {
            id: "empty-1".to_string(),
            title: "".to_string(),
            date: "2026-01-15T10:00:00Z".to_string(),
            short_summary: "".to_string(),
            full_summary: "".to_string(),
            action_items: vec![],
            promises: vec![],
            speakers: vec![],
            tone: "".to_string(),
            speaker_tone: std::collections::HashMap::new(),
            transcript: "".to_string(),
            meeting_type: "other".to_string(),
            audio_file: "".to_string(),
            audio_duration_s: 0.0,
        };

        db.save_note(&note).unwrap();
        let loaded = db.load_notes().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "");
        assert!(loaded[0].action_items.is_empty());
        assert!(loaded[0].speaker_tone.is_empty());
    }

    #[test]
    fn test_save_note_with_special_characters() {
        let (db, _tmp) = make_test_db();
        let note = Note {
            id: "special-1".to_string(),
            title: "Meeting with O'Brien & Co.".to_string(),
            date: "2026-01-15T10:00:00Z".to_string(),
            short_summary: "Discussed 100% of items. Cost: ₹500.".to_string(),
            full_summary: "We talked about \"quotes\" and 'apostrophes'.".to_string(),
            action_items: vec!["Fix bug #42".into()],
            promises: vec![],
            speakers: vec![],
            tone: "casual".to_string(),
            speaker_tone: std::collections::HashMap::new(),
            transcript: "".to_string(),
            meeting_type: "meeting".to_string(),
            audio_file: "".to_string(),
            audio_duration_s: 0.0,
        };

        db.save_note(&note).unwrap();
        let loaded = db.load_notes().unwrap();
        assert_eq!(loaded[0].title, "Meeting with O'Brien & Co.");
        assert_eq!(loaded[0].short_summary, "Discussed 100% of items. Cost: ₹500.");
    }
}
