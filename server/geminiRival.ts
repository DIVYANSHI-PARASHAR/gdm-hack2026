import { BOSS_STRATEGIES } from '../src/shared/types';
import { RIVAL_CLIP_MAX_BYTES, RIVAL_CUES, parseObservation, parseRoundPlan } from '../src/shared/rival';

export const OBSERVER_MODEL = 'gemini-4-hydrogen';
export const PLANNER_MODEL = 'gemini-4-neon';

export function parseRivalRequest(value: unknown) {
  const data = value as { stage?: unknown; clips?: unknown } | null;
  const stage = data?.stage;
  const clips = data?.clips;
  if ((stage !== 'observe' && stage !== 'plan') || !Array.isArray(clips) ||
      clips.length !== (stage === 'observe' ? 1 : 2)) return null;
  for (const clip of clips) {
    if (typeof clip?.data !== 'string' || clip.data.length === 0 ||
        clip.data.length > Math.ceil(RIVAL_CLIP_MAX_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(clip.data) || clip.data.length % 4 !== 0 ||
        (clip.mimeType !== 'video/webm' && clip.mimeType !== 'video/mp4')) return null;
  }
  return {
    stage,
    clips: clips.map(({ mimeType, data }: { mimeType: string; data: string }) => ({ mimeType, data })),
  };
}

export async function analyzeRivalVideo(
  request: NonNullable<ReturnType<typeof parseRivalRequest>>,
  apiKey: string,
  signal: AbortSignal,
  fetchImpl = fetch,
) {
  const observe = request.stage === 'observe';
  const model = observe ? OBSERVER_MODEL : PLANNER_MODEL;
  const text = observe
    ? 'Observe the player’s visible movement in this short clip for a fictional robot game. Identify one cue and its timestamp from 0 to 2200 milliseconds. Use unclear if framing, lighting or motion makes the cue ambiguous.'
    : 'Compare these two distinct clips in chronological order for a fictional robot game. Find a movement pattern visible in both and recommend one game tactic for the next round. Use unclear if no pattern recurs or if either clip is unreadable. pressure uses rapid combos, delayed_strike varies timing, bait_and_counter uses counter guard, defensive_reset creates space.';
  const cue = { type: 'string', enum: RIVAL_CUES };
  const properties = observe
    ? { cue, timestampMs: { type: 'integer' } }
    : { pattern: cue, preferredStrategy: { type: 'string', enum: BOSS_STRATEGIES } };
  const output = await videoJson(model, text, request.clips, { type: 'object', properties, required: Object.keys(properties) }, apiKey, signal, fetchImpl);
  if (!observe && (output as { pattern?: unknown } | null)?.pattern === 'unclear') return null;
  const result = observe ? parseObservation(output) : parseRoundPlan(output);
  if (!result) throw new Error('Invalid Gemini video result');
  return result;
}

export async function videoJson(model: string, text: string, clips: { data: string; mimeType: string }[],
  schema: object, apiKey: string, signal: AbortSignal, fetchImpl = fetch): Promise<unknown> {
  const response = await fetchImpl(
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'Api-Revision': '2026-05-20' },
      signal,
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { type: 'text', text },
          ...clips.map(({ mimeType, data }) => ({
            type: 'video', mime_type: mimeType, data,
            processing: { type: 'static', fps: 8, content_layers: ['frames'] },
          })),
        ],
        generation_config: { thinking_level: 'low' },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema,
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini video HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.status !== 'completed') throw new Error('Incomplete Gemini video result');
  const steps: { type: string; content?: { type: string; text?: string }[] }[] = payload.steps ?? [];
  const parts = steps.filter((step) => step.type === 'model_output').flatMap((step) => step.content ?? []);
  return JSON.parse(parts.filter((part) => part.type === 'text').map((part) => part.text).join(''));
}
