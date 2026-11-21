import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { decideNextBossStrategy, sanitizeExchangeSummary } from '../server/geminiDecisions';
import { analyzeRivalVideo, parseRivalRequest } from '../server/geminiRival';
import { isConfiguredSecret, loadDotEnv } from '../server/env';
import { isValidStrategy } from '../src/game/strategies';
import type { StrategyDecisionResponse } from '../src/shared/types';
import { parseRivalContext } from '../src/shared/rival';

type EvalCase = {
  id: string;
  clips: [string, string];
  summary: Record<string, unknown>;
  expectedTactic: unknown;
  evidenceBudgetMs: number;
  decisionBudgetMs: number;
};

type VideoMeasurement = { result: Awaited<ReturnType<typeof analyzeRivalVideo>>; ms: number; error: boolean };

function score(decision: StrategyDecisionResponse, item: EvalCase) {
  return {
    tactic: decision.strategy,
    source: decision.source,
    ms: decision.latencyMs,
    correct: decision.strategy === item.expectedTactic,
    onTime: (decision.latencyMs ?? Infinity) <= item.decisionBudgetMs,
  };
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('Usage: npm run eval:rival -- /path/to/private-cases.json');
  loadDotEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !isConfiguredSecret(apiKey)) throw new Error('Set an event API key with Neon access.');
  const cases = JSON.parse(await readFile(manifestPath, 'utf8')) as EvalCase[];
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('Provide at least one labeled case.');

  const results: {
    id: string;
    expected: unknown;
    observer: VideoMeasurement;
    planner: VideoMeasurement;
    usesVideo: boolean;
    baseline: ReturnType<typeof score>;
    camera: ReturnType<typeof score>;
  }[] = [];
  for (const item of cases) {
    const summary = sanitizeExchangeSummary(item.summary);
    if (!summary || !isValidStrategy(item.expectedTactic) || typeof item.id !== 'string' ||
        item.clips?.length !== 2 || item.clips[0] === item.clips[1] ||
        !Number.isFinite(item.evidenceBudgetMs) || item.evidenceBudgetMs <= 0 ||
        !Number.isFinite(item.decisionBudgetMs) || item.decisionBudgetMs <= 0) {
      throw new Error(`Invalid evaluation case: ${item.id}`);
    }
    const clips = await Promise.all(item.clips.map(async (path) => ({
      data: (await readFile(resolve(dirname(manifestPath), path))).toString('base64'),
      mimeType: ({ '.mp4': 'video/mp4', '.webm': 'video/webm' })[extname(path).toLowerCase()],
    })));

    const baseline = await decideNextBossStrategy(summary, { apiKey });
    const measure = async (stage: 'observe' | 'plan') => {
      const request = parseRivalRequest({ stage, clips: stage === 'observe' ? clips.slice(-1) : clips });
      if (!request) throw new Error(`Unsupported or oversized clips in ${item.id}`);
      const started = performance.now();
      try {
        const result = await analyzeRivalVideo(request, apiKey, AbortSignal.timeout(8000));
        return { result, ms: Math.round(performance.now() - started), error: false };
      } catch {
        return { result: null, ms: Math.round(performance.now() - started), error: true };
      }
    };
    const observer = await measure('observe');
    const planner = await measure('plan');
    const rival = parseRivalContext({
      observation: observer.ms <= item.evidenceBudgetMs ? observer.result : null,
      plan: observer.ms + planner.ms <= item.evidenceBudgetMs ? planner.result : null,
    });
    const usesVideo = Boolean(rival.plan || (rival.observation && rival.observation.cue !== 'unclear'));
    const camera = await decideNextBossStrategy(summary, { apiKey, rival });
    results.push({ id: item.id, expected: item.expectedTactic, observer, planner, usesVideo,
      baseline: score(baseline, item), camera: score(camera, item) });
  }
  const summarize = (arm: 'baseline' | 'camera') => ({
    correct: results.filter((row) => row[arm].correct).length,
    onTime: results.filter((row) => row[arm].onTime).length,
    correctAndOnTime: results.filter((row) => row[arm].correct && row[arm].onTime).length,
    localFallback: results.filter((row) => row[arm].source === 'local').length,
  });
  console.log(JSON.stringify({
    cases: results.length,
    videoEvidenceAvailable: results.filter((row) => row.usesVideo).length,
    baseline: summarize('baseline'),
    camera: summarize('camera'),
    results,
  }, null, 2));
  if (results.every((row) => row.baseline.source !== 'gemini') ||
      results.every((row) => row.observer.error || row.planner.error)) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
