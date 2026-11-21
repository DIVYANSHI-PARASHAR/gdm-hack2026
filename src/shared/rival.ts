import { isValidStrategy } from '../game/strategies';

export const RIVAL_CUES = [
  'feint_then_pause', 'repeated_sequence', 'early_lean', 'rapid_burst', 'long_pause', 'unclear',
] as const;
export const RIVAL_CLIP_MS = 2200;
export const RIVAL_CLIP_MAX_BYTES = 300_000;

export function parseObservation(value: unknown) {
  const data = value as { cue?: unknown; timestampMs?: unknown } | null;
  const cue = RIVAL_CUES.find((candidate) => candidate === data?.cue);
  const timestampMs = data?.timestampMs;
  if (!cue || typeof timestampMs !== 'number' || !Number.isInteger(timestampMs) ||
      timestampMs < 0 || timestampMs > RIVAL_CLIP_MS) return null;
  return { cue, timestampMs };
}

export function parseRoundPlan(value: unknown) {
  const data = value as { pattern?: unknown; preferredStrategy?: unknown } | null;
  const pattern = RIVAL_CUES.find((candidate) => candidate !== 'unclear' && candidate === data?.pattern);
  if (!pattern || !isValidStrategy(data?.preferredStrategy)) return null;
  return { pattern, preferredStrategy: data.preferredStrategy };
}

export function parseRivalContext(value: unknown) {
  const data = value as { observation?: unknown; plan?: unknown } | null;
  return { observation: parseObservation(data?.observation), plan: parseRoundPlan(data?.plan) };
}
