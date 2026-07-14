use chrono::Local;
use std::collections::HashSet;
use std::ffi::c_void;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

macro_rules! log {
    ($($t:tt)*) => {
        eprintln!(
            "[NoteMeet {}] {}",
            Local::now().format("%H:%M:%S%.3f"),
            format!($($t)*)
        )
    };
}

// ============ CoreAudio FFI ============

#[repr(C)]
#[derive(Clone, Copy)]
struct AudioObjectPropertyAddress {
    mSelector: u32,
    mScope: u32,
    mElement: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectAddPropertyListener(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inListener: extern "C" fn(
            inObjectID: u32,
            inNumberAddresses: u32,
            inAddresses: *const AudioObjectPropertyAddress,
            inClientData: *mut c_void,
        ) -> i32,
        inClientData: *mut c_void,
    ) -> i32;

    fn AudioObjectGetPropertyDataSize(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inQualifierDataSize: u32,
        inQualifierData: *const c_void,
        outDataSize: *mut u32,
    ) -> i32;

    fn AudioObjectGetPropertyData(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inQualifierDataSize: u32,
        inQualifierData: *const c_void,
        ioDataSize: *mut u32,
        outData: *mut c_void,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRunLoopRun();
}

const fn fourcc(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
}

const K_AUDIO_OBJECT_SYSTEM_OBJECT: u32 = 1;
const K_AUDIO_HARDWARE_PROPERTY_DEVICES: u32 = fourcc(b"dev#");
const K_AUDIO_DEVICE_PROPERTY_DEVICE_IS_RUNNING: u32 = fourcc(b"iron");
const K_AUDIO_DEVICE_PROPERTY_DEVICE_IS_RUNNING_SOMEWHERE: u32 = fourcc(b"any ");
const K_AUDIO_DEVICE_PROPERTY_STREAM_CONFIGURATION: u32 = fourcc(b"slay");
const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = fourcc(b"glob");
const K_AUDIO_OBJECT_PROPERTY_SCOPE_INPUT: u32 = fourcc(b"inpt");
const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MASTER: u32 = 1;

// ============ Shared state ============

struct DetectorData {
    app_handle: tauri::AppHandle,
    last_trigger: Mutex<Option<Instant>>,
}

static DISMISS_SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn dismissed_set() -> &'static Mutex<HashSet<String>> {
    DISMISS_SET.get_or_init(|| Mutex::new(HashSet::new()))
}

// ============ CoreAudio helpers ============

fn get_all_device_ids() -> Vec<u32> {
    let address = AudioObjectPropertyAddress {
        mSelector: K_AUDIO_HARDWARE_PROPERTY_DEVICES,
        mScope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        mElement: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MASTER,
    };

    let mut size: u32 = 0;
    unsafe {
        AudioObjectGetPropertyDataSize(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &address,
            0,
            std::ptr::null(),
            &mut size,
        );
    }

    if size == 0 {
        return Vec::new();
    }

    let count = (size / std::mem::size_of::<u32>() as u32) as usize;
    let mut devices = vec![0u32; count];

    unsafe {
        AudioObjectGetPropertyData(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            devices.as_mut_ptr() as *mut c_void,
        );
    }

    devices
}

fn device_has_input(device_id: u32) -> bool {
    let address = AudioObjectPropertyAddress {
        mSelector: K_AUDIO_DEVICE_PROPERTY_STREAM_CONFIGURATION,
        mScope: K_AUDIO_OBJECT_PROPERTY_SCOPE_INPUT,
        mElement: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MASTER,
    };

    let mut size: u32 = 0;
    unsafe {
        let status = AudioObjectGetPropertyDataSize(
            device_id,
            &address,
            0,
            std::ptr::null(),
            &mut size,
        );
        if status != 0 {
            return false;
        }
    }

    size > 4
}

fn is_device_running_somewhere(device_id: u32) -> bool {
    let address = AudioObjectPropertyAddress {
        mSelector: K_AUDIO_DEVICE_PROPERTY_DEVICE_IS_RUNNING_SOMEWHERE,
        mScope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        mElement: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MASTER,
    };

    let mut is_running: u32 = 0;
    let mut size: u32 = std::mem::size_of::<u32>() as u32;
    unsafe {
        let status = AudioObjectGetPropertyData(
            device_id,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            &mut is_running as *mut u32 as *mut c_void,
        );
        if status != 0 {
            return false;
        }
    }
    is_running != 0
}

fn any_input_device_running() -> bool {
    let devices = get_all_device_ids();
    for dev in &devices {
        if device_has_input(*dev) && is_device_running_somewhere(*dev) {
            return true;
        }
    }
    false
}

fn register_listeners(cb_ptr: *mut c_void) {
    let devices = get_all_device_ids();
    let mut input_count = 0;

    let address = AudioObjectPropertyAddress {
        mSelector: K_AUDIO_DEVICE_PROPERTY_DEVICE_IS_RUNNING_SOMEWHERE,
        mScope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        mElement: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MASTER,
    };

    for &device_id in &devices {
        if !device_has_input(device_id) {
            continue;
        }
        input_count += 1;

        unsafe {
            let status = AudioObjectAddPropertyListener(
                device_id,
                &address,
                input_device_state_changed,
                cb_ptr,
            );
            if status != 0 {
                log!("Failed to register listener on device {}: err={}", device_id, status);
            }
        }
    }

    log!("Registered listeners on {} input devices ({} total)", input_count, devices.len());
}

// ============ Callbacks ============

extern "C" fn input_device_state_changed(
    object_id: u32,
    _num_addresses: u32,
    _addresses: *const AudioObjectPropertyAddress,
    client_data: *mut c_void,
) -> i32 {
    let data = unsafe { &*(client_data as *const DetectorData) };

    // Only care about input devices
    if !device_has_input(object_id) {
        return 0;
    }

    // Only trigger when device IS running
    if !is_device_running_somewhere(object_id) {
        return 0;
    }

    // Debounce: 30s cooldown
    {
        let last = data.last_trigger.lock().unwrap();
        if let Some(time) = *last {
            if time.elapsed() < Duration::from_secs(30) {
                return 0;
            }
        }
    }

    log!("Mic activated on device {} — checking for meeting apps", object_id);

    trigger_detection(data);
    0
}

fn trigger_detection(data: &DetectorData) {
    if let Some(app_name) = identify_meeting_app() {
        let dismissed = dismissed_set().lock().unwrap();
        if dismissed.contains(&app_name) {
            return;
        }
        drop(dismissed);

        {
            let mut last = data.last_trigger.lock().unwrap();
            *last = Some(Instant::now());
        }

        log!("Meeting detected: {}", app_name);
        let _ = data.app_handle.emit_all(
            "meeting-detected",
            serde_json::json!({ "app": app_name }),
        );
    }
}

extern "C" fn device_list_changed(
    _object_id: u32,
    _num_addresses: u32,
    _addresses: *const AudioObjectPropertyAddress,
    client_data: *mut c_void,
) -> i32 {
    log!("Audio device list changed — re-registering listeners");
    register_listeners(client_data);
    0
}

// ============ Process identification (one-shot) ============

fn identify_meeting_app() -> Option<String> {
    let detected = get_detected_meetings();
    if detected.is_empty() {
        return None;
    }

    let priorities = [
        "Google Meet",
        "Zoom",
        "Microsoft Teams",
        "Cisco Webex",
        "GoTo Meeting",
    ];

    for app in &priorities {
        if detected.iter().any(|d| d == app) {
            return Some(app.to_string());
        }
    }

    detected.into_iter().next()
}

fn get_detected_meetings() -> Vec<String> {
    let mut found: Vec<String> = Vec::new();

    if let Ok(output) = Command::new("ps").arg("aux").output() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();

        if stdout.contains("cphost") || stdout.contains("zoom.us/app") {
            found.push("Zoom".to_string());
        }
        if stdout.contains("microsoft teams") || stdout.contains("msteams") {
            found.push("Microsoft Teams".to_string());
        }
        if stdout.contains("webex") || stdout.contains("atmgr") {
            found.push("Cisco Webex".to_string());
        }
        if stdout.contains("gotomeeting") || stdout.contains("g2m") {
            found.push("GoTo Meeting".to_string());
        }
    }

    for (_, script) in get_browser_scripts() {
        if let Ok(output) = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
        {
            if !output.status.success() {
                continue;
            }
            let text = String::from_utf8_lossy(&output.stdout).to_lowercase();

            if text.contains("meet.google.com") || text.contains("google meet") {
                found.push("Google Meet".to_string());
            }
            if text.contains("zoom.us") && !found.contains(&"Zoom".to_string()) {
                found.push("Zoom".to_string());
            }
            if text.contains("webex.com") && !found.contains(&"Cisco Webex".to_string()) {
                found.push("Cisco Webex".to_string());
            }
            if text.contains("teams.microsoft.com")
                && !found.contains(&"Microsoft Teams".to_string())
            {
                found.push("Microsoft Teams".to_string());
            }
        }
    }

    found.sort();
    found.dedup();
    found
}

fn get_browser_scripts() -> Vec<(&'static str, String)> {
    vec![
        ("chrome", "tell application \"Google Chrome\" to get title of active tab of every window".into()),
        ("edge", "tell application \"Microsoft Edge\" to get title of active tab of every window".into()),
        ("safari", "tell application \"Safari\" to get URL of current tab of every window".into()),
        ("brave", "tell application \"Brave Browser\" to get title of active tab of every window".into()),
    ]
}

// ============ Public API ============

pub fn start_detector(app_handle: tauri::AppHandle) {
    let data = Box::new(DetectorData {
        app_handle: app_handle.clone(),
        last_trigger: Mutex::new(None),
    });
    let cb_ptr = Box::into_raw(data) as *mut c_void;
    let cb_addr = cb_ptr as usize;

    std::thread::spawn(move || {
        let cb_ptr = cb_addr as *mut c_void;
        log!("Starting meeting detector (CoreAudio listener + lightweight poll)...");

        register_listeners(cb_ptr);

        let devlist_address = AudioObjectPropertyAddress {
            mSelector: K_AUDIO_HARDWARE_PROPERTY_DEVICES,
            mScope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            mElement: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MASTER,
        };

        unsafe {
            let status = AudioObjectAddPropertyListener(
                K_AUDIO_OBJECT_SYSTEM_OBJECT,
                &devlist_address,
                device_list_changed,
                cb_ptr,
            );
            if status != 0 {
                log!("Failed to register device-list listener: err={}", status);
            }
        }

        // Initial check: if a meeting app is already running
        {
            log!("Checking for running meeting apps on startup...");
            let data = unsafe { &*(cb_ptr as *const DetectorData) };
            trigger_detection(data);
        }

        // Primary detection: process check every 30s (reliable across all apps)
        // Secondary: CoreAudio event listener (instant when supported)
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(30));
                let data = unsafe { &*(cb_addr as *const DetectorData) };

                // Debounce check
                let in_cooldown = {
                    let last = data.last_trigger.lock().unwrap();
                    if let Some(time) = *last {
                        time.elapsed() < Duration::from_secs(120)
                    } else {
                        false
                    }
                };

                if !in_cooldown {
                    trigger_detection(data);
                }
            }
        });

        log!("Detector active — process check (30s) + CoreAudio listener");

        unsafe { CFRunLoopRun(); }
    });
}

#[tauri::command]
pub fn dismiss_meeting_detection(app_name: String) {
    log!("Meeting detection dismissed for: {}", app_name);
    dismissed_set().lock().unwrap().insert(app_name);
}

#[tauri::command]
pub fn reset_detection_cooldown() {
    log!("Detection dismiss list cleared");
    dismissed_set().lock().unwrap().clear();
}
