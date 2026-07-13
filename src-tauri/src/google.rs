use chrono::Local;
use oauth2::{
    basic::BasicClient, ureq as oauth2_http, AuthUrl, AuthorizationCode, ClientId,
    ClientSecret, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope, TokenResponse,
    TokenUrl,
};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;
use url::form_urlencoded;

macro_rules! log { ($($t:tt)*) => { eprintln!("[NoteMeet {}] {}", Local::now().format("%H:%M:%S%.3f"), format!($($t)*)) } }

const SCOPES: &str = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const CALENDAR_API: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

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
    std::fs::read_to_string(&path)
        .ok()
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

pub fn start_auth_flow(_app_handle: tauri::AppHandle) -> Result<String, String> {
    let cid = client_id()?;
    let cs = client_secret()?;

    let client = BasicClient::new(
        ClientId::new(cid.to_string()),
        Some(ClientSecret::new(cs.to_string())),
        AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
            .map_err(|e| format!("Bad auth URL: {}", e))?,
        Some(
            TokenUrl::new(TOKEN_URL.to_string())
                .map_err(|e| format!("Bad token URL: {}", e))?,
        ),
    );

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Local server: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Local addr: {}", e))?
        .port();
    let redirect_uri_str = format!("http://127.0.0.1:{}", port);

    let redirect_uri = RedirectUrl::new(redirect_uri_str.clone())
        .map_err(|e| format!("Bad redirect URI: {}", e))?;

    let client = client.set_redirect_uri(redirect_uri);

    let (auth_url, csrf_state) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(
            "https://www.googleapis.com/auth/calendar.readonly".to_string(),
        ))
        .add_scope(Scope::new(
            "https://www.googleapis.com/auth/calendar.events".to_string(),
        ))
        .add_scope(Scope::new(
            "https://www.googleapis.com/auth/userinfo.email".to_string(),
        ))
        .add_extra_param("access_type", "offline")
        .set_pkce_challenge(pkce_challenge)
        .url();

    log!(
        "Opening browser for Google sign-in, local server on port {}",
        port
    );
    webbrowser::open(auth_url.as_str()).map_err(|e| format!("Open browser: {}", e))?;

    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Set nonblocking: {}", e))?;
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(180);
    let mut stream = None;
    while start.elapsed() < timeout {
        match listener.accept() {
            Ok((s, _addr)) => {
                stream = Some(s);
                break;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(format!("Accept error: {}", e)),
        }
    }
    let mut stream = stream.ok_or("Authentication timed out after 180s")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .ok();

    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).map_err(|e| format!("Read: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    log!("HTTP: {}", request.lines().next().unwrap_or(""));

    let (code, returned_state) = parse_redirect(&request)?;

    if returned_state != *csrf_state.secret() {
        return Err("Security error: state mismatch — possible CSRF attack".into());
    }

    let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 94\r\n\r\n<html><body><p>Signed in! You can close this window.</p><script>window.close()</script></body></html>\r\n";
    let _ = stream.write_all(response);

    let token_result = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(pkce_verifier)
        .request(oauth2_http::http_client)
        .map_err(|e| format!("Token exchange: {}", e))?;

    let tokens = GoogleTokens {
        access_token: token_result.access_token().secret().clone(),
        refresh_token: token_result
            .refresh_token()
            .map(|t| t.secret().clone())
            .unwrap_or_default(),
        expiry: chrono::Utc::now().timestamp() as f64
            + token_result
                .expires_in()
                .map(|d| d.as_secs_f64())
                .unwrap_or(3600.0),
        scope: SCOPES.to_string(),
        token_type: "Bearer".to_string(),
    };

    save_tokens(&tokens);
    log!("OAuth complete, tokens saved");
    Ok("signed_in".into())
}

fn parse_redirect(request: &str) -> Result<(String, String), String> {
    let first_line = request.lines().next().ok_or("Empty HTTP request")?;
    let path = first_line
        .split_whitespace()
        .nth(1)
        .ok_or("No path in request")?;

    let query_str = path
        .split('?')
        .nth(1)
        .ok_or("No query string in request")?;

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;

    for (key, value) in form_urlencoded::parse(query_str.as_bytes()) {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => return Err(format!("Google returned error: {}", value)),
            _ => {}
        }
    }

    Ok((
        code.ok_or("No authorization code in redirect")?,
        state.ok_or("No state parameter in redirect")?,
    ))
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
        #[serde(rename = "dateTime")]
        date_time: Option<String>,
        date: Option<String>,
    }

    let data: CalendarApiResponse = resp.json().map_err(|e| format!("Parse error: {}", e))?;

    let events = data
        .items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let id = item.id.unwrap_or_default();
            let title = item.summary.unwrap_or_else(|| "Untitled Event".to_string());
            let (date, time) = if let Some(start) = item.start {
                if let Some(dt) = start.date_time {
                    let parsed = chrono::DateTime::parse_from_rfc3339(&dt).ok()?;
                    (
                        parsed.format("%Y-%m-%d").to_string(),
                        parsed.format("%H:%M").to_string(),
                    )
                } else if let Some(d) = start.date {
                    (d, String::new())
                } else {
                    return None;
                }
            } else {
                return None;
            };
            Some(GoogleEvent {
                id,
                title,
                date,
                time,
                source: "google".into(),
            })
        })
        .collect();

    Ok(events)
}

pub fn create_calendar_event(
    title: &str,
    date: &str,
    time: &str,
    notes: &str,
) -> Result<GoogleEvent, String> {
    let token = get_valid_token()?;

    let start_dt = if time.is_empty() {
        format!("{}", date)
    } else {
        format!("{}T{}:00", date, time)
    };

    let end_dt = if time.is_empty() {
        let next = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "Bad date".to_string())?;
        format!("{}", next + chrono::Duration::days(1))
    } else {
        let start_parsed = chrono::NaiveTime::parse_from_str(time, "%H:%M")
            .map_err(|_| "Bad time".to_string())?;
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
