class JacketMicrophone extends AudioWorkletProcessor {
  samples = new Int16Array(1600);
  offset = 0;
  phase = 0;
  sum = 0;
  count = 0;

  process(inputs) {
    for (const sample of inputs[0]?.[0] ?? []) {
      this.sum += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase %= sampleRate;
      const averaged = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      this.samples[this.offset++] = Math.round(Math.max(-1, Math.min(1, averaged)) * 32767);
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1600);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('jacket-microphone', JacketMicrophone);
