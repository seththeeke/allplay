import { describe, expect, it } from "vitest";
import {
  createSpeechDetector,
  FRAME_MS,
  FRAME_SAMPLES,
  type DetectorEvent,
  type SpeechDetector,
} from "../../src/voice/speechDetector";

const frame = (level: number) => new Float32Array(FRAME_SAMPLES).fill(level);
const push = (detector: SpeechDetector, level: number, ms: number): DetectorEvent[] =>
  Array.from({ length: Math.ceil(ms / FRAME_MS) }, () => detector.push(frame(level))).filter(
    (event) => event !== null,
  );

describe("speech detector", () => {
  it("marks speech after 150 ms and its end after the silence setting", () => {
    const detector = createSpeechDetector(300);
    expect(push(detector, 0.001, 300)).toEqual([]);
    expect(push(detector, 0.2, 120)).toEqual([]);
    expect(push(detector, 0.2, 400)).toEqual(["START"]);
    expect(push(detector, 0.001, 270)).toEqual([]);
    expect(push(detector, 0.001, 30)).toEqual(["END"]);
  });

  it("does not end an utterance at a pause shorter than the silence setting", () => {
    const detector = createSpeechDetector(600);
    push(detector, 0.2, 500);
    expect(push(detector, 0.001, 300)).toEqual([]);
    expect(push(detector, 0.2, 200)).toEqual([]);
    expect(push(detector, 0.001, 600)).toEqual(["END"]);
  });

  it("discards a sound too short to be an utterance", () => {
    const detector = createSpeechDetector(150);
    expect(push(detector, 0.2, 150)).toEqual(["START"]);
    expect(push(detector, 0.001, 150)).toEqual(["DISCARD"]);
  });

  it("ends continuous speech at 15 seconds", () => {
    const detector = createSpeechDetector(1200);
    expect(push(detector, 0.2, 15_000)).toEqual(["START", "END"]);
  });

  it("needs a louder voice while the game is speaking", () => {
    const detector = createSpeechDetector(300);
    push(detector, 0.005, 300);
    detector.setSpeaking(true);
    expect(push(detector, 0.02, 600)).toEqual([]);
    detector.setSpeaking(false);
    expect(push(detector, 0.02, 300)).toEqual(["START"]);
  });

  it("adapts to steady background noise and takes a new silence setting", () => {
    const detector = createSpeechDetector(1000);
    push(detector, 0.02, 600);
    expect(push(detector, 0.03, 300)).toEqual([]);
    detector.setSilenceMs(60);
    push(detector, 0.5, 400);
    expect(push(detector, 0, 60)).toEqual(["END"]);
    expect(detector.push(new Float32Array(0))).toBeNull();
  });
});
