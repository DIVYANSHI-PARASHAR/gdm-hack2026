import type { CombatEvent } from './types';

export function emptyCounts() {
  return { leftThrows: 0, rightThrows: 0, leftLanded: 0, rightLanded: 0, leftLeans: 0,
    rightLeans: 0, leftHits: 0, rightHits: 0, centerHits: 0, leftAvoided: 0, rightAvoided: 0, centerAvoided: 0 };
}
export type Counts = ReturnType<typeof emptyCounts>;

export function recordAction(counts: Counts, event: CombatEvent) {
  const { type, side } = event;
  if (type === 'PLAYER_DODGE_SUCCESS' || type === 'BOSS_STRIKE_HIT_PLAYER') {
    const direction = type === 'PLAYER_DODGE_SUCCESS' ? event.attackSide : side;
    if (!direction) return;
    const prefix = direction === 'LEFT' ? 'left' : direction === 'RIGHT' ? 'right' : 'center';
    counts[`${prefix}${type === 'PLAYER_DODGE_SUCCESS' ? 'Avoided' : 'Hits'}`]++;
  } else if (side === 'LEFT' || side === 'RIGHT') {
    const hand = side === 'LEFT' ? 'left' : 'right';
    if (type === 'PLAYER_PUNCH_THROW') counts[`${hand}Throws`]++;
    if (type === 'PLAYER_PUNCH_HIT' || type === 'PLAYER_PUNCH_COUNTER_HIT') counts[`${hand}Landed`]++;
    if (type === 'PLAYER_LEAN') counts[`${hand}Leans`]++;
  }
}

export function matchRates(c: Counts) {
  const row = (label: string, count: number, total: number) => ({ label, count, total });
  return [
    row('Left punches landed', c.leftLanded, c.leftThrows),
    row('Right punches landed', c.rightLanded, c.rightThrows),
    row('Rightward leans among all leans', c.rightLeans, c.leftLeans + c.rightLeans),
    ...(['left', 'right', 'center'] as const).map(side =>
      row(`Hits taken from ${side} attacks`, c[`${side}Hits`], c[`${side}Hits`] + c[`${side}Avoided`])),
  ];
}

export function parseCounts(input: unknown): Counts | null {
  if (!input || typeof input !== 'object') return null;
  const clean = emptyCounts();
  for (const key of Object.keys(clean) as (keyof Counts)[]) {
    const n = (input as Counts)[key];
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000) return null;
    clean[key] = n;
  }
  return clean.leftLanded <= clean.leftThrows && clean.rightLanded <= clean.rightThrows ? clean : null;
}
