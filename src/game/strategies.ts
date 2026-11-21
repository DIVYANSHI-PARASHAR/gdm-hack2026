import {
  BOSS_STRATEGIES,
  BossStrategyId,
  ExchangeSummaryPayload,
} from '../shared/types';

export interface StrategyParameters {
  id: BossStrategyId;
  displayName: string;
  description: string;
  idleDurationMs: number;
  windupDurationMs: number;
  strikeWindowMs: number;
  recoveryDurationMs: number;
  neutralDodgeChance: number;
  useBaitStance: boolean;
  baitDurationMs: number;
  strikeDamage: number;
  comboStrikes: number;
}

export const STRATEGY_PARAMS: Record<BossStrategyId, StrategyParameters> = {
  pressure: {
    id: 'pressure',
    displayName: 'PRESSURE OVERDRIVE',
    description: 'Rapid combinations and short idle gaps to overwhelm passive play.',
    idleDurationMs: 780,
    windupDurationMs: 680,
    strikeWindowMs: 240,
    recoveryDurationMs: 1150,
    neutralDodgeChance: 0.22,
    useBaitStance: false,
    baitDurationMs: 0,
    strikeDamage: 13,
    comboStrikes: 2,
  },
  delayed_strike: {
    id: 'delayed_strike',
    displayName: 'DELAYED HEAVY',
    description: 'Extended variable windup to catch early dodges with heavy impact.',
    idleDurationMs: 980,
    windupDurationMs: 1180,
    strikeWindowMs: 260,
    recoveryDurationMs: 1450,
    neutralDodgeChance: 0.25,
    useBaitStance: false,
    baitDurationMs: 0,
    strikeDamage: 19,
    comboStrikes: 1,
  },
  bait_and_counter: {
    id: 'bait_and_counter',
    displayName: 'BAIT & COUNTER',
    description: 'High-voltage counter guard that punishes aggressive punch spam.',
    idleDurationMs: 720,
    windupDurationMs: 620,
    strikeWindowMs: 240,
    recoveryDurationMs: 1300,
    neutralDodgeChance: 0.18,
    useBaitStance: true,
    baitDurationMs: 920,
    strikeDamage: 16,
    comboStrikes: 1,
  },
  defensive_reset: {
    id: 'defensive_reset',
    displayName: 'DEFENSIVE RESET',
    description: 'Evasive footwork and measured spacing to stabilize low armor.',
    idleDurationMs: 1150,
    windupDurationMs: 780,
    strikeWindowMs: 220,
    recoveryDurationMs: 980,
    neutralDodgeChance: 0.48,
    useBaitStance: false,
    baitDurationMs: 0,
    strikeDamage: 12,
    comboStrikes: 1,
  },
};

export function isValidStrategy(value: unknown): value is BossStrategyId {
  return (
    typeof value === 'string' &&
    (BOSS_STRATEGIES as readonly string[]).includes(value)
  );
}

/**
 * Deterministic local fallback AI strategy selector.
 * Used when GEMINI_API_KEY is missing, network fails, or response arrives too late.
 */
export function selectLocalStrategy(summary: ExchangeSummaryPayload): {
  strategy: BossStrategyId;
  reason: string;
} {
  const totalPunches = summary.recentLeftPunches + summary.recentRightPunches;
  const totalLeans = summary.recentLeanLeftCount + summary.recentLeanRightCount;

  if (summary.bossHealthPct <= 30 && summary.lastStrategy !== 'defensive_reset') {
    return {
      strategy: 'defensive_reset',
      reason: 'Boss core integrity low; shifting to evasive spacing.',
    };
  }

  if (totalPunches >= 5 && summary.lastStrategy !== 'bait_and_counter') {
    return {
      strategy: 'bait_and_counter',
      reason: 'High player punch volume detected; deploying counter guard.',
    };
  }

  if (
    (summary.earlyDodgeCount >= 2 || totalLeans >= 4) &&
    summary.lastStrategy !== 'delayed_strike'
  ) {
    return {
      strategy: 'delayed_strike',
      reason: 'Frequent player leans detected; delaying strike timing.',
    };
  }

  if (totalPunches <= 1 && summary.lastStrategy !== 'pressure') {
    return {
      strategy: 'pressure',
      reason: 'Passive player rhythm; pressing with rapid combo.',
    };
  }

  // Deterministic rotation so boss stays varied and readable
  const order: BossStrategyId[] = [
    'pressure',
    'delayed_strike',
    'bait_and_counter',
    'defensive_reset',
  ];
  const idx = (summary.exchangeIndex + summary.round) % order.length;
  const candidate = order[idx];
  return {
    strategy: candidate,
    reason: `Deterministic tactical cycle (exchange #${summary.exchangeIndex}).`,
  };
}
