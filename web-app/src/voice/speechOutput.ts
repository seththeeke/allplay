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
