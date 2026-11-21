import { describe, expect, it } from 'vitest';
import type { HeartRateSample } from '../src/shared/types';
import { matchHeartRatePlot } from '../src/ble/matchHeartRatePlot';

function sample(timestampMs: number, bpm: number): HeartRateSample {
  return { timestampMs, bpm, is16Bit: false, isDemo: false, sensorContactSupported: true, sensorContactDetected: true };
}

describe('match heart rate chart', () => {
  it('uses real sample times and leaves a gap when readings go stale', () => {
    const plot = matchHeartRatePlot([
      sample(0, 240), sample(1000, 80), sample(2000, 100), sample(9000, 130),
    ], 1000, 9000);
    expect(plot?.minBpm).toBe(70);
    expect(plot?.maxBpm).toBe(140);
    expect(plot?.points.map(({ x }) => x)).toEqual([4, 43, 316]);
    expect(plot?.path.match(/[ML]/g)).toEqual(['M', 'L', 'M']);
  });

  it('handles a single reading and missing data', () => {
    expect(matchHeartRatePlot([], 1000, 1000)).toBeNull();
    const plot = matchHeartRatePlot([sample(1000, 80)], 1000, 1000);
    expect(plot?.points).toEqual([{ x: 4, y: 32, timestampMs: 1000 }]);
  });
});
