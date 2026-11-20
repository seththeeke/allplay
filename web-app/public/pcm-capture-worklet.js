/* global AudioWorkletProcessor, registerProcessor */
/*
 * Copies each block of microphone samples to the main thread. The audio
 * context runs at 16 kHz, so the samples are already the rate speech to text
 * expects (action-decision.md sections 3.1 and 3.4).
 */
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
