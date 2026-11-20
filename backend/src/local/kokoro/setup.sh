#!/bin/sh
# Sets up Kokoro text to speech for the local server (local-development.md section 4):
# a Python virtual environment with kokoro-onnx, and the v1.0 model and voices.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HERE/../../../.local/kokoro"
RELEASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
mkdir -p "$DIR"
python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install --quiet --upgrade pip
"$DIR/venv/bin/pip" install --quiet "kokoro-onnx==0.6.1"
for FILE in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ ! -s "$DIR/$FILE" ]; then
    curl -L --fail -o "$DIR/$FILE.part" "$RELEASE/$FILE"
    mv "$DIR/$FILE.part" "$DIR/$FILE"
  fi
done
echo "Kokoro is ready in $DIR"
