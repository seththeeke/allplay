/**
 * Voice output. Live mode speaks through Amazon Polly (action-decision.md
 * section 13); the prototype uses the browser's speech synthesis instead.
 */
export interface SpeechOutput {
  speak: (text: string, rate: number) => void;
}

interface BrowserSpeech {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

export function createBrowserSpeechOutput(browser: BrowserSpeech = globalThis): SpeechOutput {
  return {
    speak: (text, rate) => {
      const { speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance } = browser;
      if (synthesis === undefined || Utterance === undefined) return;
      synthesis.cancel();
      const utterance = new Utterance(text);
      utterance.rate = rate;
      synthesis.speak(utterance);
    },
  };
}

/** Plays one clip; `stop` ends it early. */
export interface Playback {
  stop: () => void;
}

export type PlayAudio = (audio: Blob) => Playback;

export const playBlob: PlayAudio = (audio) => {
  const url = URL.createObjectURL(audio);
  const element = new Audio(url);
  const release = () => {
    URL.revokeObjectURL(url);
  };
  element.addEventListener("ended", release);
  void element.play().catch(release);
  return {
    stop: () => {
      element.pause();
      release();
    },
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "blob">>;

/**
 * Speaks through the local server's text to speech (Kokoro) with
 * `POST /local/speech/synthesize` (action-decision.md section 13). Audio is
 * cached by text and rate; a new reply stops the one playing; when the server
 * cannot speak, the fallback (the browser's voice) speaks instead.
 */
export function createLocalServerSpeechOutput(
  apiUrl: string,
  fallback: SpeechOutput,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  play: PlayAudio = playBlob,
): SpeechOutput {
  const url = new URL("local/speech/synthesize", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  const cache = new Map<string, Promise<Blob>>();
  let current: Playback | null = null;
  let turn = 0;
  const audioFor = (text: string, rate: number): Promise<Blob> => {
    const key = `${String(rate)}|${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const request = fetchImpl(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, rate }),
    }).then((response) => {
      if (!response.ok) throw new Error("The local server could not speak.");
      return response.blob();
    });
    cache.set(key, request);
    request.catch(() => cache.delete(key));
    return request;
  };
  return {
    speak: (text, rate) => {
      turn += 1;
      const mine = turn;
      current?.stop();
      current = null;
      audioFor(text, rate)
        .then((audio) => {
          if (mine === turn) current = play(audio);
        })
        .catch(() => {
          if (mine === turn) fallback.speak(text, rate);
        });
    },
  };
}

/** Speaks nothing (`speechOutput: OFF`). */
export const silentSpeechOutput: SpeechOutput = { speak: () => undefined };
