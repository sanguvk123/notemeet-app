mod audio;
mod db;
mod whisper;
mod llm;
mod google;
mod detector;

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    CustomMenuItem, Manager, State, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
};

macro_rules! log {
    ($($t:tt)*) => {
        eprintln!(
            "[NoteMeet {}] {}",
            Local::now().format("%H:%M:%S%.3f"),
            format!($($t)*)
        )
    };
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub date: String,
    pub short_summary: String,
    pub full_summary: String,
    pub action_items: Vec<String>,
    pub promises: Vec<String>,
    pub speakers: Vec<String>,
    pub tone: String,
    pub speaker_tone: std::collections::HashMap<String, String>,
    pub transcript: String,
    pub meeting_type: String,
    pub audio_file: String,
    pub audio_duration_s: f64,
}

pub struct RecordingState {
    is_recording: bool,
    audio_recorder: Option<audio::AudioRecorder>,
    meeting_type: String,
    live_stop_flag: Option<Arc<AtomicBool>>,
    recording_started_at: Option<std::time::Instant>,
    tray_stop_flag: Option<Arc<AtomicBool>>,
}

pub struct AppState {
    pub recording: Mutex<RecordingState>,
    pub db: db::Database,
}

fn save_wav(audio_data: &[i16], sample_rate: u32, id: &str) -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(&home).join("NoteMeet").join("recordings");
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir: {}", e))?;

    let path = dir.join(format!("{}.wav", id));
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut w =
        hound::WavWriter::create(&path, spec).map_err(|e| format!("WAV create: {}", e))?;
    for &s in audio_data {
        w.write_sample(s).map_err(|e| format!("WAV write: {}", e))?;
    }
    w.finalize().map_err(|e| format!("WAV finalize: {}", e))?;

    let path_str = path.to_string_lossy().to_string();
    log!("Saved WAV: {}", path_str);
    Ok(path_str)
}

fn set_tray_icon(app_handle: &tauri::AppHandle, recording: bool) {
    if let Some(tray) = app_handle.tray_handle_by_id("main") {
        let icon = if recording {
            tauri::Icon::Raw(include_bytes!("../icons/tray-recording.png").to_vec())
        } else {
            tauri::Icon::Raw(include_bytes!("../icons/tray.png").to_vec())
        };
        let _ = tray.set_icon(icon);
    }
}

fn show_or_create_mini_recorder(app_handle: &tauri::AppHandle, recording: bool) {
    use tauri::WindowUrl;

    let (width, height): (f64, f64) = if recording { (420.0, 72.0) } else { (300.0, 56.0) };
    let url = if recording {
        WindowUrl::App("?mini=true&source=recording".into())
    } else {
        WindowUrl::App("?mini=true".into())
    };

    if let Some(win) = app_handle.get_window("mini-recorder") {
        let _ = win.set_size(tauri::LogicalSize::new(width, height));
        let _ = win.show();
        return;
    }

    let window = match tauri::WindowBuilder::new(
        app_handle,
        "mini-recorder",
        url,
    )
    .title("")
    .inner_size(width, height)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    {
        Ok(w) => w,
        Err(e) => {
            log!("Failed to create mini window: {}", e);
            return;
        }
    };

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let pos = monitor.position();
        let x = pos.x as f64 / scale + size.width as f64 / scale - width - 20.0;
        let y = pos.y as f64 / scale + 40.0;
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
}

#[tauri::command]
fn start_recording(
    app_handle: tauri::AppHandle,
    state: State<AppState>,
    meeting_type: String,
) -> Result<(), String> {
    let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
    if rec.is_recording {
        return Err("Already recording".into());
    }

    log!("Recording start, type={}", meeting_type);
    let recorder = audio::AudioRecorder::new()?;
    let sample_rate = recorder.sample_rate();

    let stop_flag = Arc::new(AtomicBool::new(false));
    audio::spawn_live_transcriber(&recorder, sample_rate, stop_flag.clone(), app_handle.clone());

    let started_at = std::time::Instant::now();

    let tray_stop = Arc::new(AtomicBool::new(false));
    let tray_stop_clone = tray_stop.clone();
    let ah = app_handle.clone();
    std::thread::spawn(move || {
        while !tray_stop_clone.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let elapsed = started_at.elapsed().as_secs();
            let m = elapsed / 60;
            let s = elapsed % 60;
            let label = format!("Stop Recording ({:02}:{:02})", m, s);
            if let Some(tray) = ah.tray_handle_by_id("main") {
                let _ = tray.get_item("record").set_title(&label);
            }
        }
        if let Some(tray) = ah.tray_handle_by_id("main") {
            let _ = tray.get_item("record").set_title("Start Recording");
        }
    });

    rec.is_recording = true;
    rec.audio_recorder = Some(recorder);
    rec.meeting_type = meeting_type;
    rec.live_stop_flag = Some(stop_flag);
    rec.recording_started_at = Some(started_at);
    rec.tray_stop_flag = Some(tray_stop);
    drop(rec);

    log!("Recording active");

    set_tray_icon(&app_handle, true);
    show_or_create_mini_recorder(&app_handle, true);
    let _ = app_handle.emit_all("recording-started", serde_json::json!({}));

    Ok(())
}

#[tauri::command]
fn stop_recording(app_handle: tauri::AppHandle, state: State<AppState>, title: String) -> Result<String, String> {
    log!("Recording stop, title={}", title);

    let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
    if !rec.is_recording {
        return Err("Not recording".into());
    }

    // Stop tray timer thread
    if let Some(flag) = rec.tray_stop_flag.take() {
        flag.store(true, Ordering::Relaxed);
    }
    set_tray_icon(&app_handle, false);
    if let Some(tray) = app_handle.tray_handle_by_id("main") {
        let _ = tray.get_item("record").set_title("Start Recording");
    }
    if let Some(win) = app_handle.get_window("mini-recorder") {
        let _ = win.set_size(tauri::LogicalSize::new(300.0, 56.0));
    }

    if let Some(flag) = rec.live_stop_flag.take() {
        flag.store(true, Ordering::Relaxed);
    }

    let recorder = rec.audio_recorder.take().ok_or("No recording in progress")?;
    let meeting_type = rec.meeting_type.clone();

    let (audio_data, sample_rate, _) = recorder.stop()?;
    rec.is_recording = false;
    rec.recording_started_at = None;
    drop(rec);

    let recording_id = uuid::Uuid::new_v4().to_string();
    let audio_duration_s = audio_data.len() as f64 / sample_rate as f64;
    let audio_file = save_wav(&audio_data, sample_rate, &recording_id)?;

    let _ = app_handle.emit_all("processing-stage", serde_json::json!({"stage": "transcribing"}));
    log!("Transcribing...");
    let transcript = whisper::transcribe(&audio_data, sample_rate)?;

    let _ = app_handle.emit_all("processing-stage", serde_json::json!({"stage": "generating"}));
    log!("Generating notes...");
    let mut note = llm::generate_notes(&title, &transcript, &meeting_type)?;

    note.audio_file = audio_file;
    note.audio_duration_s = audio_duration_s;

    state.db.save_note(&note)?;

    let json = serde_json::to_string(&note).map_err(|e| e.to_string())?;
    log!("Note saved: {}", note.id);
    Ok(json)
}

#[tauri::command]
fn load_notes(state: State<AppState>) -> Result<Vec<Note>, String> {
    state.db.load_notes()
}

#[tauri::command]
fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
fn get_audio_level(state: State<AppState>) -> Result<f32, String> {
    let rec = state.recording.lock().map_err(|e| e.to_string())?;
    match &rec.audio_recorder {
        Some(r) => Ok(r.current_level()),
        None => Ok(0.0),
    }
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
fn ask_about_note(note_json: String, question: String, history: Vec<llm::ChatMessage>) -> Result<String, String> {
    llm::chat_about_note(&note_json, &question, &history)
}

#[tauri::command]
fn ask_all_notes(all_notes_json: String, question: String, history: Vec<llm::ChatMessage>) -> Result<String, String> {
    llm::chat_all_notes(&all_notes_json, &question, &history)
}

#[tauri::command]
fn add_calendar_event(state: State<AppState>, title: String, date: String, time: String, notes: String) -> Result<db::CalendarEvent, String> {
    let event = db::CalendarEvent {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        date,
        time,
        notes,
    };
    state.db.add_event(&event)?;
    Ok(event)
}

#[tauri::command]
fn load_calendar_events(state: State<AppState>) -> Result<Vec<db::CalendarEvent>, String> {
    state.db.load_events()
}

#[tauri::command]
fn delete_calendar_event(state: State<AppState>, event_id: String) -> Result<(), String> {
    state.db.delete_event(&event_id)
}

#[tauri::command]
fn update_note(state: State<AppState>, note: Note) -> Result<(), String> {
    state.db.update_note(&note)?;
    log!("Note updated: {}", note.id);
    Ok(())
}

#[tauri::command]
fn delete_note(state: State<AppState>, note_id: String) -> Result<(), String> {
    state.db.delete_note(&note_id)?;
    log!("Note deleted: {}", note_id);
    Ok(())
}

#[tauri::command]
fn google_auth_status() -> Result<serde_json::Value, String> {
    google::auth_status()
}

#[tauri::command]
fn google_sign_in(app_handle: tauri::AppHandle) -> Result<String, String> {
    google::start_auth_flow(app_handle)
}

#[tauri::command]
fn google_sign_out() -> Result<(), String> {
    google::sign_out()
}

#[tauri::command]
fn google_sync_events() -> Result<Vec<google::GoogleEvent>, String> {
    google::fetch_calendar_events()
}

#[tauri::command]
fn google_create_event(title: String, date: String, time: String, notes: String) -> Result<google::GoogleEvent, String> {
    google::create_calendar_event(&title, &date, &time, &notes)
}

#[tauri::command]
fn create_mini_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    show_or_create_mini_recorder(&app_handle, false);
    if let Some(win) = app_handle.get_window("mini-recorder") {
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn get_recording_state(state: State<AppState>) -> Result<bool, String> {
    let rec = state.recording.lock().map_err(|e| e.to_string())?;
    Ok(rec.is_recording)
}

#[tauri::command]
fn pause_recording(state: State<AppState>) -> Result<(), String> {
    let rec = state.recording.lock().map_err(|e| e.to_string())?;
    if let Some(r) = &rec.audio_recorder {
        r.pause();
        Ok(())
    } else {
        Err("Not recording".into())
    }
}

#[tauri::command]
fn resume_recording(state: State<AppState>) -> Result<(), String> {
    let rec = state.recording.lock().map_err(|e| e.to_string())?;
    if let Some(r) = &rec.audio_recorder {
        r.resume();
        Ok(())
    } else {
        Err("Not recording".into())
    }
}

#[tauri::command]
fn get_pause_state(state: State<AppState>) -> Result<bool, String> {
    let rec = state.recording.lock().map_err(|e| e.to_string())?;
    match &rec.audio_recorder {
        Some(r) => Ok(r.is_paused()),
        None => Ok(false),
    }
}

#[tauri::command]
fn search_notes(state: State<AppState>, query: String) -> Result<Vec<Note>, String> {
    state.db.search_notes(&query, 50)
}

#[tauri::command]
fn save_note(state: State<AppState>, note: Note) -> Result<(), String> {
    state.db.save_note(&note)
}

#[tauri::command]
fn export_notes(state: State<AppState>, note_ids: Vec<String>) -> Result<String, String> {
    let selected = state.db.load_notes_by_ids(&note_ids)?;
    let mut md = String::new();
    for (i, note) in selected.iter().enumerate() {
        if i > 0 { md.push_str("\n\n---\n\n"); }
        md.push_str(&format!("# {}\n\n", note.title));
        md.push_str(&format!("**Date:** {}\n", note.date));
        md.push_str(&format!("**Type:** {}\n", note.meeting_type));
        if note.short_summary.len() > 0 { md.push_str(&format!("\n## Summary\n{}\n", note.short_summary)); }
        if note.action_items.len() > 0 {
            md.push_str("\n## Action Items\n");
            for item in &note.action_items { md.push_str(&format!("- [ ] {}\n", item)); }
        }
    }
    Ok(md)
}

#[tauri::command]
fn toggle_recording(
    app_handle: tauri::AppHandle,
    state: State<AppState>,
    meeting_type: String,
) -> Result<Option<String>, String> {
    let is_rec = state.recording.lock().map_err(|e| e.to_string())?.is_recording;
    if is_rec {
        stop_recording(app_handle, state, "Quick Note".to_string())
            .map(Some)
    } else {
        start_recording(app_handle, state, meeting_type)?;
        Ok(None)
    }
}

fn main() {
    log!("Starting NoteMeet...");

    let db = db::Database::new().expect("DB init failed");

    let record_item = CustomMenuItem::new("record", "Start Recording").accelerator("CmdOrCtrl+R");
    let show_item = CustomMenuItem::new("show", "Show/Hide NoteMeet").accelerator("CmdOrCtrl+Shift+N");
    let quit_item = CustomMenuItem::new("quit", "Quit NoteMeet");

    let tray_menu = SystemTrayMenu::new()
        .add_item(record_item)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(show_item)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit_item);

    let tray = SystemTray::new()
        .with_menu(tray_menu)
        .with_icon(tauri::Icon::Raw(include_bytes!("../icons/tray.png").to_vec()));

    tauri::Builder::default()
        .system_tray(tray)
        .manage(AppState {
            recording: Mutex::new(RecordingState {
                is_recording: false,
                audio_recorder: None,
                meeting_type: "meeting".into(),
                live_stop_flag: None,
                recording_started_at: None,
                tray_stop_flag: None,
            }),
            db,
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            toggle_recording,
            load_notes,
            update_note,
            delete_note,
            read_audio_file,
            write_text_file,
            get_audio_level,
            ask_about_note,
            ask_all_notes,
            add_calendar_event,
            load_calendar_events,
            delete_calendar_event,
            create_mini_window,
            get_recording_state,
            pause_recording,
            resume_recording,
            get_pause_state,
            search_notes,
            save_note,
            export_notes,
            google_auth_status,
            google_sign_in,
            google_sign_out,
            google_sync_events,
            google_create_event,
            detector::dismiss_meeting_detection,
            detector::reset_detection_cooldown,
        ])
        .setup(|app| {
            detector::start_detector(app.handle());
            Ok(())
        })
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(window) = app.get_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "record" => {
                    let state: State<AppState> = app.state();
                    let is_rec = state.recording.lock().unwrap().is_recording;
                    if is_rec {
                        if let Ok(result) = stop_recording(app.clone(), state, "Quick Note".to_string()) {
                            if let Some(window) = app.get_window("main") {
                                let _ = window.emit("note-ready", result);
                            }
                        }
                        if let Some(tray) = app.tray_handle_by_id("main") {
                            let _ = tray.get_item("record").set_title("Start Recording");
                        }
                    } else {
                        let _ = start_recording(app.clone(), state, "meeting".to_string());
                        if let Some(tray) = app.tray_handle_by_id("main") {
                            let _ = tray.get_item("record").set_title("Stop Recording");
                        }
                        if let Some(window) = app.get_window("main") {
                            let _ = window.emit("recording-started", ());
                        }
                    }
                }
                "show" => {
                    if let Some(window) = app.get_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                let _ = event.window().hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_serializes_to_camel_case() {
        let note = Note {
            id: "test-id".into(),
            title: "Test".into(),
            date: "2026-01-01T00:00:00Z".into(),
            short_summary: "Short".into(),
            full_summary: "Full".into(),
            action_items: vec!["Do X".into()],
            promises: vec![],
            speakers: vec!["Alice".into()],
            tone: "professional".into(),
            speaker_tone: std::collections::HashMap::new(),
            transcript: "Hello".into(),
            meeting_type: "meeting".into(),
            audio_file: "".into(),
            audio_duration_s: 60.0,
        };

        let json = serde_json::to_string(&note).expect("serialize");
        assert!(json.contains("shortSummary"));
        assert!(json.contains("fullSummary"));
        assert!(json.contains("actionItems"));
        assert!(json.contains("meetingType"));
        assert!(json.contains("audioFile"));
        assert!(json.contains("audioDurationS"));
        assert!(json.contains("speakerTone"));
        assert!(!json.contains("short_summary"));
    }

    #[test]
    fn test_note_deserializes_from_camel_case() {
        let json = r#"{
            "id": "abc123",
            "title": "Standup",
            "date": "2026-01-01T00:00:00Z",
            "shortSummary": "Quick summary",
            "fullSummary": "Longer text here",
            "actionItems": ["Task 1", "Task 2"],
            "promises": ["I will do X"],
            "speakers": ["Bob"],
            "tone": "casual",
            "speakerTone": {"Bob": "enthusiastic"},
            "transcript": "Transcript text",
            "meetingType": "standup",
            "audioFile": "/tmp/a.wav",
            "audioDurationS": 45.5
        }"#;

        let note: Note = serde_json::from_str(json).expect("deserialize");
        assert_eq!(note.id, "abc123");
        assert_eq!(note.short_summary, "Quick summary");
        assert_eq!(note.action_items.len(), 2);
        assert_eq!(note.speaker_tone.get("Bob"), Some(&"enthusiastic".to_string()));
        assert!((note.audio_duration_s - 45.5).abs() < 0.001);
    }

    #[test]
    fn test_note_clone_works() {
        let note = Note {
            id: "clone-test".into(),
            title: "Original".into(),
            date: "2026-01-01T00:00:00Z".into(),
            short_summary: "Summary".into(),
            full_summary: "Full".into(),
            action_items: vec!["A".into()],
            promises: vec![],
            speakers: vec![],
            tone: "".into(),
            speaker_tone: std::collections::HashMap::new(),
            transcript: "".into(),
            meeting_type: "meeting".into(),
            audio_file: "".into(),
            audio_duration_s: 0.0,
        };
        let cloned = note.clone();
        assert_eq!(cloned.id, note.id);
        assert_eq!(cloned.title, note.title);
        assert_eq!(cloned.action_items, note.action_items);
    }

    #[test]
    fn test_save_wav_creates_file() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let test_home = tmp.path().to_path_buf();
        std::env::set_var("HOME", &test_home);

        let samples = vec![100i16, -100, 200, -200, 0];
        let result = save_wav(&samples, 16000, "test-recording");
        assert!(result.is_ok());

        let path = result.unwrap();
        let wav_path = std::path::Path::new(&path);
        assert!(wav_path.exists());

        let metadata = std::fs::metadata(&wav_path).expect("Failed to read file metadata");
        assert!(metadata.len() > 44); // WAV header is 44 bytes minimum
    }

    #[test]
    fn test_save_wav_can_be_read_back() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        std::env::set_var("HOME", &tmp.path().to_path_buf());

        let samples: Vec<i16> = (0..1600).map(|i| (i as f32 * 0.1) as i16).collect();
        let path = save_wav(&samples, 16000, "roundtrip-test").expect("Failed to save WAV");

        let mut reader = hound::WavReader::open(&path).expect("Failed to open WAV");
        let spec = reader.spec();
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, 16000);
        assert_eq!(spec.bits_per_sample, 16);

        let read_samples: Vec<i16> = reader
            .samples()
            .filter_map(|s| s.ok())
            .collect();
        assert_eq!(read_samples.len(), 1600);
        assert_eq!(read_samples[0], 0);
    }

    #[test]
    fn test_save_wav_empty_samples() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        std::env::set_var("HOME", &tmp.path().to_path_buf());

        let result = save_wav(&[], 44100, "empty-recording");
        assert!(result.is_ok());

        let path = result.unwrap();
        let reader = hound::WavReader::open(&path).expect("Failed to open");
        let count = reader.into_samples::<i16>().filter_map(|s| s.ok()).count();
        assert_eq!(count, 0);
    }
}
