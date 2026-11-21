class JacketMicrophone extends AudioWorkletProcessor {
  samples = new Int16Array(1600);
  offset = 0;

  process(inputs) {
    for (const sample of inputs[0]?.[0] ?? []) {
      this.samples[this.offset++] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
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
