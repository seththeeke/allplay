"""
Kokoro text to speech worker for the local server (action-decision.md section 13).

Loads the model once, then answers one JSON request per stdin line,
{"id", "text", "speed", "voice"}, with one JSON line on stdout:
{"id", "wav"} (base64 16-bit mono WAV) or {"id", "error"}.
It prints {"ready": true} once the model is loaded.
"""

import base64
import io
import json
import sys
import wave

import numpy as np
from kokoro_onnx import Kokoro


def to_wav(samples, sample_rate):
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


def main():
    model, voices = sys.argv[1], sys.argv[2]
    kokoro = Kokoro(model, voices)
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            samples, sample_rate = kokoro.create(
                request["text"],
                voice=request.get("voice", "af_heart"),
                speed=float(request.get("speed", 1.0)),
                lang="en-us",
            )
            wav = base64.b64encode(to_wav(samples, sample_rate)).decode("ascii")
            print(json.dumps({"id": request.get("id"), "wav": wav}), flush=True)
        except Exception as error:  # Every failure is reported to the caller, never fatal.
            print(json.dumps({"id": request.get("id"), "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
