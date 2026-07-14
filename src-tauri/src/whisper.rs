use chrono::Local;
use std::process::Command;

macro_rules! log { ($($t:tt)*) => { eprintln!("[NoteMeet {}] {}", Local::now().format("%H:%M:%S%.3f"), format!($($t)*)) } }

/// Check if audio data is empty or all silence (zeros).
pub fn is_empty_or_silence(audio_data: &[i16], sample_rate: u32) -> bool {
    if audio_data.is_empty() {
        return true;
    }
    let expected_silence = sample_rate as usize * 2;
    audio_data.len() <= expected_silence && audio_data.iter().all(|&s| s == 0)
}

/// Parse whisper-cli stdout into a single transcript string.
/// Filters out timestamps, [Music], [Silence] markers.
pub fn parse_whisper_stdout(stdout: &str) -> String {
    let lines: Vec<&str> = stdout.lines().filter(|l| l.contains("-->")).collect();

    if lines.is_empty() {
        return String::new();
    }

    lines
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
        .join(" ")
}

pub fn transcribe(audio_data: &[i16], sample_rate: u32) -> Result<String, String> {
    if is_empty_or_silence(audio_data, sample_rate) {
        log!("Audio is empty or all silence ({} samples)", audio_data.len());
        return Ok("[No audio detected]".to_string());
    }

    let total_samples = audio_data.len();
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
        format!("{}/notemeet-app/src-tauri/whisper/models/ggml-medium.bin", home)
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
        .arg("-l")
        .arg("auto")
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
    log!("whisper-cli stdout: {} lines", stdout.lines().count());

    let text = parse_whisper_stdout(&stdout);

    if text.is_empty() {
        log!("No speech detected in whisper output");
        return Ok("[No speech detected]".to_string());
    }

    log!("Transcribed {} chars: \"{:.100}...\"", text.len(), text);
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_audio_is_silence() {
        assert!(is_empty_or_silence(&[], 44100));
    }

    #[test]
    fn test_all_zeros_is_silence() {
        let silence = vec![0i16; 44100]; // 1 second of zeros
        assert!(is_empty_or_silence(&silence, 44100));
    }

    #[test]
    fn test_short_zeros_is_silence() {
        let silence = vec![0i16; 100];
        assert!(is_empty_or_silence(&silence, 44100));
    }

    #[test]
    fn test_real_audio_not_silence() {
        let audio = vec![100i16; 44100];
        assert!(!is_empty_or_silence(&audio, 44100));
    }

    #[test]
    fn test_long_zeros_not_silence() {
        let silence = vec![0i16; 44100 * 5]; // 5 seconds of zeros — longer than 2s threshold
        assert!(!is_empty_or_silence(&silence, 44100));
    }

    #[test]
    fn test_parse_normal_output() {
        let stdout = "[00:00:00.000 --> 00:00:02.000]  Hello world.\n[00:00:02.000 --> 00:00:04.000]  This is a test.\n";
        let result = parse_whisper_stdout(stdout);
        assert_eq!(result, "Hello world. This is a test.");
    }

    #[test]
    fn test_parse_empty_output() {
        assert_eq!(parse_whisper_stdout(""), "");
    }

    #[test]
    fn test_parse_only_timestamps_no_text() {
        let stdout = "[00:00:00.000 --> 00:00:02.000]\n";
        assert_eq!(parse_whisper_stdout(stdout), "");
    }

    #[test]
    fn test_parse_filters_music_silence() {
        let stdout = "[00:00:00.000 --> 00:00:02.000]  [Music]\n[00:00:02.000 --> 00:00:04.000]  [Silence]\n[00:00:04.000 --> 00:00:06.000]  Actual speech.\n";
        assert_eq!(parse_whisper_stdout(stdout), "Actual speech.");
    }

    #[test]
    fn test_parse_no_timestamp_lines() {
        let stdout = "whisper-cli v1.0\nModel: tiny.en\n";
        assert_eq!(parse_whisper_stdout(stdout), "");
    }

    #[test]
    fn test_parse_multiple_segments() {
        let stdout = "[00:00:00.000 --> 00:00:03.000]  First segment.\n[00:00:03.000 --> 00:00:06.000]  Second one here.\n[00:00:06.000 --> 00:00:09.000]  And a third.\n";
        let result = parse_whisper_stdout(stdout);
        assert_eq!(result, "First segment. Second one here. And a third.");
    }

    #[test]
    fn test_parse_trims_whitespace() {
        let stdout = "[00:00:00.000 --> 00:00:02.000]     Spaced out text.   \n";
        assert_eq!(parse_whisper_stdout(stdout), "Spaced out text.");
    }

    #[test]
    fn test_parse_hindi_text() {
        let stdout = "[00:00:00.000 --> 00:00:03.000]  नमस्ते, आप कैसे हैं?\n[00:00:03.000 --> 00:00:06.000]  मैं ठीक हूँ, धन्यवाद।\n";
        let result = parse_whisper_stdout(stdout);
        assert_eq!(result, "नमस्ते, आप कैसे हैं? मैं ठीक हूँ, धन्यवाद।");
    }

    #[test]
    fn test_parse_mixed_hindi_english() {
        let stdout = "[00:00:00.000 --> 00:00:02.000]  Hello, कैसे हो?\n[00:00:02.000 --> 00:00:04.500]  I'm good, और तुम?\n";
        let result = parse_whisper_stdout(stdout);
        assert_eq!(result, "Hello, कैसे हो? I'm good, और तुम?");
    }
}
