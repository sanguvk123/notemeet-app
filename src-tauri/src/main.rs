mod audio;
mod whisper;
mod llm;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

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
fn start_recording(state: State<AppState>, meeting_type: String) -> Result<(), String> {
    let mut is_rec = state.is_recording.lock().map_err(|e| e.to_string())?;
    if *is_rec {
        return Err("Already recording".into());
    }

    let recorder = audio::AudioRecorder::new()
        .map_err(|e| format!("Failed to initialize audio: {}", e))?;

    let mut stored = state.audio_recorder.lock().map_err(|e| e.to_string())?;
    *stored = Some(recorder);

    *is_rec = true;
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<AppState>, title: String) -> Result<String, String> {
    let mut is_rec = state.is_recording.lock().map_err(|e| e.to_string())?;
    if !*is_rec {
        return Err("Not recording".into());
    }

    let mut stored = state.audio_recorder.lock().map_err(|e| e.to_string())?;
    let recorder = stored.take().ok_or("No recording in progress")?;
    let audio_data = recorder.stop().map_err(|e| format!("Audio error: {}", e))?;

    *is_rec = false;

    let meeting_type = "meeting";

    // Transcribe
    let transcript = whisper::transcribe(&audio_data)
        .map_err(|e| format!("Transcription error: {}", e))?;

    // Generate notes
    let note = llm::generate_notes(&title, &transcript, meeting_type)
        .map_err(|e| format!("LLM error: {}", e))?;

    serde_json::to_string(&note).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            is_recording: Mutex::new(false),
            audio_recorder: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![start_recording, stop_recording])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
