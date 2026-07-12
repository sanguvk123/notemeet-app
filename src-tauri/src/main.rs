mod audio;
mod db;
mod whisper;
mod llm;

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    CustomMenuItem, Manager, State, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem,
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

pub struct AppState {
    pub is_recording: Mutex<bool>,
    pub audio_recorder: Mutex<Option<audio::AudioRecorder>>,
    pub meeting_type: Mutex<String>,
    pub db: db::Database,
    pub live_stop_flag: Mutex<Option<Arc<AtomicBool>>>,
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

#[tauri::command]
fn start_recording(
    app_handle: tauri::AppHandle,
    state: State<AppState>,
    meeting_type: String,
) -> Result<(), String> {
    let mut is_rec = state.is_recording.lock().map_err(|e| e.to_string())?;
    if *is_rec {
        return Err("Already recording".into());
    }

    log!("Recording start, type={}", meeting_type);
    let recorder = audio::AudioRecorder::new()?;
    let sample_rate = recorder.sample_rate();

    let stop_flag = Arc::new(AtomicBool::new(false));
    audio::spawn_live_transcriber(&recorder, sample_rate, stop_flag.clone(), app_handle);

    let mut stored = state.audio_recorder.lock().map_err(|e| e.to_string())?;
    *stored = Some(recorder);

    let mut flag = state.live_stop_flag.lock().map_err(|e| e.to_string())?;
    *flag = Some(stop_flag);

    let mut mt = state.meeting_type.lock().map_err(|e| e.to_string())?;
    *mt = meeting_type;

    *is_rec = true;
    log!("Recording active");
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<AppState>, title: String) -> Result<String, String> {
    log!("Recording stop, title={}", title);

    let mut is_rec = state.is_recording.lock().map_err(|e| e.to_string())?;
    if !*is_rec {
        return Err("Not recording".into());
    }

    {
        let mut flag = state.live_stop_flag.lock().map_err(|e| e.to_string())?;
        if let Some(f) = flag.take() {
            f.store(true, Ordering::Relaxed);
        }
    }

    let mut stored = state.audio_recorder.lock().map_err(|e| e.to_string())?;
    let recorder = stored.take().ok_or("No recording in progress")?;

    let (audio_data, sample_rate, _) = recorder.stop()?;
    *is_rec = false;

    let recording_id = uuid::Uuid::new_v4().to_string();
    let audio_duration_s = audio_data.len() as f64 / sample_rate as f64;
    let audio_file = save_wav(&audio_data, sample_rate, &recording_id)?;

    log!("Transcribing...");
    let transcript = whisper::transcribe(&audio_data, sample_rate)?;

    let meeting_type = state.meeting_type.lock().map_err(|e| e.to_string())?.clone();
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
fn ask_about_note(note_json: String, question: String, history: Vec<llm::ChatMessage>) -> Result<String, String> {
    llm::chat_about_note(&note_json, &question, &history)
}

#[tauri::command]
fn toggle_recording(
    app_handle: tauri::AppHandle,
    state: State<AppState>,
    meeting_type: String,
) -> Result<Option<String>, String> {
    let is_rec = state.is_recording.lock().map_err(|e| e.to_string())?;
    if *is_rec {
        drop(is_rec);
        stop_recording(state, "Quick Note".to_string())
            .map(Some)
    } else {
        drop(is_rec);
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
            is_recording: Mutex::new(false),
            audio_recorder: Mutex::new(None),
            meeting_type: Mutex::new("meeting".into()),
            db,
            live_stop_flag: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            toggle_recording,
            load_notes,
            read_audio_file,
            ask_about_note,
        ])
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
                    let is_rec = state.is_recording.lock().unwrap();
                    if *is_rec {
                        drop(is_rec);
                        let state: State<AppState> = app.state();
                        if let Ok(result) = stop_recording(state, "Quick Note".to_string()) {
                            if let Some(window) = app.get_window("main") {
                                let _ = window.emit("note-ready", result);
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        // Update tray menu text
                        if let Some(tray) = app.tray_handle_by_id("main") {
                            let item = tray.get_item("record");
                            let _ = item.set_title("Start Recording");
                        }
                    } else {
                        drop(is_rec);
                        // Can't start from tray without meeting_type — use default
                        let state: State<AppState> = app.state();
                        let _ = start_recording(app.clone(), state, "meeting".to_string());
                        // Update tray menu text
                        if let Some(tray) = app.tray_handle_by_id("main") {
                            let item = tray.get_item("record");
                            let _ = item.set_title("Stop Recording");
                        }
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
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
