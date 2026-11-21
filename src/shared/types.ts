export type BossStrategyId =
  | 'pressure'
  | 'delayed_strike'
  | 'bait_and_counter'
  | 'defensive_reset';

export const BOSS_STRATEGIES: readonly BossStrategyId[] = [
  'pressure',
  'delayed_strike',
  'bait_and_counter',
  'defensive_reset',
] as const;

export type StrategySource = 'gemini' | 'local';

export interface ExchangeSummaryPayload {
  matchId: string;
  exchangeIndex: number;
  round: number;
  recentLeftPunches: number;
  recentRightPunches: number;
  recentLeanLeftCount: number;
  recentLeanRightCount: number;
  earlyDodgeCount: number;
  playerLandedHits: number;
  playerBlockedOrWhiffed: number;
  bossLandedHits: number;
  playerDodgedStrikes: number;
  playerHealthPct: number;
  bossHealthPct: number;
  lastStrategy: BossStrategyId;
}

export interface StrategyDecisionResponse {
  matchId: string;
  exchangeIndex: number;
  strategy: BossStrategyId;
  source: StrategySource;
  confidence?: number;
  latencyMs?: number;
  reason?: string;
}

export type MatchPhase =
  | 'READY'
  | 'CALIBRATING'
  | 'FIGHTING'
  | 'PAUSED_TRACKING'
  | 'VICTORY'
  | 'DEFEAT';

export type PlayerActionState =
  | 'NEUTRAL'
  | 'LEAN_LEFT'
  | 'LEAN_RIGHT'
  | 'PUNCH_LEFT'
  | 'PUNCH_RIGHT'
  | 'HIT_STUN';

export type BossAttackSide = 'LEFT' | 'RIGHT' | 'CENTER';

export type BossState =
  | 'IDLE'
  | 'BAIT_GUARD'
  | 'WINDUP'
  | 'STRIKE_ACTIVE'
  | 'RECOVERY'
  | 'DODGING'
  | 'HIT_REACT'
  | 'KO'
  | 'VICTORY_POSE';

export type CombatEventType =
  | 'PLAYER_PUNCH_THROW'
  | 'PLAYER_PUNCH_HIT'
  | 'PLAYER_PUNCH_COUNTER_HIT'
  | 'PLAYER_PUNCH_DODGED_BY_BOSS'
  | 'PLAYER_PUNCH_BAITED'
  | 'BOSS_WINDUP_START'
  | 'BOSS_STRIKE_START'
  | 'BOSS_STRIKE_HIT_PLAYER'
  | 'PLAYER_DODGE_SUCCESS'
  | 'BOSS_RECOVERY_OPEN'
  | 'STRATEGY_APPLIED'
  | 'MATCH_VICTORY'
  | 'MATCH_DEFEAT';

export interface CombatEvent {
  type: CombatEventType;
  timestampMs: number;
  side?: 'LEFT' | 'RIGHT' | 'CENTER';
  damage?: number;
  strategy?: BossStrategyId;
  strategySource?: StrategySource;
  label?: string;
}

export type HeartRateStatus =
  | 'unsupported'
  | 'idle'
  | 'pairing'
  | 'connected'
  | 'stale'
  | 'disconnected';

export type HeartRateSourceType = 'none' | 'fitbit_ble' | 'demo';

export interface HeartRateSample {
  bpm: number;
  is16Bit: boolean;
  sensorContactSupported: boolean;
  sensorContactDetected: boolean;
  timestampMs: number;
  isDemo: boolean;
}

export type SyncedCaloriesStatus =
  | 'unconfigured'
  | 'disconnected'
  | 'idle'
  | 'loading'
  | 'synced'
  | 'awaiting_sync'
  | 'unavailable';

export interface SyncedCaloriesResponse {
  status: SyncedCaloriesStatus;
  kcal?: number;
  coveredRatio?: number;
  matchDurationSec?: number;
  message: string;
}
