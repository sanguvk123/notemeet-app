use crate::Note;
use chrono::Utc;
use uuid::Uuid;

pub fn generate_notes(title: &str, transcript: &str, meeting_type: &str) -> Result<Note, String> {
    // v1: Use Claude API for note generation
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .unwrap_or_else(|_| "sk-ant-xxxxxxxx".to_string());

    if api_key == "sk-ant-xxxxxxxx" {
        // No API key — return mock notes for testing
        return Ok(Note {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            date: Utc::now().to_rfc3339(),
            summary: format!(
                "Discussed Q3 roadmap priorities. Key decisions made on pricing page timeline. \
                 Team alignment session with {} attendees focused on delivery milestones.",
                meeting_type
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

    // Real API call
    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 1024,
            "system": "You are a meeting notes assistant. Extract key points, decisions, and action items from the transcript. Format output as JSON with fields: summary (string), action_items (array of strings).",
            "messages": [{
                "role": "user",
                "content": format!("Meeting type: {}\n\nTranscript:\n{}\n\nGenerate structured notes.", meeting_type, transcript)
            }]
        }))
        .send()
        .map_err(|e| format!("API error: {}", e))?;

    let body: serde_json::Value = response
        .json()
        .map_err(|e| format!("Parse error: {}", e))?;

    let content = body["content"][0]["text"]
        .as_str()
        .ok_or("No response from API")?;

    let parsed: serde_json::Value = serde_json::from_str(content)
        .unwrap_or(serde_json::json!({"summary": content, "action_items": []}));

    Ok(Note {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        date: Utc::now().to_rfc3339(),
        summary: parsed["summary"].as_str().unwrap_or("").to_string(),
        action_items: parsed["action_items"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
        transcript: transcript.to_string(),
        meeting_type: meeting_type.to_string(),
    })
}
