use chrono::Local;
use std::process::Command;

macro_rules! log { ($($t:tt)*) => { eprintln!("[NoteMeet {}] {}", Local::now().format("%H:%M:%S%.3f"), format!($($t)*)) } }

pub fn transcribe(audio_data: &[i16], sample_rate: u32) -> Result<String, String> {
    let total_samples = audio_data.len();
    let expected_silence = sample_rate as usize * 2;

    if audio_data.is_empty() || (total_samples <= expected_silence && audio_data.iter().all(|&s| s == 0)) {
        log!("Audio is empty or all silence ({} samples)", total_samples);
        return Ok("[No audio detected]".to_string());
    }

    log!("Transcribing {} samples @ {} Hz ({:.1}s)", total_samples, sample_rate, total_samples as f64 / sample_rate as f64);

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
    log!("WAV temp file written: {} bytes", total_samples * 2);

    let model_path = std::env::var("WHISPER_MODEL_PATH").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/sangameshk".to_string());
        format!("{}/notemeet-app/src-tauri/whisper/models/ggml-tiny.en.bin", home)
    });
    log!("whisper model: {}", model_path);

    let whisper_bin = std::env::var("WHISPER_CLI_PATH")
        .unwrap_or_else(|_| "/opt/homebrew/bin/whisper-cli".to_string());

    log!("Running {}...", whisper_bin);
    let start = std::time::Instant::now();
    let output = Command::new(whisper_bin)
        .arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(wav_path)
        .output()
        .map_err(|e| format!("whisper-cli not found: {}", e))?;

    let elapsed = start.elapsed();
    log!("whisper-cli finished in {:.1}s, exit={}", elapsed.as_secs_f64(), output.status);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log!("whisper-cli error: {}", stderr);
        return Err(format!("Transcription failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line_count = stdout.lines().count();
    log!("whisper-cli stdout: {} lines", line_count);

    let lines: Vec<&str> = stdout
        .lines()
        .filter(|l| l.contains("-->"))
        .collect();

    if lines.is_empty() {
        log!("No speech detected in whisper output");
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
        log!("All segments filtered out (music/silence only)");
        return Ok("[No speech detected]".to_string());
    }

    log!("Transcribed {} chars: \"{:.100}...\"", text.len(), text);
    Ok(text)
}
