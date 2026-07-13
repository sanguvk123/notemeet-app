use crate::Note;
use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! log { ($($t:tt)*) => { eprintln!("[NoteMeet {}] {}", Local::now().format("%H:%M:%S%.3f"), format!($($t)*)) } }

fn load_api_key() -> String {
    if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
        return key;
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let config_path = std::path::PathBuf::from(home).join("NoteMeet").join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<std::collections::HashMap<String, String>>(&content) {
            if let Some(key) = config.get("openrouterApiKey") {
                return key.clone();
            }
        }
    }
    std::env::var("ANTHROPIC_API_KEY").unwrap_or_else(|_| "sk-or-v1-xxxxxxxx".to_string())
}

pub fn generate_notes(title: &str, transcript: &str, meeting_type: &str) -> Result<Note, String> {
    let api_key = load_api_key();

    log!("API key present: {}...", &api_key[..12]);

    if api_key == "sk-or-v1-xxxxxxxx" || api_key == "sk-ant-xxxxxxxx" {
        return Ok(Note {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            date: Utc::now().to_rfc3339(),
            short_summary: "Team discussed Q3 roadmap and pricing timeline.".into(),
            full_summary: "Discussed Q3 roadmap priorities. Key decisions made on pricing page timeline. Team alignment session focused on delivery milestones. Ananya is finalizing the onboarding flow. Follow-up scheduled for next Tuesday.".into(),
            action_items: vec![
                "Ananya: Finalize onboarding flow by Friday".into(),
                "Team: Review pricing page draft by Wednesday".into(),
                "Schedule follow-up for next Tuesday".into(),
            ],
            promises: vec![
                "Ananya will share the onboarding mockups by EOD Thursday".into(),
            ],
            speakers: vec!["Speaker 1", "Speaker 2"]
                .into_iter().map(|s| s.to_string()).collect(),
            tone: "professional".into(),
            speaker_tone: std::collections::HashMap::new(),
            transcript: transcript.to_string(),
            meeting_type: meeting_type.to_string(),
            audio_file: String::new(),
            audio_duration_s: 0.0,
        });
    }

    let model = if api_key.starts_with("sk-or-v1") {
        "openai/gpt-4o-mini"
    } else {
        "claude-sonnet-4-20250514"
    };

    let system_prompt = "You are a meeting notes assistant. Extract structured information from the transcript. Return ONLY valid JSON with these exact fields:
- short_summary: string (1-2 sentence executive summary)
- full_summary: string (detailed paragraph summary covering all discussion points)
- action_items: array of strings (who needs to do what by when)
- promises: array of strings (commitments or promises made during the meeting)
- speakers: array of strings (list of participant names mentioned or inferred)
- tone: string (overall tone of the meeting — e.g. \"professional\", \"casual\", \"urgent\", \"tense\", \"playful\", \"strict\", \"encouraging\", \"frustrated\", or \"mixed\")
- speaker_tone: object mapping speaker names to their individual tone/emotion (e.g. \"Ananya\": \"playful, laughing\", \"Rahul\": \"firm, ordering\", \"Priya\": \"supportive, encouraging\")

Capture nuance: note if someone was laughing, joking, being sarcastic, giving orders, pleading, frustrated, or reassuring. Pay attention to tone shifts during the conversation. Handle all varieties of English (Indian, American, British, Australian, etc.) — do not flag accents as errors, just transcribe naturally.

Do not wrap in markdown fences. Return raw JSON only.";

    let user_prompt = format!(
        "Meeting type: {}\n\nTranscript:\n{}\n\nGenerate structured notes with short_summary, full_summary, action_items, promises, and speakers.",
        meeting_type, transcript
    );

    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://notemeet.app")
        .header("X-Title", "NoteMeet")
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 2048,
            "temperature": 0.3,
            "messages": [{
                "role": "system",
                "content": [{"type": "text", "text": system_prompt}]
            }, {
                "role": "user",
                "content": [{"type": "text", "text": user_prompt}]
            }]
        }))
        .send()
        .map_err(|e| format!("API error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().unwrap_or_default();
        log!("API returned {}: {}", status, &body_text[..500.min(body_text.len())]);
        return Err(format!("API error ({}): {}", status, &body_text[..200.min(body_text.len())]));
    }

    let body: serde_json::Value = response
        .json()
        .map_err(|e| format!("Parse error: {}", e))?;

    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("No response from API: {}", body))?;

    let parsed: serde_json::Value = serde_json::from_str(content)
        .unwrap_or_else(|_| {
            log!("LLM response was not valid JSON, using raw text");
            serde_json::json!({
                "short_summary": content,
                "full_summary": content,
                "action_items": [],
                "promises": [],
                "speakers": []
            })
        });

    log!("Notes: short={}chars, full={}chars, actions={}, promises={}, speakers={}",
        parsed["short_summary"].as_str().unwrap_or("").len(),
        parsed["full_summary"].as_str().unwrap_or("").len(),
        parsed["action_items"].as_array().map(|a| a.len()).unwrap_or(0),
        parsed["promises"].as_array().map(|a| a.len()).unwrap_or(0),
        parsed["speakers"].as_array().map(|a| a.len()).unwrap_or(0),
    );

    let extract_strings = |key: &str| -> Vec<String> {
        parsed[key]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default()
    };

    let speaker_tone = parsed["speaker_tone"]
        .as_object()
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(Note {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        date: Utc::now().to_rfc3339(),
        short_summary: parsed["short_summary"].as_str().unwrap_or("").to_string(),
        full_summary: parsed["full_summary"].as_str().unwrap_or("").to_string(),
        action_items: extract_strings("action_items"),
        promises: extract_strings("promises"),
        speakers: extract_strings("speakers"),
        tone: parsed["tone"].as_str().unwrap_or("professional").to_string(),
        speaker_tone,
        transcript: transcript.to_string(),
        meeting_type: meeting_type.to_string(),
        audio_file: String::new(),
        audio_duration_s: 0.0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub fn chat_about_note(note_json: &str, question: &str, history: &[ChatMessage]) -> Result<String, String> {
    let api_key = load_api_key();

    if api_key == "sk-or-v1-xxxxxxxx" || api_key == "sk-ant-xxxxxxxx" {
        return Ok("I'm sorry, the AI assistant requires a valid API key. Please set your OpenRouter API key in the config.".to_string());
    }

    let model = if api_key.starts_with("sk-or-v1") {
        "openai/gpt-4o-mini"
    } else {
        "claude-sonnet-4-20250514"
    };

    let note_summary = note_json.chars().take(2000).collect::<String>();

    let system_prompt = format!(
        "You are a helpful meeting notes assistant. You help users understand and analyze their meeting notes, including speaker tones, emotions, and conversation dynamics.

Here is the meeting note for context:
{}

When answering, reference specific tones or emotions you observe from the note (e.g., 'Ananya sounded playful when she suggested that', 'Rahul's firm tone here indicates this was a non-negotiable decision'). Handle all English accents naturally — Indian, American, British, etc. All are valid.

Answer the user's questions based on this meeting note. Be concise and helpful. If the answer is not in the note, say so.",
        note_summary
    );

    let mut messages = vec![
        serde_json::json!({
            "role": "system",
            "content": [{"type": "text", "text": system_prompt}]
        })
    ];

    for msg in history {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": [{"type": "text", "text": &msg.content}]
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": [{"type": "text", "text": question}]
    }));

    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://notemeet.app")
        .header("X-Title", "NoteMeet")
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 1024,
            "temperature": 0.3,
            "messages": messages
        }))
        .send()
        .map_err(|e| format!("Chat API error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().unwrap_or_default();
        log!("Chat API returned {}: {}", status, &body_text[..500.min(body_text.len())]);
        return Err(format!("Chat API error ({}): {}", status, &body_text[..200.min(body_text.len())]));
    }

    let body: serde_json::Value = response
        .json()
        .map_err(|e| format!("Chat parse error: {}", e))?;

    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("No chat response: {}", body))?;

    Ok(content.to_string())
}

pub fn chat_all_notes(all_notes_json: &str, question: &str, history: &[ChatMessage]) -> Result<String, String> {
    let api_key = load_api_key();

    if api_key == "sk-or-v1-xxxxxxxx" || api_key == "sk-ant-xxxxxxxx" {
        return Ok("I'm sorry, the AI assistant requires a valid API key. Please set your OpenRouter API key in the config.".to_string());
    }

    let model = if api_key.starts_with("sk-or-v1") {
        "openai/gpt-4o-mini"
    } else {
        "claude-sonnet-4-20250514"
    };

    let notes_context = all_notes_json.chars().take(6000).collect::<String>();

    let system_prompt = format!(
        "You are a helpful meeting notes assistant. You have access to ALL of the user's meeting notes (summaries, action items, participants, tones, and transcripts).

Here are all the user's notes for context:
{}

When answering questions, draw from any of these notes as relevant. Be concise and helpful. If the answer is not in any of the notes, say so clearly. If multiple notes are relevant, reference them.
Handle all English varieties naturally — Indian, American, British, etc.
",
        notes_context
    );

    let mut messages = vec![
        serde_json::json!({
            "role": "system",
            "content": [{"type": "text", "text": system_prompt}]
        })
    ];

    for msg in history {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": [{"type": "text", "text": &msg.content}]
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": [{"type": "text", "text": question}]
    }));

    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://notemeet.app")
        .header("X-Title", "NoteMeet")
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 2048,
            "temperature": 0.3,
            "messages": messages
        }))
        .send()
        .map_err(|e| format!("Chat API error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().unwrap_or_default();
        log!("Chat API returned {}: {}", status, &body_text[..500.min(body_text.len())]);
        return Err(format!("Chat API error ({}): {}", status, &body_text[..200.min(body_text.len())]));
    }

    let body: serde_json::Value = response
        .json()
        .map_err(|e| format!("Chat parse error: {}", e))?;

    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("No chat response: {}", body))?;

    Ok(content.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_message_serde_roundtrip() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "What was discussed?".to_string(),
        };
        let json = serde_json::to_string(&msg).expect("Failed to serialize");
        let deserialized: ChatMessage = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.role, "user");
        assert_eq!(deserialized.content, "What was discussed?");
    }

    #[test]
    fn test_chat_message_array_serde() {
        let messages = vec![
            ChatMessage { role: "user".into(), content: "Hello".into() },
            ChatMessage { role: "assistant".into(), content: "Hi there".into() },
        ];
        let json = serde_json::to_string(&messages).expect("Failed to serialize");
        assert!(json.contains("\"user\""));
        assert!(json.contains("\"assistant\""));
        assert!(json.contains("Hello"));
        assert!(json.contains("Hi there"));
    }

    #[test]
    fn test_generate_notes_returns_mock_without_key() {
        std::env::remove_var("OPENROUTER_API_KEY");
        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::set_var("HOME", "/tmp/notemeet_test_no_key");

        let result = generate_notes("Test Meeting", "Some transcript text", "meeting");
        assert!(result.is_ok());
        let note = result.unwrap();
        assert_eq!(note.title, "Test Meeting");
        assert!(!note.short_summary.is_empty());
        assert!(!note.full_summary.is_empty());
        assert!(!note.action_items.is_empty());
        assert_eq!(note.meeting_type, "meeting");
        assert_eq!(note.transcript, "Some transcript text");
        assert!(!note.id.is_empty());
    }

    #[test]
    fn test_chat_about_note_returns_error_without_key() {
        std::env::remove_var("OPENROUTER_API_KEY");
        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::set_var("HOME", "/tmp/notemeet_test_no_key");

        let result = chat_about_note("{}", "test question", &[]);
        assert!(result.is_ok());
        let response = result.unwrap();
        assert!(response.contains("API key"));
    }

    #[test]
    fn test_load_api_key_from_env() {
        std::env::set_var("OPENROUTER_API_KEY", "sk-or-v1-test123");
        let key = load_api_key();
        assert_eq!(key, "sk-or-v1-test123");
        std::env::remove_var("OPENROUTER_API_KEY");
    }

    #[test]
    fn test_load_api_key_fallback_when_no_env() {
        std::env::remove_var("OPENROUTER_API_KEY");
        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::set_var("HOME", "/tmp/notemeet_test_no_key");
        let key = load_api_key();
        assert!(!key.is_empty());
    }
}
