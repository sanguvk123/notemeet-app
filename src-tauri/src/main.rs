mod audio;
mod whisper;
mod llm;

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};

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
pub struct Note {
    pub id: String,
    pub title: String,
    pub date: String,
    pub summary: String,
    pub action_items: Vec<String>,
    pub transcript: String,
    pub meeting_type: String,
}

pub struct AppState {
    pub is_recording: Mutex<bool>,
    pub audio_recorder: Mutex<Option<audio::AudioRecorder>>,
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
    let recorder = audio::AudioRecorder::new()
        .map_err(|e| format!("Failed to initialize audio: {}", e))?;

    let mut stored = state.audio_recorder.lock().map_err(|e| e.to_string())?;
    *stored = Some(recorder);

    *is_rec = true;

    let _ = app_handle.emit_all("recording-started", ());
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<AppState>, title: String) -> Result<String, String> {
    let mut is_rec = state.is_recording.lock().map_err(|e| e.to_string())?;
    if !*is_rec {
        return Err("Not recording".into());
    }

    log!("Recording stop, title={}", title);

    let mut stored = state.audio_recorder.lock().map_err(|e| e.to_string())?;
    let recorder = stored.take().ok_or("No recording in progress")?;
    let (audio_data, sample_rate) = recorder.stop().map_err(|e| format!("Audio error: {}", e))?;

    *is_rec = false;

    let meeting_type = "meeting";

    log!("Transcribing...");
    let transcript = whisper::transcribe(&audio_data, sample_rate)
        .map_err(|e| format!("Transcription error: {}", e))?;

    log!("Generating notes...");
    let note = llm::generate_notes(&title, &transcript, meeting_type)
        .map_err(|e| format!("LLM error: {}", e))?;

    let json = serde_json::to_string(&note).map_err(|e| e.to_string())?;
    log!("Note saved: {}", note.id);
    Ok(json)
}

#[tauri::command]
fn create_mini_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::WindowUrl;

    if app_handle.get_window("mini-recorder").is_some() {
        let win = app_handle.get_window("mini-recorder").unwrap();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let window = tauri::WindowBuilder::new(
        &app_handle,
        "mini-recorder",
        WindowUrl::App("?mini=true".into()),
    )
    .title("")
    .inner_size(240.0, 72.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| format!("Mini window: {}", e))?;

    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let size = monitor.size();
        let _ = window.set_position(tauri::PhysicalPosition::new(
            size.width as i32 - 260,
            40,
        ));
    }

    Ok(())
}

fn main() {
    log!("Starting NoteMeet...");

    tauri::Builder::default()
        .manage(AppState {
            is_recording: Mutex::new(false),
            audio_recorder: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            create_mini_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
