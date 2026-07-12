use crate::Note;
use chrono::{Local, Utc};
use uuid::Uuid;

macro_rules! log {
    ($($t:tt)*) => {
        eprintln!(
            "[NoteMeet {}] {}",
            Local::now().format("%H:%M:%S%.3f"),
            format!($($t)*)
        )
    };
}

fn load_api_key() -> String {
    if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
        return key;
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let config_path =
        std::path::PathBuf::from(home).join("NoteMeet").join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) =
            serde_json::from_str::<std::collections::HashMap<String, String>>(&content)
        {
            if let Some(key) = config.get("openrouterApiKey") {
                return key.clone();
            }
        }
    }
    String::new()
}

pub fn generate_notes(
    title: &str,
    transcript: &str,
    meeting_type: &str,
) -> Result<Note, String> {
    let api_key = load_api_key();

    if api_key.is_empty() || api_key == "sk-or-v1-xxxxxxxx" {
        log!("No valid API key — using mock notes");
        return Ok(Note {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            date: Utc::now().to_rfc3339(),
            summary: format!(
                "Discussed Q3 roadmap priorities. Key decisions made on pricing page timeline. \
                 Team alignment session focused on delivery milestones."
            ),
            action_items: vec![
                "Ananya: Finalize onboarding flow by Friday".to_string(),
                "Team: Review pricing page draft by Wednesday".to_string(),
                "Schedule follow-up for next Tuesday".to_string(),
            ],
            transcript: transcript.to_string(),
            meeting_type: meeting_type.to_string(),
        });
    }

    let system_prompt = "You are a meeting notes assistant. Extract structured information \
        from the transcript. Return ONLY valid JSON with these exact fields:\n\
        - summary: string (detailed paragraph summarizing the meeting)\n\
        - action_items: array of strings (who needs to do what by when)\n\
        Do not wrap in markdown fences. Return raw JSON only.";

    let user_prompt = format!(
        "Meeting type: {}\n\nTranscript:\n{}\n\nGenerate structured notes.",
        meeting_type, transcript
    );

    let client = reqwest::blocking::Client::new();
    log!("Calling OpenRouter...");
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://notemeet.app")
        .header("X-Title", "NoteMeet")
        .json(&serde_json::json!({
            "model": "openai/gpt-4o-mini",
            "max_tokens": 1024,
            "temperature": 0.3,
            "messages": [
                {"role": "system", "content": [{"type": "text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "text", "text": user_prompt}]}
            ]
        }))
        .send()
        .map_err(|e| format!("API error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(format!("API error ({}): {}", status, &body[..200.min(body.len())]));
    }

    let body: serde_json::Value = response
        .json()
        .map_err(|e| format!("Parse error: {}", e))?;

    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("No response from API: {}", body))?;

    let parsed: serde_json::Value = serde_json::from_str(content).unwrap_or_else(|_| {
        serde_json::json!({"summary": content, "action_items": []})
    });

    Ok(Note {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        date: Utc::now().to_rfc3339(),
        summary: parsed["summary"].as_str().unwrap_or("").to_string(),
        action_items: parsed["action_items"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        transcript: transcript.to_string(),
        meeting_type: meeting_type.to_string(),
    })
}
