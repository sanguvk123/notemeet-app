# NoteMeet — AI Notepad for Indian Teams

## macOS Desktop App (v1 beta)

Built with Tauri + React + Whisper + Claude.

## Quick Start

```bash
# Install prerequisites
brew install rust
npm install

# Set up Whisper and dependencies
chmod +x setup.sh
./setup.sh

# Run in development
ANTHROPIC_API_KEY=sk-ant-your-key npm run tauri dev

# Build for production
npm run tauri build
```

## Architecture

```
notemeet-app/
├── src/                    # React frontend
│   ├── App.jsx            # Main UI
│   ├── main.jsx           # Entry
│   └── styles.css         # Styles
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs        # Tauri app + commands
│   │   ├── audio.rs       # CoreAudio capture
│   │   ├── whisper.rs     # Whisper transcription
│   │   └── llm.rs         # Claude note generation
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.js
└── setup.sh
```

## v1 Features
- Mic recording
- Whisper on-device transcription (tiny.en model, ~75MB)
- Claude-generated meeting notes with action items
- Clean macOS-native UI

## Roadmap
- System audio capture (no mic needed)
- ScreenCaptureKit integration
- Calendar sync
- AI chat over history
- Android + iOS apps

## Tech
- **Desktop:** Tauri (Rust + React)
- **Audio:** CoreAudio (macOS)
- **Transcription:** Whisper (on-device)
- **Notes:** Claude API
- **Pricing:** ₹199/mo (v1 is free during beta)
