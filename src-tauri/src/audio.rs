use chrono::Local;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Manager;

macro_rules! log { ($($t:tt)*) => { eprintln!("[NoteMeet {}] {}", Local::now().format("%H:%M:%S%.3f"), format!($($t)*)) } }

struct SendStream(cpal::Stream);
unsafe impl Send for SendStream {}

pub struct AudioRecorder {
    collected: Arc<Mutex<Vec<i16>>>,
    _stream: SendStream,
    sample_rate: u32,
    started_at: chrono::DateTime<Local>,
}

impl AudioRecorder {
    pub fn new() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No microphone found".to_string())?;

        log!("Mic: {:?}", device.name());

        let supported = device
            .default_input_config()
            .map_err(|e| format!("No input config: {}", e))?;

        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels();
        log!("Audio config: {} Hz, {} channels, {:?}", sample_rate, channels, supported.sample_format());

        let config: cpal::StreamConfig = supported.into();
        let collected = Arc::new(Mutex::new(Vec::new()));
        let c2 = collected.clone();
        let started_at = Local::now();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &_| {
                    if let Ok(mut buf) = c2.lock() {
                        let prev = buf.len();
                        buf.extend(data.iter().map(|&s| (s * i16::MAX as f32) as i16));
                        // Log buffer growth periodically
                        if buf.len() / sample_rate as usize > 0
                            && (buf.len() - prev) > sample_rate as usize * 10
                        {
                            log!("Audio buffer: {:.1}s", buf.len() as f64 / sample_rate as f64);
                        }
                    }
                },
                move |err| log!("Audio stream err: {}", err),
                None,
            )
            .map_err(|e| format!("Build stream: {}", e))?;

        stream
            .play()
            .map_err(|e| format!("Start stream: {}", e))?;

        log!("Recording started at {}", started_at.format("%H:%M:%S"));
        Ok(AudioRecorder {
            collected,
            _stream: SendStream(stream),
            sample_rate,
            started_at,
        })
    }

    pub fn stop(self) -> Result<(Vec<i16>, u32, chrono::DateTime<Local>), String> {
        let stopped_at = Local::now();
        drop(self._stream);
        let data = self.collected.lock().unwrap().clone();
        let dur_s = data.len() as f64 / self.sample_rate as f64;

        log!("Recording stopped at {} (ran {:.1}s)", stopped_at.format("%H:%M:%S"), dur_s);
        log!("Captured {} samples @ {} Hz (RMS check below)", data.len(), self.sample_rate);

        // RMS
        let rms = if data.is_empty() {
            0.0
        } else {
            let sum_sq: f64 = data.iter().map(|&s| (s as f64 / i16::MAX as f64).powi(2)).sum();
            (sum_sq / data.len() as f64).sqrt()
        };
        log!("Audio RMS: {:.4}", rms);

        if data.is_empty() {
            log!("WARNING: No audio data captured!");
            Ok((vec![0i16; self.sample_rate as usize * 2], self.sample_rate, self.started_at))
        } else {
            // Log min/max for debugging
            let min = data.iter().min().unwrap_or(&0);
            let max = data.iter().max().unwrap_or(&0);
            log!("Audio range: {} .. {}", min, max);
            Ok((data, self.sample_rate, self.started_at))
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Returns new samples since `since` and updates `since` to current buffer length.
    pub fn drain_since(&self, since: &mut usize) -> Vec<i16> {
        let buf = self.collected.lock().unwrap();
        if *since >= buf.len() {
            return Vec::new();
        }
        let new = buf[*since..].to_vec();
        *since = buf.len();
        new
    }

    pub fn buffered_samples(&self) -> usize {
        self.collected.lock().map(|b| b.len()).unwrap_or(0)
    }
}

/// Spawn a background thread that transcribes audio in near-real-time during recording.
pub fn spawn_live_transcriber(
    recorder: &AudioRecorder,
    sample_rate: u32,
    stop_flag: Arc<AtomicBool>,
    app_handle: tauri::AppHandle,
) {
    let collected = recorder.collected.clone();
    let mut last_pos = 0usize;
    let min_chunk = (sample_rate as usize) * 2; // 2 seconds minimum per chunk
    let model_path = std::env::var("WHISPER_MODEL_PATH").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/sangameshk".to_string());
        format!("{}/notemeet-app/src-tauri/whisper/models/ggml-base.bin", home)
    });

    thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            let new_samples = {
                let buf = collected.lock().unwrap();
                if last_pos >= buf.len() {
                    drop(buf);
                    thread::sleep(std::time::Duration::from_millis(500));
                    continue;
                }
                // Take all new audio since last check
                let new = buf[last_pos..].to_vec();
                last_pos = buf.len();
                new
            };

            if new_samples.len() < min_chunk {
                thread::sleep(std::time::Duration::from_millis(500));
                continue;
            }

            // Write WAV for this chunk
            let wav_path = "/tmp/notemeet_live.wav";
            let spec = hound::WavSpec {
                channels: 1,
                sample_rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };

            if let Ok(mut w) = hound::WavWriter::create(wav_path, spec) {
                for &s in &new_samples {
                    let _ = w.write_sample(s);
                }
                let _ = w.finalize();
            } else {
                continue;
            }

            let whisper_bin = std::env::var("WHISPER_CLI_PATH")
                .unwrap_or_else(|_| "/opt/homebrew/bin/whisper-cli".to_string());

            let t0 = std::time::Instant::now();
            let output = std::process::Command::new(whisper_bin)
                .arg("-m")
                .arg(&model_path)
                .arg("-f")
                .arg(wav_path)
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let text: String = stdout
                        .lines()
                        .filter(|l| l.contains("-->"))
                        .filter_map(|l| {
                            let idx = l.find(']').map(|i| i + 1)?;
                            let seg = l[idx..].trim().to_string();
                            if seg.is_empty() || seg == "[Music]" || seg == "[Silence]" {
                                None
                            } else {
                                Some(seg)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ");

                    if !text.is_empty() {
                        let latency = t0.elapsed().as_millis();
                        log!("Live: {} chars in {}ms", text.len(), latency);
                        let _ = app_handle
                            .emit_all("transcription-update", serde_json::json!({"text": text}));
                    }
                }
            }
        }
        log!("Live transcriber stopped");
    });
}
