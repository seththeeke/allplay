/** 16-bit mono PCM WAV, the audio format of every local speech route (action-decision.md section 3.4). */

/** Wraps raw 16-bit little-endian mono PCM in a 44-byte WAV header. */
export function wavFromPcm(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}

export interface Pcm {
  samples: Uint8Array;
  sampleRate: number;
}

/**
 * The PCM samples of a WAV file, walking its chunks to `data`. Only 16-bit
 * mono PCM is accepted; anything else returns null.
 */
export function pcmFromWav(wav: Uint8Array): Pcm | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (offset: number) => String.fromCharCode(...wav.slice(offset, offset + 4));
  if (wav.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return null;
  let format: { pcm: boolean; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = ascii(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      if (body + 16 > wav.length) return null;
      format = {
        pcm: view.getUint16(body, true) === 1,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (format === null || !format.pcm || format.channels !== 1 || format.bits !== 16)
        return null;
      return {
        samples: wav.slice(body, Math.min(body + size, wav.length)),
        sampleRate: format.sampleRate,
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}
