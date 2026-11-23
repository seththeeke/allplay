/**
 * Voice output. Live mode speaks through Amazon Polly (action-decision.md
 * section 13); the prototype uses the browser's speech synthesis instead.
 */
export interface SpeechOutput {
  /**
   * Speaks `text` at `rate`; voices that can choose use the player's
   * `voiceId`. `onEnd` runs once when the reply finishes, fails or is cut off.
   */
  speak: (text: string, rate: number, voiceId?: string, onEnd?: () => void) => void;
  /** Stops the current reply, for a player who talks over it. */
  stop?: () => void;
}

/** Wraps a callback so that only its first call runs. */
export const once = (callback?: () => void): (() => void) => {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback?.();
  };
};

interface BrowserSpeech {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

export function createBrowserSpeechOutput(browser: BrowserSpeech = globalThis): SpeechOutput {
  return {
    speak: (text, rate, _voiceId, onEnd) => {
      const finished = once(onEnd);
      const { speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance } = browser;
      if (synthesis === undefined || Utterance === undefined) {
        finished();
        return;
      }
      synthesis.cancel();
      const utterance = new Utterance(text);
      utterance.rate = rate;
      utterance.onend = finished;
      utterance.onerror = finished;
      synthesis.speak(utterance);
    },
    stop: () => {
      browser.speechSynthesis?.cancel();
    },
  };
}

/** Plays one clip; `stop` ends it early. */
export interface Playback {
  stop: () => void;
}

export type PlayAudio = (audio: Blob, onEnd?: () => void) => Playback;

export const playBlob: PlayAudio = (audio, onEnd) => {
  const url = URL.createObjectURL(audio);
  const element = new Audio(url);
  const release = once(() => {
    URL.revokeObjectURL(url);
    onEnd?.();
  });
  element.addEventListener("ended", release);
  element.addEventListener("error", release);
  /* A browser that blocks autoplay rejects here; the reply still counts as finished. */
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
  let finishCurrent: () => void = () => undefined;
  let turn = 0;
  const interrupt = (): void => {
    turn += 1;
    current?.stop();
    current = null;
    finishCurrent();
  };
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
    speak: (text, rate, voiceId, onEnd) => {
      interrupt();
      const mine = turn;
      const finished = once(onEnd);
      finishCurrent = finished;
      audioFor(text, rate)
        .then((audio) => {
          if (mine === turn) current = play(audio, finished);
        })
        .catch(() => {
          if (mine !== turn) return;
          if (onEnd === undefined) fallback.speak(text, rate);
          else fallback.speak(text, rate, voiceId, finished);
        });
    },
    stop: interrupt,
  };
}

/** Speaks nothing (`speechOutput: OFF`). */
export const silentSpeechOutput: SpeechOutput = {
  speak: (_text, _rate, _voiceId, onEnd) => {
    onEnd?.();
  },
};
