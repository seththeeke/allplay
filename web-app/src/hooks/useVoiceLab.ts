import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { DecisionResponse, TranscriptionResponse, TranscriptSource } from "../models/api";
import { startRecording, type Recording } from "../voice/audioCapture";
import { useServices } from "./useServices";

export type VoiceLabPhase = "IDLE" | "RECORDING" | "TRANSCRIBING" | "SENDING";

export interface VoiceLabState {
  phase: VoiceLabPhase;
  transcript: string;
  source: TranscriptSource;
  transcription: TranscriptionResponse | null;
  reply: DecisionResponse | null;
  error: string | null;
  status: ReturnType<
    typeof useQuery<Awaited<ReturnType<ReturnType<typeof useServices>["voiceLab"]["status"]>>>
  >;
  recent: ReturnType<
    typeof useQuery<Awaited<ReturnType<ReturnType<typeof useServices>["voiceLab"]["recent"]>>>
  >;
  record(): Promise<void>;
  stop(): Promise<void>;
  type(text: string): void;
  send(): Promise<void>;
}

const message = (failure: unknown): string =>
  failure instanceof Error && failure.message !== "" ? failure.message : "Something went wrong.";

/**
 * Drives the Voice Lab (local-development.md section 5): record, transcribe on
 * the local server, edit, send to the backend, and list what it recorded.
 */
export function useVoiceLab(record: () => Promise<Recording> = startRecording): VoiceLabState {
  const { voiceLab } = useServices();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["voiceLab", "status"],
    queryFn: () => voiceLab.status(),
    retry: false,
  });
  const recent = useQuery({
    queryKey: ["voiceLab", "recent"],
    queryFn: () => voiceLab.recent(),
    retry: false,
  });
  const recording = useRef<Recording | null>(null);
  const [phase, setPhase] = useState<VoiceLabPhase>("IDLE");
  const [transcript, setTranscript] = useState("");
  const [source, setSource] = useState<TranscriptSource>("TYPED");
  const [transcription, setTranscription] = useState<TranscriptionResponse | null>(null);
  const [reply, setReply] = useState<DecisionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (failure: unknown) => {
    setError(message(failure));
    setPhase("IDLE");
  };

  return {
    phase,
    transcript,
    source,
    transcription,
    reply,
    error,
    status,
    recent,
    record: async () => {
      setError(null);
      try {
        recording.current = await record();
        setPhase("RECORDING");
      } catch (failure) {
        fail(failure);
      }
    },
    stop: async () => {
      const current = recording.current;
      if (current === null) return;
      recording.current = null;
      setPhase("TRANSCRIBING");
      try {
        const result = await voiceLab.transcribe(await current.stop());
        setTranscription(result);
        setTranscript(result.text);
        setSource(result.transcriptSource);
        setPhase("IDLE");
      } catch (failure) {
        fail(failure);
      }
    },
    type: (text) => {
      setTranscript(text);
      setSource("TYPED");
    },
    send: async () => {
      if (transcript.trim() === "") {
        setError("Say or type a command first.");
        return;
      }
      setError(null);
      setPhase("SENDING");
      try {
        setReply(await voiceLab.send(transcript.trim(), source));
        await queryClient.invalidateQueries({ queryKey: ["voiceLab", "recent"] });
        setPhase("IDLE");
      } catch (failure) {
        fail(failure);
      }
    },
  };
}
