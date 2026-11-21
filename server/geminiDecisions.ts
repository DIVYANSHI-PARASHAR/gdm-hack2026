import {
  isValidStrategy,
  selectLocalStrategy,
} from '../src/game/strategies';
import {
  BossStrategyId,
  ExchangeSummaryPayload,
  StrategyDecisionResponse,
} from '../src/shared/types';
import { parseRivalContext } from '../src/shared/rival';
import { isConfiguredSecret } from './env';

export const GEMINI_DECISIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/decisions';
export const GEMINI_DECISION_MODEL = 'gemini-decision-1';

const STRATEGY_CRITERIA: Record<BossStrategyId, string> = {
  pressure:
    'Aggressive rapid two-strike combinations and short idle pauses to overwhelm passive or hesitant players who throw few punches.',
  delayed_strike:
    'Deceptive extended windup and heavy single strike to catch players who lean or dodge too early or very frequently.',
  bait_and_counter:
    'High-voltage counter guard stance that traps aggressive players throwing frequent punch volume, retaliating on contact.',
  defensive_reset:
    'Cautious lateral spacing and higher neutral dodge evasion when boss armor integrity is low or after taking counter damage.',
};

function clampInt(val: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof val === 'number' ? Math.round(val) : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Strictly sanitizes incoming telemetry so ONLY compact gameplay metrics are accepted.
 * Any unexpected properties (such as health or wearable data) are never read or forwarded.
 */
export function sanitizeExchangeSummary(
  body: Record<string, unknown> | null | undefined
): ExchangeSummaryPayload | null {
  if (!body || typeof body !== 'object') return null;
  const matchId = typeof body.matchId === 'string' ? body.matchId.slice(0, 64) : '';
  if (!matchId) return null;

  const lastStrategy: BossStrategyId = isValidStrategy(body.lastStrategy)
    ? body.lastStrategy
    : 'pressure';

  return {
    matchId,
    exchangeIndex: clampInt(body.exchangeIndex, 1, 999, 1),
    round: clampInt(body.round, 1, 99, 1),
    recentLeftPunches: clampInt(body.recentLeftPunches, 0, 100, 0),
    recentRightPunches: clampInt(body.recentRightPunches, 0, 100, 0),
    recentLeanLeftCount: clampInt(body.recentLeanLeftCount, 0, 100, 0),
    recentLeanRightCount: clampInt(body.recentLeanRightCount, 0, 100, 0),
    earlyDodgeCount: clampInt(body.earlyDodgeCount, 0, 100, 0),
    playerLandedHits: clampInt(body.playerLandedHits, 0, 100, 0),
    playerBlockedOrWhiffed: clampInt(body.playerBlockedOrWhiffed, 0, 100, 0),
    bossLandedHits: clampInt(body.bossLandedHits, 0, 100, 0),
    playerDodgedStrikes: clampInt(body.playerDodgedStrikes, 0, 100, 0),
    playerHealthPct: clampInt(body.playerHealthPct, 0, 100, 100),
    bossHealthPct: clampInt(body.bossHealthPct, 0, 100, 100),
    lastStrategy,
  };
}

export function buildCompactDecisionInput(summary: ExchangeSummaryPayload): string {
  return [
    `Round ${summary.round}, Exchange #${summary.exchangeIndex}.`,
    `Boss armor: ${summary.bossHealthPct}%, Player health: ${summary.playerHealthPct}%.`,
    `Previous boss strategy: ${summary.lastStrategy}.`,
    `Recent player punches: left=${summary.recentLeftPunches}, right=${summary.recentRightPunches} (landed=${summary.playerLandedHits}, whiffed_or_evaded=${summary.playerBlockedOrWhiffed}).`,
    `Recent player dodges: lean_left=${summary.recentLeanLeftCount}, lean_right=${summary.recentLeanRightCount}, early_dodge_releases=${summary.earlyDodgeCount}, strikes_dodged=${summary.playerDodgedStrikes}, boss_hits_landed=${summary.bossLandedHits}.`,
  ].join(' ');
}

export interface GeminiDecisionApiPayload {
  answers?: {
    next_strategy?: {
      type?: string;
      choice?: string;
      confidence?: number;
      probabilities?: Record<string, number>;
    };
  };
}

export async function decideNextBossStrategy(
  summary: ExchangeSummaryPayload,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    rival?: ReturnType<typeof parseRivalContext>;
  } = {}
): Promise<StrategyDecisionResponse> {
  const startMs = Date.now();
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2200;

  if (!isConfiguredSecret(apiKey)) {
    const local = selectLocalStrategy(summary);
    return {
      matchId: summary.matchId,
      exchangeIndex: summary.exchangeIndex,
      strategy: local.strategy,
      source: 'local',
      latencyMs: Date.now() - startMs,
      reason: `${local.reason} (No GEMINI_API_KEY configured)`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const observation = options.rival?.observation;
    const plan = options.rival?.plan;
    const videoEvidence = [
      observation && observation.cue !== 'unclear' ? `Recent video cue: ${observation.cue}.` : '',
      plan ? `Recurring video pattern: ${plan.pattern}. Round preference: ${plan.preferredStrategy}.` : '',
    ].filter(Boolean).join(' ');
    const requestBody = {
      model: GEMINI_DECISION_MODEL,
      input: [{ type: 'text', text: [buildCompactDecisionInput(summary), videoEvidence].filter(Boolean).join(' ') }],
      questions: {
        next_strategy: {
          type: 'choice',
          instructions: videoEvidence
            ? 'Choose the best tactic for the fictional robot boss. Weigh the video evidence and round preference against current game state.'
            : 'Choose the single most effective next combat strategy for the robot boxing boss to adapt against the player habits shown in the exchange summary.',
          criteria: STRATEGY_CRITERIA,
        },
      },
    };

    const res = await fetchFn(GEMINI_DECISIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Gemini Decisions HTTP ${res.status}`);
    }

    const json = (await res.json()) as GeminiDecisionApiPayload;
    const answer = json?.answers?.next_strategy;
    const choice = answer?.choice;

    if (!isValidStrategy(choice)) {
      throw new Error('Invalid or missing strategy choice in Gemini Decisions response');
    }

    const confidence =
      typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence)
        ? Number(answer.confidence.toFixed(3))
        : undefined;

    return {
      matchId: summary.matchId,
      exchangeIndex: summary.exchangeIndex,
      strategy: choice,
      source: 'gemini',
      videoEvidenceUsed: Boolean(videoEvidence),
      confidence,
      latencyMs: Date.now() - startMs,
      reason: `Gemini (${GEMINI_DECISION_MODEL}) routed to ${choice}${videoEvidence ? ' using video evidence' : ''}${
        confidence !== undefined ? ` (${Math.round(confidence * 100)}% conf)` : ''
      }.`,
    };
  } catch {
    const local = selectLocalStrategy(summary);
    return {
      matchId: summary.matchId,
      exchangeIndex: summary.exchangeIndex,
      strategy: local.strategy,
      source: 'local',
      latencyMs: Date.now() - startMs,
      reason: `${local.reason} (Fallback from Gemini request)`,
    };
  } finally {
    clearTimeout(timer);
  }
}
