import { describe, expect, it } from 'vitest';
import {
  buildCompactDecisionInput,
  decideNextBossStrategy,
  GEMINI_DECISION_MODEL,
  GEMINI_DECISIONS_ENDPOINT,
  sanitizeExchangeSummary,
} from '../server/geminiDecisions';
import { attributeMatchCalories } from '../server/googleHealth';

describe('Gemini Decisions API integration & fallback', () => {
  it('strips unexpected properties (such as health data) from gameplay summaries', () => {
    const raw = {
      matchId: 'm-123',
      exchangeIndex: 2,
      round: 1,
      recentLeftPunches: 4,
      recentRightPunches: 3,
      recentLeanLeftCount: 1,
      recentLeanRightCount: 2,
      earlyDodgeCount: 0,
      playerLandedHits: 3,
      playerBlockedOrWhiffed: 4,
      bossLandedHits: 1,
      playerDodgedStrikes: 1,
      playerHealthPct: 85,
      bossHealthPct: 70,
      lastStrategy: 'pressure',
      // Injected sensitive fields that must never be preserved
      bpm: 152,
      totalCalories: 48.2,
    };

    const clean = sanitizeExchangeSummary(raw);
    expect(clean).not.toBeNull();
    expect('bpm' in (clean as unknown as Record<string, unknown>)).toBe(false);
    expect('totalCalories' in (clean as unknown as Record<string, unknown>)).toBe(
      false
    );

    const promptText = buildCompactDecisionInput(clean!);
    expect(promptText).not.toContain('152');
    expect(promptText).not.toContain('48.2');
  });

  it('calls gemini-decision-1 fixed-choice endpoint and validates response', async () => {
    let capturedUrl = '';
    let capturedModel = '';

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      const parsed = JSON.parse(String(init?.body)) as { model?: string };
      capturedModel = parsed.model ?? '';
      return new Response(
        JSON.stringify({
          answers: {
            next_strategy: {
              type: 'choice',
              choice: 'bait_and_counter',
              confidence: 0.88,
              probabilities: {
                pressure: 0.04,
                delayed_strike: 0.05,
                bait_and_counter: 0.88,
                defensive_reset: 0.03,
              },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const summary = sanitizeExchangeSummary({
      matchId: 'm-live',
      exchangeIndex: 3,
      round: 1,
      recentLeftPunches: 6,
      recentRightPunches: 2,
      lastStrategy: 'pressure',
    })!;

    const res = await decideNextBossStrategy(summary, {
      apiKey: 'test-real-key-123',
      fetchImpl: mockFetch,
    });

    expect(capturedUrl).toBe(GEMINI_DECISIONS_ENDPOINT);
    expect(capturedModel).toBe(GEMINI_DECISION_MODEL);
    expect(res.source).toBe('gemini');
    expect(res.strategy).toBe('bait_and_counter');
    expect(res.confidence).toBe(0.88);
  });

  it('falls back deterministically when key is missing, placeholder, or API errors', async () => {
    const summary = sanitizeExchangeSummary({
      matchId: 'm-fallback',
      exchangeIndex: 2,
      round: 1,
      recentLeftPunches: 6,
      recentRightPunches: 1,
      bossHealthPct: 80,
      lastStrategy: 'pressure',
    })!;

    const noKeyRes = await decideNextBossStrategy(summary, {
      apiKey: 'your_gemini_api_key_here',
    });
    expect(noKeyRes.source).toBe('local');
    expect(noKeyRes.strategy).toBe('bait_and_counter');

    const failedNetRes = await decideNextBossStrategy(summary, {
      apiKey: 'real-key',
      fetchImpl: async () => new Response('Server error', { status: 503 }),
    });
    expect(failedNetRes.source).toBe('local');
  });
});

describe('Google Health total-calories interval attribution', () => {
  it('computes prorated Synced total calories when 1-minute buckets cover the match', () => {
    // Match from 12:00:30Z to 12:02:30Z (120 seconds across 3 one-minute buckets)
    const startMs = Date.parse('2026-11-21T12:00:30.000Z');
    const endMs = Date.parse('2026-11-21T12:02:30.000Z');

    const points = [
      {
        interval: {
          startTime: '2026-11-21T12:00:00Z',
          endTime: '2026-11-21T12:01:00Z',
        },
        totalCalories: { kcal: 8.0 }, // 30s overlap -> 4.0 kcal
      },
      {
        interval: {
          startTime: '2026-11-21T12:01:00Z',
          endTime: '2026-11-21T12:02:00Z',
        },
        totalCalories: { kcal: 10.0 }, // 60s overlap -> 10.0 kcal
      },
      {
        interval: {
          startTime: '2026-11-21T12:02:00Z',
          endTime: '2026-11-21T12:03:00Z',
        },
        totalCalories: { kcal: 9.0 }, // 30s overlap -> 4.5 kcal
      },
    ];

    const result = attributeMatchCalories(points, startMs, endMs);
    expect(result.status).toBe('synced');
    expect(result.kcal).toBe(18.5);
  });

  it('returns awaiting_sync when match interval is empty or only partially covered', () => {
    const startMs = Date.parse('2026-11-21T12:00:00.000Z');
    const endMs = Date.parse('2026-11-21T12:02:00.000Z');

    expect(attributeMatchCalories([], startMs, endMs).status).toBe(
      'awaiting_sync'
    );

    // Only first minute synced so far (50% coverage)
    const partial = attributeMatchCalories(
      [
        {
          interval: {
            startTime: '2026-11-21T12:00:00Z',
            endTime: '2026-11-21T12:01:00Z',
          },
          totalCalories: { kcal: 9.2 },
        },
      ],
      startMs,
      endMs
    );
    expect(partial.status).toBe('awaiting_sync');
  });

  it('returns unavailable for coarse buckets that spill outside the match window', () => {
    const startMs = Date.parse('2026-11-21T12:05:00.000Z');
    const endMs = Date.parse('2026-11-21T12:07:00.000Z');

    const coarse = attributeMatchCalories(
      [
        {
          interval: {
            startTime: '2026-11-21T12:00:00Z',
            endTime: '2026-11-21T13:00:00Z',
          },
          totalCalories: { kcal: 320 },
        },
      ],
      startMs,
      endMs
    );
    expect(coarse.status).toBe('unavailable');
  });
});
