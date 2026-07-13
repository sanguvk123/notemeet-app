use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

macro_rules! log { ($($t:tt)*) => { eprintln!("[NoteMeet {}] {}", Local::now().format("%H:%M:%S%.3f"), format!($($t)*)) } }

const SCOPES: &str = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const CALENDAR_API: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const REDIRECT_URI: &str = "http://localhost/oauth/callback";

fn client_id() -> Result<&'static str, String> {
    option_env!("GOOGLE_CLIENT_ID").ok_or_else(|| {
        "GOOGLE_CLIENT_ID not set. Set it at build time: GOOGLE_CLIENT_ID=... cargo build".into()
    })
}

fn client_secret() -> Result<&'static str, String> {
    option_env!("GOOGLE_CLIENT_SECRET").ok_or_else(|| {
        "GOOGLE_CLIENT_SECRET not set. Set it at build time: GOOGLE_CLIENT_SECRET=... cargo build".into()
    })
}

fn tokens_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join("NoteMeet").join("tokens.json")
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GoogleTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expiry: f64,
    pub scope: String,
    pub token_type: String,
}

fn load_tokens() -> Option<GoogleTokens> {
    let path = tokens_path();
    std::fs::read_to_string(&path).ok()
        .and_then(|c| serde_json::from_str(&c).ok())
}

fn save_tokens(tokens: &GoogleTokens) {
    let path = tokens_path();
    if let Ok(json) = serde_json::to_string_pretty(tokens) {
        let _ = std::fs::write(&path, json);
    }
}

fn clear_tokens() {
    let path = tokens_path();
    let _ = std::fs::remove_file(path);
}

pub fn is_signed_in() -> bool {
    load_tokens().is_some()
}

fn exchange_code(code: &str) -> Result<GoogleTokens, String> {
    let cid = client_id()?;
    let cs = client_secret()?;

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("code", code),
            ("client_id", cid),
            ("client_secret", cs),
            ("redirect_uri", REDIRECT_URI),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .map_err(|e| format!("Token exchange error: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("Token exchange failed: {}", body));
    }

    let data: serde_json::Value = resp.json().map_err(|e| format!("Parse error: {}", e))?;

    let expires_in = data["expires_in"].as_f64().unwrap_or(3600.0);
    let expiry = chrono::Utc::now().timestamp() as f64 + expires_in;

    Ok(GoogleTokens {
        access_token: data["access_token"].as_str().unwrap_or("").to_string(),
        refresh_token: data["refresh_token"].as_str().unwrap_or("").to_string(),
        expiry,
        scope: data["scope"].as_str().unwrap_or("").to_string(),
        token_type: data["token_type"].as_str().unwrap_or("Bearer").to_string(),
    })
}

fn refresh_access_token(tokens: &GoogleTokens) -> Result<GoogleTokens, String> {
    let cid = client_id()?;
    let cs = client_secret()?;

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("refresh_token", tokens.refresh_token.as_str()),
            ("client_id", cid),
            ("client_secret", cs),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| format!("Token refresh error: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("Token refresh failed: {}", body));
    }

    let data: serde_json::Value = resp.json().map_err(|e| format!("Parse error: {}", e))?;

    let expires_in = data["expires_in"].as_f64().unwrap_or(3600.0);
    let expiry = chrono::Utc::now().timestamp() as f64 + expires_in;

    let mut updated = tokens.clone();
    updated.access_token = data["access_token"].as_str().unwrap_or("").to_string();
    updated.expiry = expiry;

    save_tokens(&updated);
    Ok(updated)
}

fn get_valid_token() -> Result<String, String> {
    let tokens = load_tokens().ok_or("Not signed in")?;

    let now = chrono::Utc::now().timestamp() as f64;
    if now >= tokens.expiry - 60.0 {
        let refreshed = refresh_access_token(&tokens)?;
        Ok(refreshed.access_token)
    } else {
        Ok(tokens.access_token)
    }
}

pub fn start_auth_flow(app_handle: tauri::AppHandle) -> Result<String, String> {
    let cid = client_id()?;
    let cs = client_secret()?;

    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        AUTH_URL,
        cid,
        REDIRECT_URI,
        SCOPES.replace(' ', "%20")
    );

    let (tx, rx) = mpsc::channel::<String>();
    let parsed_url = url::Url::parse(&auth_url).map_err(|e| format!("Bad URL: {}", e))?;

    let window = tauri::WindowBuilder::new(
        &app_handle,
        "google-auth",
        tauri::WindowUrl::External(parsed_url),
    )
    .title("Sign in with Google")
    .inner_size(520.0, 680.0)
    .resizable(false)
    .center()
    .on_navigation(move |url| {
        let url_str = url.as_str();
        if url_str.starts_with(REDIRECT_URI) {
            if let Some(idx) = url_str.find("code=") {
                let after = &url_str[idx + 5..];
                let code = if let Some(amp) = after.find('&') {
                    after[..amp].to_string()
                } else {
                    after.to_string()
                };
                let _ = tx.send(code);
            }
            return false;
        }
        true
    })
    .build()
    .map_err(|e| format!("Auth window error: {}", e))?;

    match rx.recv_timeout(Duration::from_secs(180)) {
        Ok(code) => {
            let _ = window.close();
            let tokens = exchange_code(&code)?;
            save_tokens(&tokens);
            log!("OAuth complete, tokens saved");
            Ok("signed_in".into())
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = window.close();
            Err("Authentication timed out after 3 minutes".into())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Authentication cancelled".into())
        }
    }
}

pub fn sign_out() -> Result<(), String> {
    clear_tokens();
    Ok(())
}

pub fn fetch_calendar_events() -> Result<Vec<GoogleEvent>, String> {
    let token = get_valid_token()?;

    let now = chrono::Utc::now();
    let time_min = now - chrono::Duration::days(30);
    let time_max = now + chrono::Duration::days(60);

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(CALENDAR_API)
        .query(&[
            ("timeMin", time_min.to_rfc3339()),
            ("timeMax", time_max.to_rfc3339()),
            ("singleEvents", "true".to_string()),
            ("orderBy", "startTime".to_string()),
        ])
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .map_err(|e| format!("Calendar API error: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("Calendar API error: {}", body));
    }

    #[derive(Debug, Deserialize)]
    struct CalendarApiResponse {
        items: Option<Vec<CalendarItem>>,
    }

    #[derive(Debug, Deserialize)]
    struct CalendarItem {
        id: Option<String>,
        summary: Option<String>,
        start: Option<CalendarDateTime>,
    }

    #[derive(Debug, Deserialize)]
    struct CalendarDateTime {
        date_time: Option<String>,
        date: Option<String>,
    }

    let data: CalendarApiResponse = resp.json().map_err(|e| format!("Parse error: {}", e))?;

    let events = data.items.unwrap_or_default().into_iter().filter_map(|item| {
        let id = item.id.unwrap_or_default();
        let title = item.summary.unwrap_or_else(|| "Untitled Event".to_string());
        let (date, time) = if let Some(start) = item.start {
            if let Some(dt) = start.date_time {
                let parsed = chrono::DateTime::parse_from_rfc3339(&dt).ok()?;
                (parsed.format("%Y-%m-%d").to_string(), parsed.format("%H:%M").to_string())
            } else if let Some(d) = start.date {
                (d, String::new())
            } else {
                return None;
            }
        } else {
            return None;
        };
        Some(GoogleEvent { id, title, date, time, source: "google".into() })
    }).collect();

    Ok(events)
}

pub fn create_calendar_event(title: &str, date: &str, time: &str, notes: &str) -> Result<GoogleEvent, String> {
    let token = get_valid_token()?;

    let start_dt = if time.is_empty() {
        format!("{}", date)
    } else {
        format!("{}T{}:00", date, time)
    };

    let end_dt = if time.is_empty() {
        let next = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "Bad date".to_string())?;
        format!("{}", next + chrono::Duration::days(1))
    } else {
        let start_parsed = chrono::NaiveTime::parse_from_str(time, "%H:%M").map_err(|_| "Bad time".to_string())?;
        let end_parsed = start_parsed + chrono::Duration::hours(1);
        format!("{}T{}:00", date, end_parsed.format("%H:%M"))
    };

    let body = serde_json::json!({
        "summary": title,
        "description": notes,
        "start": {
            if time.is_empty() { "date" } else { "dateTime" }: start_dt,
            if time.is_empty() { "date" } else { "dateTime" }: end_dt,
        }
    });

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(CALENDAR_API)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Create event error: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("Create event error: {}", body));
    }

    let data: serde_json::Value = resp.json().map_err(|e| format!("Parse error: {}", e))?;

    Ok(GoogleEvent {
        id: data["id"].as_str().unwrap_or("").to_string(),
        title: title.to_string(),
        date: date.to_string(),
        time: time.to_string(),
        source: "google".into(),
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoogleEvent {
    pub id: String,
    pub title: String,
    pub date: String,
    pub time: String,
    pub source: String,
}

pub fn auth_status() -> Result<serde_json::Value, String> {
    let signed_in = is_signed_in();
    let mut expires_at: f64 = 0.0;
    let mut email: String = String::new();

    if signed_in {
        if let Ok(token) = get_valid_token() {
            let client = reqwest::blocking::Client::new();
            if let Ok(resp) = client
                .get("https://www.googleapis.com/oauth2/v2/userinfo")
                .header("Authorization", format!("Bearer {}", token))
                .send()
            {
                if let Ok(data) = resp.json::<serde_json::Value>() {
                    email = data["email"].as_str().unwrap_or("").to_string();
                }
            }
        }
        if let Some(tokens) = load_tokens() {
            expires_at = tokens.expiry;
        }
    }

    Ok(serde_json::json!({
        "signedIn": signed_in,
        "expiresAt": expires_at,
        "email": email,
    }))
}
