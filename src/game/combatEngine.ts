import {
  BossAttackSide,
  BossState,
  BossStrategyId,
  CombatEvent,
  ExchangeSummaryPayload,
  MatchPhase,
  PlayerActionState,
  StrategyDecisionResponse,
  StrategySource,
} from '../shared/types';
import {
  isValidStrategy,
  selectLocalStrategy,
  STRATEGY_PARAMS,
  StrategyParameters,
} from './strategies';

export interface CombatEngineOptions {
  rng?: () => number;
  onEvent?: (event: CombatEvent) => void;
  onExchangeSummary?: (summary: ExchangeSummaryPayload) => void;
}

export interface CombatSnapshot {
  matchId: string;
  phase: MatchPhase;
  matchStartWallMs: number | null;
  matchEndWallMs: number | null;
  elapsedFightMs: number;
  round: number;
  exchangeIndex: number;

  playerHp: number;
  playerMaxHp: number;
  playerState: PlayerActionState;
  playerLean: 'LEFT' | 'RIGHT' | 'NONE';
  playerPunchSide: 'LEFT' | 'RIGHT' | null;
  playerPunchProgress: number; // 0..1

  bossHp: number;
  bossMaxHp: number;
  bossState: BossState;
  bossStateProgress: number; // 0..1
  bossAttackSide: BossAttackSide;
  bossDodgeSide: 'LEFT' | 'RIGHT';
  bossHitSide: 'LEFT' | 'RIGHT';
  bossComboRemaining: number;

  activeStrategy: BossStrategyId;
  activeStrategySource: StrategySource;
  activeStrategyConfidence?: number;
  activeStrategyReason: string;
  staleResponsesDiscarded: number;

  stats: {
    totalPunchesThrown: number;
    leftPunchesThrown: number;
    rightPunchesThrown: number;
    punchesLanded: number;
    counterHitsLanded: number;
    dodgesSucceeded: number;
    hitsTaken: number;
  };
}

const PLAYER_MAX_HP = 100;
const BOSS_MAX_HP = 100;
const PUNCH_DURATION_MS = 230;
const PUNCH_COOLDOWN_MS = 240;
const PLAYER_HIT_STUN_MS = 280;
const LEAN_GRACE_MS = 150;
const BOSS_DODGE_DURATION_MS = 360;
const BOSS_DODGE_COOLDOWN_MS = 1450;
const BOSS_HIT_REACT_MS = 270;
const MAX_PUNISH_HITS_PER_OPENING = 2;

export class CombatEngine {
  private rng: () => number;
  private onEvent?: (event: CombatEvent) => void;
  private onExchangeSummary?: (summary: ExchangeSummaryPayload) => void;

  private matchId = this.createMatchId();
  private phase: MatchPhase = 'READY';
  private nowMs = 0;
  private matchStartWallMs: number | null = null;
  private matchEndWallMs: number | null = null;
  private elapsedFightMs = 0;

  private round = 1;
  private exchangeIndex = 0;

  // Player state
  private playerHp = PLAYER_MAX_HP;
  private playerState: PlayerActionState = 'NEUTRAL';
  private heldLean: 'LEFT' | 'RIGHT' | 'NONE' = 'NONE';
  private lastLeanDir: 'LEFT' | 'RIGHT' | 'NONE' = 'NONE';
  private lastLeanTimestampMs = -9999;
  private punchSide: 'LEFT' | 'RIGHT' | null = null;
  private punchTimerMs = 0;
  private punchCooldownMs = 0;
  private playerHitStunMs = 0;

  // Boss state
  private bossHp = BOSS_MAX_HP;
  private bossState: BossState = 'IDLE';
  private bossStateTimerMs = 900;
  private bossStateDurationMs = 900;
  private bossAttackSide: BossAttackSide = 'CENTER';
  private bossDodgeSide: 'LEFT' | 'RIGHT' = 'LEFT';
  private bossHitSide: 'LEFT' | 'RIGHT' = 'LEFT';
  private bossDodgeCooldownMs = 0;
  private bossComboRemaining = 0;
  private strikeResolved = false;
  private punishHitsThisOpening = 0;
  private returnStateAfterHitReact: 'IDLE' | 'RECOVERY' = 'IDLE';
  private recoveryRemainderMs = 0;
  private summaryDispatchedForExchange = -1;

  // Strategy management
  private activeStrategy: BossStrategyId = 'pressure';
  private activeStrategySource: StrategySource = 'local';
  private activeStrategyConfidence?: number;
  private activeStrategyReason = 'Opening tactical preset.';
  private lastResolvedStrategyExchange = 0;
  private queuedDecision: StrategyDecisionResponse | null = null;
  private lastExchangeSummary: ExchangeSummaryPayload | null = null;
  private staleResponsesDiscarded = 0;

  // Recent rolling telemetry (per exchange window)
  private recentLeftPunches = 0;
  private recentRightPunches = 0;
  private recentLeanLeftCount = 0;
  private recentLeanRightCount = 0;
  private earlyDodgeCount = 0;
  private recentPlayerLanded = 0;
  private recentPlayerWhiffed = 0;
  private recentBossLanded = 0;
  private recentPlayerDodged = 0;

  // Match lifetime stats
  private stats = {
    totalPunchesThrown: 0,
    leftPunchesThrown: 0,
    rightPunchesThrown: 0,
    punchesLanded: 0,
    counterHitsLanded: 0,
    dodgesSucceeded: 0,
    hitsTaken: 0,
  };

  constructor(options: CombatEngineOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.onEvent = options.onEvent;
    this.onExchangeSummary = options.onExchangeSummary;
  }

  private createMatchId(): string {
    return `match-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  public startMatch(wallClockMs: number = Date.now()): void {
    this.matchId = this.createMatchId();
    this.phase = 'FIGHTING';
    this.nowMs = 0;
    this.elapsedFightMs = 0;
    this.matchStartWallMs = wallClockMs;
    this.matchEndWallMs = null;

    this.round = 1;
    this.exchangeIndex = 1;

    this.playerHp = PLAYER_MAX_HP;
    this.playerState = 'NEUTRAL';
    this.heldLean = 'NONE';
    this.lastLeanDir = 'NONE';
    this.lastLeanTimestampMs = -9999;
    this.punchSide = null;
    this.punchTimerMs = 0;
    this.punchCooldownMs = 0;
    this.playerHitStunMs = 0;

    this.bossHp = BOSS_MAX_HP;
    this.activeStrategy = 'pressure';
    this.activeStrategySource = 'local';
    this.activeStrategyConfidence = undefined;
    this.activeStrategyReason = 'Opening round engagement.';
    this.lastResolvedStrategyExchange = 0;
    this.queuedDecision = null;
    this.lastExchangeSummary = null;
    this.staleResponsesDiscarded = 0;
    this.summaryDispatchedForExchange = 0;

    this.resetRecentWindow();
    this.stats = {
      totalPunchesThrown: 0,
      leftPunchesThrown: 0,
      rightPunchesThrown: 0,
      punchesLanded: 0,
      counterHitsLanded: 0,
      dodgesSucceeded: 0,
      hitsTaken: 0,
    };

    this.bossDodgeCooldownMs = 0;
    this.bossComboRemaining = 0;
    this.punishHitsThisOpening = 0;
    this.enterBossState('IDLE', 1050);
  }

  public setCalibrating(): void {
    if (
      this.phase === 'READY' ||
      this.phase === 'VICTORY' ||
      this.phase === 'DEFEAT'
    ) {
      this.phase = 'CALIBRATING';
    }
  }

  public cancelCalibration(): void {
    if (this.phase === 'CALIBRATING') {
      this.phase = 'READY';
    }
  }

  public pauseForTrackingLoss(): void {
    if (this.phase === 'FIGHTING') {
      this.phase = 'PAUSED_TRACKING';
      this.heldLean = 'NONE';
    }
  }

  public resumeFromTrackingLoss(): void {
    if (this.phase === 'PAUSED_TRACKING') {
      this.phase = 'FIGHTING';
    }
  }

  public setLean(direction: 'LEFT' | 'RIGHT' | 'NONE'): void {
    if (this.phase !== 'FIGHTING') {
      this.heldLean = 'NONE';
      return;
    }

    const prev = this.heldLean;
    if (prev === direction) return;

    // Detect early lean release during windup (before strike active window)
    if (
      prev !== 'NONE' &&
      direction === 'NONE' &&
      this.bossState === 'WINDUP' &&
      this.bossStateTimerMs > 160
    ) {
      this.earlyDodgeCount += 1;
    }

    if (direction !== 'NONE') this.emit({ type: 'PLAYER_LEAN', timestampMs: this.nowMs, side: direction });
    this.heldLean = direction;
    if (direction === 'LEFT') {
      this.recentLeanLeftCount += 1;
      this.lastLeanDir = 'LEFT';
      this.lastLeanTimestampMs = this.nowMs;
    } else if (direction === 'RIGHT') {
      this.recentLeanRightCount += 1;
      this.lastLeanDir = 'RIGHT';
      this.lastLeanTimestampMs = this.nowMs;
    }

    this.syncPlayerActionState();
  }

  public throwPunch(side: 'LEFT' | 'RIGHT'): boolean {
    if (this.phase !== 'FIGHTING') return false;
    if (this.playerHitStunMs > 0 || this.punchCooldownMs > 0) return false;

    this.punchSide = side;
    this.punchTimerMs = PUNCH_DURATION_MS;
    this.punchCooldownMs = PUNCH_COOLDOWN_MS;
    // Throwing a punch commits upper body back to center stance
    this.heldLean = 'NONE';
    this.syncPlayerActionState();

    this.stats.totalPunchesThrown += 1;
    if (side === 'LEFT') {
      this.stats.leftPunchesThrown += 1;
      this.recentLeftPunches += 1;
    } else {
      this.stats.rightPunchesThrown += 1;
      this.recentRightPunches += 1;
    }

    this.emit({
      type: 'PLAYER_PUNCH_THROW',
      timestampMs: this.nowMs,
      side,
    });

    this.resolvePlayerPunch(side);
    return true;
  }

  /**
   * Queues an async strategy decision from Gemini or local fallback.
   * Validates the payload and discards stale/mismatched results.
   * Applied cleanly at the next valid state transition.
   */
  public queueStrategyDecision(decision: StrategyDecisionResponse): boolean {
    if (!decision || decision.matchId !== this.matchId) {
      this.staleResponsesDiscarded += 1;
      return false;
    }
    if (!isValidStrategy(decision.strategy)) {
      this.staleResponsesDiscarded += 1;
      return false;
    }
    if (decision.exchangeIndex <= this.lastResolvedStrategyExchange) {
      this.staleResponsesDiscarded += 1;
      return false;
    }
    if (
      this.queuedDecision &&
      decision.exchangeIndex < this.queuedDecision.exchangeIndex
    ) {
      this.staleResponsesDiscarded += 1;
      return false;
    }

    this.queuedDecision = decision;

    // If boss is currently in IDLE waiting between exchanges, apply immediately
    if (this.bossState === 'IDLE') {
      this.applyPendingStrategyIfReady(false);
    }
    return true;
  }

  public isFighting(): boolean {
    return this.phase === 'FIGHTING';
  }

  public update(dtMs: number, wallClockMs: number = Date.now()): void {
    const clampedDt = Math.min(100, Math.max(0, dtMs));
    if (this.phase === 'VICTORY') {
      this.bossStateTimerMs = Math.max(0, this.bossStateTimerMs - clampedDt);
      return;
    }
    if (this.phase !== 'FIGHTING') return;
    this.nowMs += clampedDt;
    this.elapsedFightMs += clampedDt;

    // Update player timers
    if (this.punchCooldownMs > 0) {
      this.punchCooldownMs = Math.max(0, this.punchCooldownMs - clampedDt);
    }
    if (this.punchTimerMs > 0) {
      this.punchTimerMs = Math.max(0, this.punchTimerMs - clampedDt);
      if (this.punchTimerMs === 0) {
        this.punchSide = null;
      }
    }
    if (this.playerHitStunMs > 0) {
      this.playerHitStunMs = Math.max(0, this.playerHitStunMs - clampedDt);
    }
    this.syncPlayerActionState();

    // Update boss cooldowns & state machine
    if (this.bossDodgeCooldownMs > 0) {
      this.bossDodgeCooldownMs = Math.max(0, this.bossDodgeCooldownMs - clampedDt);
    }

    this.bossStateTimerMs -= clampedDt;
    this.updateBossState(wallClockMs);
  }

  private syncPlayerActionState(): void {
    if (this.playerHitStunMs > 0) {
      this.playerState = 'HIT_STUN';
    } else if (this.punchTimerMs > 0 && this.punchSide) {
      this.playerState =
        this.punchSide === 'LEFT' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT';
    } else if (this.heldLean === 'LEFT') {
      this.playerState = 'LEAN_LEFT';
    } else if (this.heldLean === 'RIGHT') {
      this.playerState = 'LEAN_RIGHT';
    } else {
      this.playerState = 'NEUTRAL';
    }
  }

  private getCurrentParams(): StrategyParameters {
    return STRATEGY_PARAMS[this.activeStrategy];
  }

  private resolvePlayerPunch(side: 'LEFT' | 'RIGHT'): void {
    if (this.phase !== 'FIGHTING') return;

    const params = this.getCurrentParams();

    // 1. Boss is in BAIT_GUARD: punching triggers boss's fast counter windup!
    if (this.bossState === 'BAIT_GUARD') {
      this.recentPlayerWhiffed += 1;
      this.emit({
        type: 'PLAYER_PUNCH_BAITED',
        timestampMs: this.nowMs,
        side,
        label: 'COUNTER TRAP!',
      });
      this.bossAttackSide = 'CENTER';
      this.enterBossState('WINDUP', 520);
      this.emit({
        type: 'BOSS_WINDUP_START',
        timestampMs: this.nowMs,
        side: this.bossAttackSide,
      });
      return;
    }

    // 2. Boss is currently dodging or actively striking: punch whiffs
    if (this.bossState === 'DODGING' || this.bossState === 'STRIKE_ACTIVE') {
      this.recentPlayerWhiffed += 1;
      return;
    }

    // 3. Boss is in committed RECOVERY (or continuing punish combo during HIT_REACT from RECOVERY)
    if (
      this.bossState === 'RECOVERY' ||
      (this.bossState === 'HIT_REACT' &&
        this.returnStateAfterHitReact === 'RECOVERY' &&
        this.punishHitsThisOpening < MAX_PUNISH_HITS_PER_OPENING)
    ) {
      const isFirstCounter = this.punishHitsThisOpening === 0;
      const damage = isFirstCounter ? 12 : 9;
      this.punishHitsThisOpening += 1;
      if (this.bossState === 'RECOVERY') {
        this.recoveryRemainderMs = Math.max(0, this.bossStateTimerMs - 180);
      }
      this.applyDamageToBoss(
        damage,
        side,
        isFirstCounter ? 'PLAYER_PUNCH_COUNTER_HIT' : 'PLAYER_PUNCH_HIT',
        isFirstCounter ? 'COUNTER HIT!' : 'COMBO HIT!'
      );
      if ((this.phase as MatchPhase) !== 'FIGHTING') return;

      this.returnStateAfterHitReact =
        this.punishHitsThisOpening < MAX_PUNISH_HITS_PER_OPENING &&
        this.recoveryRemainderMs > 120
          ? 'RECOVERY'
          : 'IDLE';
      this.enterBossState('HIT_REACT', BOSS_HIT_REACT_MS);
      return;
    }

    // 4. Boss is in committed WINDUP: cannot dodge! Player lands a quick interrupt chip hit
    if (this.bossState === 'WINDUP') {
      const damage = 6;
      this.applyDamageToBoss(damage, side, 'PLAYER_PUNCH_HIT', 'GRAZE HIT');
      return;
    }

    // 5. Boss is in IDLE (or HIT_REACT returning to IDLE after neutral jab)
    if (this.bossState === 'IDLE') {
      const canDodge = this.bossDodgeCooldownMs <= 0;
      if (canDodge && this.rng() < params.neutralDodgeChance) {
        this.bossDodgeSide = side === 'LEFT' ? 'RIGHT' : 'LEFT';
        this.bossDodgeCooldownMs = BOSS_DODGE_COOLDOWN_MS;
        this.recentPlayerWhiffed += 1;
        this.enterBossState('DODGING', BOSS_DODGE_DURATION_MS);
        this.emit({
          type: 'PLAYER_PUNCH_DODGED_BY_BOSS',
          timestampMs: this.nowMs,
          side: this.bossDodgeSide,
          label: 'EVADED',
        });
        return;
      }

      const damage = 8;
      this.punishHitsThisOpening = 1;
      this.returnStateAfterHitReact = 'IDLE';
      this.applyDamageToBoss(damage, side, 'PLAYER_PUNCH_HIT', 'CLEAN HIT!');
      if ((this.phase as MatchPhase) !== 'FIGHTING') return;
      this.enterBossState('HIT_REACT', BOSS_HIT_REACT_MS);
    }
  }

  private applyDamageToBoss(
    damage: number,
    side: 'LEFT' | 'RIGHT',
    eventType: 'PLAYER_PUNCH_HIT' | 'PLAYER_PUNCH_COUNTER_HIT',
    label: string
  ): void {
    this.bossHp = Math.max(0, this.bossHp - damage);
    this.bossHitSide = side;
    this.stats.punchesLanded += 1;
    this.recentPlayerLanded += 1;
    if (eventType === 'PLAYER_PUNCH_COUNTER_HIT') {
      this.stats.counterHitsLanded += 1;
    }

    this.emit({
      type: eventType,
      timestampMs: this.nowMs,
      side,
      damage,
      label,
    });

    if (this.bossHp <= 0) {
      this.phase = 'VICTORY';
      this.matchEndWallMs = Date.now();
      this.enterBossState('KO', 760);
      this.emit({
        type: 'MATCH_VICTORY',
        timestampMs: this.nowMs,
      });
    }
  }

  private isPlayerSafelyLeaning(attackSide: BossAttackSide): boolean {
    const activeLean =
      this.heldLean !== 'NONE'
        ? this.heldLean
        : this.nowMs - this.lastLeanTimestampMs <= LEAN_GRACE_MS
          ? this.lastLeanDir
          : 'NONE';

    if (activeLean === 'NONE') return false;
    if (attackSide === 'CENTER') {
      return activeLean === 'LEFT' || activeLean === 'RIGHT';
    }
    if (attackSide === 'LEFT') {
      // Sweeping across left side of screen -> lean RIGHT to evade
      return activeLean === 'RIGHT';
    }
    // Sweeping across right side of screen -> lean LEFT to evade
    return activeLean === 'LEFT';
  }

  private pickNextAttackSide(): BossAttackSide {
    // Mix center strikes (any lean avoids) with directional hooks (lean away avoids)
    const r = this.rng();
    if (r < 0.4) return 'CENTER';
    if (r < 0.7) return 'LEFT';
    return 'RIGHT';
  }

  private updateBossState(wallClockMs: number): void {
    const params = this.getCurrentParams();

    if (this.bossState === 'STRIKE_ACTIVE' && !this.strikeResolved) {
      // Evaluate dodge continuously; resolve hit at 55% through active window
      if (this.isPlayerSafelyLeaning(this.bossAttackSide)) {
        this.strikeResolved = true;
        this.stats.dodgesSucceeded += 1;
        this.recentPlayerDodged += 1;
        this.emit({
          type: 'PLAYER_DODGE_SUCCESS',
          attackSide: this.bossAttackSide,
          timestampMs: this.nowMs,
          side:
            this.heldLean !== 'NONE'
              ? this.heldLean
              : this.lastLeanDir === 'NONE'
                ? 'CENTER'
                : this.lastLeanDir,
          label: 'DODGED!',
        });
      } else if (this.bossStateTimerMs <= this.bossStateDurationMs * 0.45) {
        // Impact moment reached without safe lean!
        this.strikeResolved = true;
        const dmg = params.strikeDamage;
        this.playerHp = Math.max(0, this.playerHp - dmg);
        this.playerHitStunMs = PLAYER_HIT_STUN_MS;
        this.punchTimerMs = 0;
        this.punchSide = null;
        this.syncPlayerActionState();

        this.stats.hitsTaken += 1;
        this.recentBossLanded += 1;

        this.emit({
          type: 'BOSS_STRIKE_HIT_PLAYER',
          timestampMs: this.nowMs,
          side: this.bossAttackSide,
          damage: dmg,
          label: `-${dmg} HP`,
        });

        if (this.playerHp <= 0) {
          this.phase = 'DEFEAT';
          this.matchEndWallMs = wallClockMs;
          this.enterBossState('VICTORY_POSE', 2000);
          this.emit({
            type: 'MATCH_DEFEAT',
            timestampMs: this.nowMs,
          });
          return;
        }
      }
    }

    if (this.bossStateTimerMs > 0) return;

    // State timer expired -> transition
    switch (this.bossState) {
      case 'IDLE': {
        // Before launching a new exchange, ensure strategy for previous exchange is resolved
        this.applyPendingStrategyIfReady(true);
        const nextParams = this.getCurrentParams();
        this.bossComboRemaining = nextParams.comboStrikes;
        this.punishHitsThisOpening = 0;

        if (nextParams.useBaitStance) {
          this.enterBossState('BAIT_GUARD', nextParams.baitDurationMs);
        } else {
          this.startBossWindup(nextParams.windupDurationMs);
        }
        break;
      }

      case 'BAIT_GUARD': {
        // Player patiently held off from punching the bait -> brief exposed recovery!
        this.punishHitsThisOpening = 0;
        this.enterBossState('RECOVERY', Math.round(params.recoveryDurationMs * 0.85));
        this.emit({
          type: 'BOSS_RECOVERY_OPEN',
          timestampMs: this.nowMs,
          label: 'GUARD OVERLOAD — STRIKE!',
        });
        this.dispatchExchangeSummaryIfNeeded();
        break;
      }

      case 'WINDUP': {
        this.strikeResolved = false;
        this.enterBossState('STRIKE_ACTIVE', params.strikeWindowMs);
        this.emit({
          type: 'BOSS_STRIKE_START',
          timestampMs: this.nowMs,
          side: this.bossAttackSide,
        });
        break;
      }

      case 'STRIKE_ACTIVE': {
        this.bossComboRemaining = Math.max(0, this.bossComboRemaining - 1);
        if (this.bossComboRemaining > 0 && this.phase === 'FIGHTING') {
          // Follow-up combo strike! Alternate side
          const prevSide = this.bossAttackSide;
          this.bossAttackSide =
            prevSide === 'LEFT'
              ? 'RIGHT'
              : prevSide === 'RIGHT'
                ? 'LEFT'
                : 'CENTER';
          this.enterBossState('WINDUP', Math.round(params.windupDurationMs * 0.82));
          this.emit({
            type: 'BOSS_WINDUP_START',
            timestampMs: this.nowMs,
            side: this.bossAttackSide,
          });
        } else {
          // Committed recovery window! Longer if player dodged cleanly
          const dodgedBoost = this.recentPlayerDodged > 0 ? 1.12 : 0.85;
          this.punishHitsThisOpening = 0;
          this.enterBossState(
            'RECOVERY',
            Math.round(params.recoveryDurationMs * dodgedBoost)
          );
          this.emit({
            type: 'BOSS_RECOVERY_OPEN',
            timestampMs: this.nowMs,
            label: 'OPENING!',
          });
          // Dispatch telemetry asynchronously right as recovery begins so Gemini has ~2s before next exchange
          this.dispatchExchangeSummaryIfNeeded();
        }
        break;
      }

      case 'RECOVERY': {
        this.completeExchangeAndEnterIdle();
        break;
      }

      case 'DODGING': {
        this.enterBossState('IDLE', Math.round(params.idleDurationMs * 0.65));
        break;
      }

      case 'HIT_REACT': {
        if (
          this.returnStateAfterHitReact === 'RECOVERY' &&
          this.recoveryRemainderMs > 120 &&
          this.punishHitsThisOpening < MAX_PUNISH_HITS_PER_OPENING
        ) {
          this.enterBossState('RECOVERY', this.recoveryRemainderMs);
        } else {
          if (this.summaryDispatchedForExchange === this.exchangeIndex) {
            this.completeExchangeAndEnterIdle();
          } else {
            this.enterBossState('IDLE', Math.round(params.idleDurationMs * 0.7));
          }
        }
        break;
      }

      default:
        break;
    }
  }

  private startBossWindup(durationMs: number): void {
    this.bossAttackSide = this.pickNextAttackSide();
    this.enterBossState('WINDUP', durationMs);
    this.emit({
      type: 'BOSS_WINDUP_START',
      timestampMs: this.nowMs,
      side: this.bossAttackSide,
    });
  }

  private dispatchExchangeSummaryIfNeeded(): void {
    if (this.summaryDispatchedForExchange >= this.exchangeIndex) return;
    this.summaryDispatchedForExchange = this.exchangeIndex;

    const summary: ExchangeSummaryPayload = {
      matchId: this.matchId,
      exchangeIndex: this.exchangeIndex,
      round: this.round,
      recentLeftPunches: this.recentLeftPunches,
      recentRightPunches: this.recentRightPunches,
      recentLeanLeftCount: this.recentLeanLeftCount,
      recentLeanRightCount: this.recentLeanRightCount,
      earlyDodgeCount: this.earlyDodgeCount,
      playerLandedHits: this.recentPlayerLanded,
      playerBlockedOrWhiffed: this.recentPlayerWhiffed,
      bossLandedHits: this.recentBossLanded,
      playerDodgedStrikes: this.recentPlayerDodged,
      playerHealthPct: Math.round((this.playerHp / PLAYER_MAX_HP) * 100),
      bossHealthPct: Math.round((this.bossHp / BOSS_MAX_HP) * 100),
      lastStrategy: this.activeStrategy,
    };

    this.lastExchangeSummary = summary;
    this.resetRecentWindow();
    this.onExchangeSummary?.(summary);
  }

  private completeExchangeAndEnterIdle(): void {
    this.dispatchExchangeSummaryIfNeeded();
    const completedExchange = this.exchangeIndex;
    this.exchangeIndex += 1;
    this.round = 1 + Math.floor((this.exchangeIndex - 1) / 4);

    // Apply queued Gemini decision if it already arrived during RECOVERY
    if (
      this.queuedDecision &&
      this.queuedDecision.exchangeIndex >= completedExchange
    ) {
      this.applyPendingStrategyIfReady(false);
    }

    const params = this.getCurrentParams();
    this.enterBossState('IDLE', params.idleDurationMs);
  }

  private applyPendingStrategyIfReady(fallbackIfMissing: boolean): void {
    if (this.queuedDecision && this.queuedDecision.matchId === this.matchId) {
      const d = this.queuedDecision;
      this.queuedDecision = null;
      this.lastResolvedStrategyExchange = d.exchangeIndex;
      this.activeStrategy = d.strategy;
      this.activeStrategySource = d.source;
      this.activeStrategyConfidence = d.confidence;
      this.activeStrategyReason =
        d.reason ??
        (d.source === 'gemini'
          ? 'Selected by Gemini Decisions API.'
          : 'Selected by local deterministic AI.');

      this.emit({
        type: 'STRATEGY_APPLIED',
        timestampMs: this.nowMs,
        strategy: this.activeStrategy,
        strategySource: this.activeStrategySource,
        videoEvidenceUsed: d.source === 'gemini' && d.videoEvidenceUsed === true,
      });
      return;
    }

    // If an exchange finished and we are starting the next exchange before network responded,
    // use deterministic local strategy immediately and mark this exchange resolved so late responses are discarded!
    if (
      fallbackIfMissing &&
      this.lastExchangeSummary &&
      this.lastExchangeSummary.exchangeIndex > this.lastResolvedStrategyExchange
    ) {
      const local = selectLocalStrategy(this.lastExchangeSummary);
      this.lastResolvedStrategyExchange = this.lastExchangeSummary.exchangeIndex;
      this.activeStrategy = local.strategy;
      this.activeStrategySource = 'local';
      this.activeStrategyConfidence = undefined;
      this.activeStrategyReason = local.reason;

      this.emit({
        type: 'STRATEGY_APPLIED',
        timestampMs: this.nowMs,
        strategy: this.activeStrategy,
        strategySource: 'local',
      });
    }
  }

  private enterBossState(state: BossState, durationMs: number): void {
    this.bossState = state;
    this.bossStateDurationMs = Math.max(1, durationMs);
    this.bossStateTimerMs = durationMs;
  }

  private resetRecentWindow(): void {
    this.recentLeftPunches = 0;
    this.recentRightPunches = 0;
    this.recentLeanLeftCount = 0;
    this.recentLeanRightCount = 0;
    this.earlyDodgeCount = 0;
    this.recentPlayerLanded = 0;
    this.recentPlayerWhiffed = 0;
    this.recentBossLanded = 0;
    this.recentPlayerDodged = 0;
  }

  private emit(event: CombatEvent): void {
    this.onEvent?.(event);
  }

  public getSnapshot(): CombatSnapshot {
    const stateProgress =
      this.bossStateDurationMs > 0
        ? Math.min(
            1,
            Math.max(0, 1 - this.bossStateTimerMs / this.bossStateDurationMs)
          )
        : 0;

    const punchProgress =
      this.punchTimerMs > 0
        ? Math.min(1, Math.max(0, 1 - this.punchTimerMs / PUNCH_DURATION_MS))
        : 0;

    return {
      matchId: this.matchId,
      phase: this.phase,
      matchStartWallMs: this.matchStartWallMs,
      matchEndWallMs: this.matchEndWallMs,
      elapsedFightMs: this.elapsedFightMs,
      round: this.round,
      exchangeIndex: this.exchangeIndex,

      playerHp: this.playerHp,
      playerMaxHp: PLAYER_MAX_HP,
      playerState: this.playerState,
      playerLean: this.heldLean,
      playerPunchSide: this.punchSide,
      playerPunchProgress: punchProgress,

      bossHp: this.bossHp,
      bossMaxHp: BOSS_MAX_HP,
      bossState: this.bossState,
      bossStateProgress: stateProgress,
      bossAttackSide: this.bossAttackSide,
      bossDodgeSide: this.bossDodgeSide,
      bossHitSide: this.bossHitSide,
      bossComboRemaining: this.bossComboRemaining,

      activeStrategy: this.activeStrategy,
      activeStrategySource: this.activeStrategySource,
      activeStrategyConfidence: this.activeStrategyConfidence,
      activeStrategyReason: this.activeStrategyReason,
      staleResponsesDiscarded: this.staleResponsesDiscarded,

      stats: { ...this.stats },
    };
  }
}
