use std::io::Cursor;

pub fn transcribe(audio_data: &[i16]) -> Result<String, String> {
    // v1: Use whisper.cpp via command line
    // For now, return placeholder text for testing
    let sample_count = audio_data.len();
    if sample_count < 100 {
        return Ok("[No audio detected]".to_string());
    }

    // TODO: Replace with actual Whisper inference
    // Steps:
    // 1. Convert i16 PCM to WAV format
    // 2. Write to temp file
    // 3. Call whisper.cpp CLI: `whisper --model tiny.en temp.wav`
    // 4. Read stdout for transcript
    //
    // whisper.cpp: https://github.com/ggerganov/whisper.cpp
    // Install: brew install whisper-cpp
    // Download model: whisper.cpp/models/download-ggml-model.sh tiny.en

    Ok(vec![
        "Welcome to the team meeting. Let's go over the Q3 roadmap.",
        "We need to finalize the pricing page before the launch.",
        "Ananya is working on the onboarding flow, should be done by Friday.",
        "The demo with Northwind is scheduled for next Tuesday.",
        "Let's set up a follow-up to review the action items.",
    ].join(" "))
}
