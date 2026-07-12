use chrono::Local;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

macro_rules! log {
    ($($t:tt)*) => {
        eprintln!(
            "[NoteMeet {}] {}",
            Local::now().format("%H:%M:%S%.3f"),
            format!($($t)*)
        )
    };
}

struct SendStream(cpal::Stream);
unsafe impl Send for SendStream {}

pub struct AudioRecorder {
    collected: Arc<Mutex<Vec<i16>>>,
    _stream: SendStream,
    sample_rate: u32,
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
        log!("Audio config: {} Hz, {:?}", sample_rate, supported.sample_format());

        let config: cpal::StreamConfig = supported.into();
        let collected = Arc::new(Mutex::new(Vec::new()));
        let c2 = collected.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &_| {
                    if let Ok(mut buf) = c2.lock() {
                        buf.extend(data.iter().map(|&s| (s * i16::MAX as f32) as i16));
                    }
                },
                move |err| log!("Audio stream err: {}", err),
                None,
            )
            .map_err(|e| format!("Build stream: {}", e))?;

        stream.play().map_err(|e| format!("Start stream: {}", e))?;

        log!("Recording started");
        Ok(AudioRecorder {
            collected,
            _stream: SendStream(stream),
            sample_rate,
        })
    }

    pub fn stop(self) -> Result<(Vec<i16>, u32), String> {
        drop(self._stream);
        let data = self.collected.lock().unwrap().clone();
        let dur_s = data.len() as f64 / self.sample_rate as f64;

        log!("Recording stopped ({:.1}s, {} samples)", dur_s, data.len());

        if data.is_empty() {
            log!("WARNING: No audio data captured!");
            return Ok((vec![0i16; self.sample_rate as usize * 2], self.sample_rate));
        }

        let rms: f64 = if data.is_empty() {
            0.0
        } else {
            let sum_sq: f64 = data.iter().map(|&s| (s as f64 / i16::MAX as f64).powi(2)).sum();
            (sum_sq / data.len() as f64).sqrt()
        };
        log!("Audio RMS: {:.4}", rms);

        Ok((data, self.sample_rate))
    }
}
