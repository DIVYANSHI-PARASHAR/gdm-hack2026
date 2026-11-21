import type { HeartRateSample } from '../shared/types';

/** Plot recorded BPM over wall time, leaving visible gaps when the signal drops. */
export function matchHeartRatePlot(
  samples: readonly HeartRateSample[],
  startMs: number,
  endMs: number,
) {
  const readings = samples.filter(({ timestampMs }) => timestampMs >= startMs && timestampMs <= endMs);
  if (readings.length === 0) return null;

  let low = Infinity;
  let high = -Infinity;
  for (const { bpm } of readings) {
    low = Math.min(low, bpm);
    high = Math.max(high, bpm);
  }
  const minBpm = Math.floor((low - 2) / 10) * 10;
  const maxBpm = Math.ceil((high + 2) / 10) * 10;
  const duration = Math.max(1, endMs - startMs);
  const points = readings.map(({ bpm, timestampMs }) => ({
    x: 4 + (timestampMs - startMs) / duration * 312,
    y: 60 - (bpm - minBpm) / (maxBpm - minBpm) * 56,
    timestampMs,
  }));
  const path = points.map(({ x, y, timestampMs }, index) => {
    const previous = points[index - 1];
    const command = previous && timestampMs - previous.timestampMs <= 6500 ? 'L' : 'M';
    return `${command}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  return { path, points, minBpm, maxBpm };
}
