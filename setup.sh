#!/bin/bash
set -e

echo "┌─────────────────────────────────────┐"
echo "│ NoteMeet — Setup                    │"
echo "└─────────────────────────────────────┘"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

check_cmd() {
    if ! command -v "$1" &> /dev/null; then
        echo "❌ $1 not found"
        return 1
    fi
    echo "✅ $1 found"
}

check_cmd node
check_cmd npm
check_cmd rustc
check_cmd cargo

echo ""

# Install npm dependencies
echo "📦 Installing frontend dependencies..."
npm install

# Check for Tauri CLI
if ! npx tauri --version &> /dev/null; then
    echo "📦 Installing Tauri CLI..."
    npm install -D @tauri-apps/cli
fi

echo ""

# Download Whisper model
echo "🎤 Setting up Whisper..."
WHISPER_DIR="src-tauri/whisper"
MODEL="tiny.en"
MODEL_FILE="ggml-${MODEL}.bin"
MODEL_PATH="${WHISPER_DIR}/models/${MODEL_FILE}"

if [ ! -f "$MODEL_PATH" ]; then
    echo "   Downloading ${MODEL} model (~75MB)..."
    mkdir -p "${WHISPER_DIR}/models"
    curl -L -o "${MODEL_PATH}" \
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}"
    echo "   ✅ Model downloaded"
else
    echo "   ✅ Model already exists"
fi

# Build whisper.cpp if needed
if [ ! -f "${WHISPER_DIR}/whisper.cpp/main" ]; then
    echo "   Building whisper.cpp..."
    if [ ! -d "${WHISPER_DIR}/whisper.cpp" ]; then
        git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${WHISPER_DIR}/whisper.cpp"
    fi
    cd "${WHISPER_DIR}/whisper.cpp"
    make -j4
    cd ../..
    echo "   ✅ whisper.cpp built"
else
    echo "   ✅ whisper.cpp already built"
fi

echo ""
echo "┌─────────────────────────────────────┐"
echo "│ ✅ Setup complete!                  │"
echo "│                                     │"
echo "│ Run: npm run tauri dev              │"
echo "│                                     │"
echo "│ Set ANTHROPIC_API_KEY=sk-ant-...    │"
echo "│ to enable AI note generation        │"
echo "└─────────────────────────────────────┘"
