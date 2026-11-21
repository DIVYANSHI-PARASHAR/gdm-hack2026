import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/game/combatEngine';
import { CombatEvent, ExchangeSummaryPayload } from '../src/shared/types';

function stepTime(engine: CombatEngine, totalMs: number, stepMs = 50): void {
  let rem = totalMs;
  while (rem > 0) {
    const dt = Math.min(stepMs, rem);
    engine.update(dt);
    rem -= dt;
  }
}

describe('CombatEngine state machine', () => {
  it('supports boss windup, timed dodge via player lean, and committed recovery counter-hits', () => {
    const events: CombatEvent[] = [];
    // rng = 0.1 -> picks CENTER attack (< 0.4)
    const engine = new CombatEngine({
      rng: () => 0.1,
      onEvent: (e) => events.push(e),
    });

    engine.startMatch(1000);
    expect(engine.getSnapshot().phase).toBe('FIGHTING');
    expect(engine.getSnapshot().bossState).toBe('IDLE');

    // Advance past initial IDLE (1050ms) into WINDUP
    stepTime(engine, 1100);
    expect(engine.getSnapshot().bossState).toBe('WINDUP');
    expect(engine.getSnapshot().bossAttackSide).toBe('CENTER');

    // Advance near end of WINDUP (680ms for pressure), lean LEFT, and enter STRIKE_ACTIVE
    stepTime(engine, 600);
    engine.setLean('LEFT');
    stepTime(engine, 60);
    expect(engine.getSnapshot().bossState).toBe('STRIKE_ACTIVE');

    // Advance inside STRIKE_ACTIVE -> lean avoids hit!
    stepTime(engine, 120);
    expect(engine.getSnapshot().playerHp).toBe(100);
    expect(events.some((e) => e.type === 'PLAYER_DODGE_SUCCESS')).toBe(true);

    // Finish pressure combo (2nd strike) while leaning safely
    stepTime(engine, 160); // finish 1st strike -> enters 2nd windup (558ms)
    stepTime(engine, 570); // finish 2nd windup -> 2nd strike active (240ms)
    stepTime(engine, 260); // finish 2nd strike -> enters committed RECOVERY!

    expect(engine.getSnapshot().bossState).toBe('RECOVERY');

    // Boss is in committed RECOVERY -> cannot dodge player punch!
    engine.setLean('NONE');
    const landed = engine.throwPunch('RIGHT');
    expect(landed).toBe(true);
    expect(engine.getSnapshot().bossHp).toBeLessThan(100);
    expect(events.some((e) => e.type === 'PLAYER_PUNCH_COUNTER_HIT')).toBe(true);
  });

  it('deals damage to player when standing neutral through boss strike hit window', () => {
    const engine = new CombatEngine({ rng: () => 0.1 });
    engine.startMatch(1000);

    // Step through IDLE -> WINDUP -> STRIKE_ACTIVE without leaning
    for (let i = 0; i < 25; i++) {
      engine.update(100);
    }

    expect(engine.getSnapshot().playerHp).toBeLessThan(100);
    expect(engine.getSnapshot().stats.hitsTaken).toBeGreaterThanOrEqual(1);
  });

  it('prevents boss from dodging every input via dodge cooldown', () => {
    // rng = 0.0 always attempts to dodge in IDLE when cooldown allows
    const engine = new CombatEngine({ rng: () => 0.0 });
    engine.startMatch(1000);

    // 1st neutral punch triggers boss dodge
    engine.throwPunch('LEFT');
    expect(engine.getSnapshot().bossState).toBe('DODGING');
    expect(engine.getSnapshot().bossHp).toBe(100);

    // Wait for boss dodge animation (360ms) + punch cooldown (240ms) to return to IDLE
    engine.update(100);
    engine.update(100);
    engine.update(100);
    engine.update(80);
    expect(engine.getSnapshot().bossState).toBe('IDLE');

    // 2nd punch while dodge cooldown is active MUST connect!
    engine.throwPunch('RIGHT');
    expect(engine.getSnapshot().bossHp).toBe(92);
  });

  it('pauses and resumes cleanly on webcam tracking loss', () => {
    const engine = new CombatEngine();
    engine.startMatch(1000);
    engine.pauseForTrackingLoss();
    expect(engine.getSnapshot().phase).toBe('PAUSED_TRACKING');

    // Updates & punches do nothing while paused
    expect(engine.throwPunch('LEFT')).toBe(false);
    engine.update(1000);
    expect(engine.getSnapshot().elapsedFightMs).toBe(0);

    engine.resumeFromTrackingLoss();
    expect(engine.getSnapshot().phase).toBe('FIGHTING');
    engine.update(100);
    expect(engine.getSnapshot().elapsedFightMs).toBe(100);
  });

  it('applies valid async Gemini strategy and discards stale or mismatched decisions', () => {
    let emittedSummary: ExchangeSummaryPayload | null = null;
    const engine = new CombatEngine({
      rng: () => 0.2,
      onExchangeSummary: (s) => {
        emittedSummary = s;
      },
    });
    engine.startMatch(1000);
    const matchId = engine.getSnapshot().matchId;

    // Step until first exchange finishes and emits summary
    for (let i = 0; i < 40 && !emittedSummary; i++) {
      engine.update(100);
    }
    expect(emittedSummary).not.toBeNull();

    // Queue valid Gemini response during RECOVERY before next exchange
    const accepted = engine.queueStrategyDecision({
      matchId,
      exchangeIndex: 1,
      strategy: 'bait_and_counter',
      source: 'gemini',
      confidence: 0.91,
    });
    expect(accepted).toBe(true);

    // Finish RECOVERY -> transitions into IDLE and applies strategy
    for (let i = 0; i < 20; i++) {
      engine.update(100);
      if (engine.getSnapshot().activeStrategy === 'bait_and_counter') break;
    }
    expect(engine.getSnapshot().activeStrategy).toBe('bait_and_counter');
    expect(engine.getSnapshot().activeStrategySource).toBe('gemini');

    // Stale duplicate/older exchange response must be discarded
    const staleAccepted = engine.queueStrategyDecision({
      matchId,
      exchangeIndex: 1,
      strategy: 'delayed_strike',
      source: 'gemini',
    });
    expect(staleAccepted).toBe(false);
    expect(engine.getSnapshot().staleResponsesDiscarded).toBe(1);

    // Wrong matchId must be discarded
    const wrongMatch = engine.queueStrategyDecision({
      matchId: 'other-match',
      exchangeIndex: 99,
      strategy: 'defensive_reset',
      source: 'gemini',
    });
    expect(wrongMatch).toBe(false);
    expect(engine.getSnapshot().staleResponsesDiscarded).toBe(2);
  });

  it('advances the knockout once after victory without extending the match clock', () => {
    const events: CombatEvent[] = [];
    const engine = new CombatEngine({ rng: () => 0.99, onEvent: (event) => events.push(event) });
    engine.startMatch(1000);

    for (let i = 0; i < 600 && engine.isFighting(); i++) {
      const { bossState, bossAttackSide } = engine.getSnapshot();
      engine.setLean(bossAttackSide === 'LEFT' ? 'RIGHT' : 'LEFT');
      if (bossState === 'IDLE' || bossState === 'RECOVERY') engine.throwPunch('LEFT');
      engine.update(50);
    }

    const result = engine.getSnapshot();
    expect(result.phase).toBe('VICTORY');
    expect(result.bossState).toBe('KO');
    stepTime(engine, 250);
    expect(engine.getSnapshot().bossStateProgress).toBeGreaterThan(0);
    expect(engine.getSnapshot().bossStateProgress).toBeLessThan(1);
    stepTime(engine, 1500);
    expect(engine.getSnapshot().bossStateProgress).toBe(1);
    expect(engine.getSnapshot().elapsedFightMs).toBe(result.elapsedFightMs);
    expect(events.filter(({ type }) => type === 'MATCH_VICTORY')).toHaveLength(1);

    engine.startMatch(3000);
    expect(engine.getSnapshot().bossState).toBe('IDLE');
  });

  it('allows entering CALIBRATING from DEFEAT/VICTORY when restarting webcam on rematch', () => {
    const engine = new CombatEngine({ rng: () => 0.1 });
    engine.startMatch(1000);

    // Step until player is defeated
    for (let i = 0; i < 400 && engine.getSnapshot().phase === 'FIGHTING'; i++) {
      engine.update(100);
    }
    expect(engine.getSnapshot().phase).toBe('DEFEAT');

    // Rematch with webcam enters CALIBRATING cleanly
    engine.setCalibrating();
    expect(engine.getSnapshot().phase).toBe('CALIBRATING');

    // Canceling calibration (e.g. camera unavailable) falls back cleanly to READY
    engine.cancelCalibration();
    expect(engine.getSnapshot().phase).toBe('READY');
  });
});
