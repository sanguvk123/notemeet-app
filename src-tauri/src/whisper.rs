use chrono::Local;
use std::process::Command;

macro_rules! log {
    ($($t:tt)*) => {
        eprintln!(
            "[NoteMeet {}] {}",
            Local::now().format("%H:%M:%S%.3f"),
            format!($($t)*)
        )
    };
}

pub fn transcribe(audio_data: &[i16], sample_rate: u32) -> Result<String, String> {
    let total_samples = audio_data.len();
    if total_samples < 100 {
        return Ok("[No audio detected]".to_string());
    }

    let wav_path = "/tmp/notemeet_recording.wav";
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer =
        hound::WavWriter::create(wav_path, spec).map_err(|e| format!("WAV create: {}", e))?;
    for &sample in audio_data {
        writer.write_sample(sample).map_err(|e| format!("WAV write: {}", e))?;
    }
    writer.finalize().map_err(|e| format!("WAV finalize: {}", e))?;

    let whisper_bin = std::env::var("WHISPER_CLI_PATH")
        .unwrap_or_else(|_| "/opt/homebrew/bin/whisper-cli".to_string());

    let model_path = std::env::var("WHISPER_MODEL_PATH").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        format!(
            "{}/notemeet-app/src-tauri/whisper/models/ggml-tiny.en.bin",
            home
        )
    });

    log!("Running whisper-cli...");
    let output = Command::new(whisper_bin)
        .arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(wav_path)
        .output()
        .map_err(|e| format!("whisper-cli not found: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log!("whisper-cli error: {}", stderr);
        return Err(format!("Transcription failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().filter(|l| l.contains("-->")).collect();

    if lines.is_empty() {
        return Ok("[No speech detected]".to_string());
    }

    let text: String = lines
        .iter()
        .filter_map(|l| {
            let idx = l.find(']').map(|i| i + 1)?;
            let segment = l[idx..].trim();
            if segment.is_empty() || segment == "[Music]" || segment == "[Silence]" {
                None
            } else {
                Some(segment)
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    if text.is_empty() {
        return Ok("[No speech detected]".to_string());
    }

    log!("Transcribed {} chars", text.len());
    Ok(text)
}
