import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const worklet = readFileSync(new URL('../src/commerce/microphone.worklet.js', import.meta.url), 'utf8');

describe('Gemini microphone capture', () => {
  it.each([16000, 44100, 48000])('streams 16 kHz PCM from a %i Hz device', (sampleRate) => {
    const frames: Int16Array[] = [];
    let processor: { process(inputs: Float32Array[][]): boolean } | undefined;
    runInNewContext(worklet, {
      sampleRate,
      AudioWorkletProcessor: class {
        port = { postMessage: (buffer: ArrayBuffer) => frames.push(new Int16Array(buffer)) };
      },
      registerProcessor: (_name: string, Processor: new () => typeof processor) => {
        processor = new Processor();
      },
    });
    for (let offset = 0; offset < sampleRate / 5; offset += 128) {
      const samples = new Float32Array(Math.min(128, sampleRate / 5 - offset)).fill(0.25);
      processor!.process([[samples]]);
    }

    expect(frames).toHaveLength(2);
    expect(frames.every((frame) => frame.length === 1600)).toBe(true);
    expect(frames[1].every((sample) => sample === 8192)).toBe(true);
  });
});
