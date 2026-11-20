// allplay-macos-speech: transcribes one WAV file with Apple's on-device speech
// recognition and writes {"text": "..."} or {"error": "..."} to an output file
// (local-development.md section 4). It is packaged as AllPlaySpeech.app and
// launched with `open`, so macOS asks for speech permission for this app
// rather than for whichever terminal started the local server.
import Foundation
import Speech

guard CommandLine.arguments.count == 3 else {
  FileHandle.standardError.write(Data("usage: allplay-macos-speech <in.wav> <out.json>\n".utf8))
  exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

func write(_ object: [String: String]) {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
  try? data.write(to: outputURL)
}

func fail(_ message: String) -> Never {
  write(["error": message])
  exit(1)
}

let authorized = DispatchSemaphore(value: 0)
var status = SFSpeechRecognizerAuthorizationStatus.notDetermined
SFSpeechRecognizer.requestAuthorization { result in
  status = result
  authorized.signal()
}
authorized.wait()
guard status == .authorized else {
  fail("Speech recognition is not authorized. Allow it in System Settings, Privacy and Security, Speech Recognition.")
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
  fail("No English speech recognizer is available.")
}
recognizer.queue = OperationQueue()

let request = SFSpeechURLRecognitionRequest(url: url)
request.shouldReportPartialResults = false
if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
request.contextualStrings = [
  "spades", "hearts", "diamonds", "clubs", "ace", "jack", "queen", "king",
  "deal", "undo", "hint", "column", "zoom", "theme", "contrast", "confirm",
]

let done = DispatchSemaphore(value: 0)
var transcript = ""
var failure: String?
recognizer.recognitionTask(with: request) { result, error in
  if let result = result, result.isFinal {
    transcript = result.bestTranscription.formattedString
    done.signal()
  } else if let error = error {
    failure = error.localizedDescription
    done.signal()
  }
}
if done.wait(timeout: .now() + 30) == .timedOut { fail("Speech recognition timed out.") }
if let failure = failure, transcript.isEmpty { fail(failure) }

write(["text": transcript])
