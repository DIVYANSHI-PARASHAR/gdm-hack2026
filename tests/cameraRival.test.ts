import { describe, expect, it, vi } from 'vitest';
import { analyzeRivalVideo, parseRivalRequest } from '../server/geminiRival';
import { decideNextBossStrategy, sanitizeExchangeSummary } from '../server/geminiDecisions';
import { parseRivalContext } from '../src/shared/rival';

const clip = { mimeType: 'video/webm', data: 'YWJj' };
const signal = new AbortController().signal;

function output(result: unknown) {
  return new Response(JSON.stringify({
    status: 'completed',
    steps: [
      { type: 'thought', content: [{ type: 'text', text: 'ignore' }] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(result) }] },
    ],
  }));
}

describe('Camera rival', () => {
  it('sends one inline clip to Hydrogen with frame sampling and validates the timestamp', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(output({ cue: 'feint_then_pause', timestampMs: 750 }));
    const request = parseRivalRequest({ stage: 'observe', clips: [{ ...clip, wearable: 'strip me' }] })!;
    expect(await analyzeRivalVideo(request, 'server-key', signal, fetch)).toEqual({ cue: 'feint_then_pause', timestampMs: 750 });
    const [url, config] = fetch.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(config?.signal).toBe(signal);
    expect(JSON.parse(String(config?.body))).toMatchObject({
      model: 'gemini-4-hydrogen',
      store: false,
      input: [expect.objectContaining({ type: 'text' }), {
        type: 'video', mime_type: 'video/webm', data: clip.data,
        processing: { type: 'static', fps: 8, content_layers: ['frames'] },
      }],
      response_format: { mime_type: 'application/json' },
    });
    expect(String(config?.body)).not.toContain('wearable');
  });

  it('passes two clips to Neon and abstains when no recurring cue is visible', async () => {
    const plan = { pattern: 'feint_then_pause', preferredStrategy: 'delayed_strike' };
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(output(plan))
      .mockResolvedValueOnce(output({ ...plan, pattern: 'unclear' }));
    const request = parseRivalRequest({ stage: 'plan', clips: [clip, { ...clip, data: 'ZGVm' }] })!;
    expect(await analyzeRivalVideo(request, 'server-key', signal, fetch)).toEqual(plan);
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.model).toBe('gemini-4-neon');
    expect(body.input.slice(1).map((item: { data: string }) => item.data)).toEqual(['YWJj', 'ZGVm']);
    expect(await analyzeRivalVideo(request, 'server-key', signal, fetch)).toBeNull();
  });

  it('rejects malformed clips and unusable provider responses', async () => {
    expect(parseRivalRequest({ stage: 'plan', clips: [clip] })).toBeNull();
    for (const invalid of [
      { ...clip, mimeType: 'audio/webm' },
      { ...clip, data: '###=' },
      { ...clip, data: 'a'.repeat(400_004) },
    ]) expect(parseRivalRequest({ stage: 'observe', clips: [invalid] })).toBeNull();
    const request = parseRivalRequest({ stage: 'observe', clips: [clip] })!;
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(output({ cue: 'early_lean', timestampMs: 9999 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await expect(analyzeRivalVideo(request, 'server-key', signal, fetch)).rejects.toThrow('Invalid Gemini video result');
    await expect(analyzeRivalVideo(request, 'server-key', signal, fetch)).rejects.toThrow('429');
  });

  it('routes with typed evidence and preserves counts-only decisions as the baseline', async () => {
    const summary = sanitizeExchangeSummary({ matchId: 'match', exchangeIndex: 4, recentLeftPunches: 3 })!;
    const rival = parseRivalContext({ observation: { cue: 'early_lean', timestampMs: 950, data: clip.data },
      plan: { pattern: 'repeated_sequence', preferredStrategy: 'delayed_strike' } });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ answers: { next_strategy: { choice: 'delayed_strike' } } })));
    const options = { apiKey: 'server-key', fetchImpl: fetch };
    await decideNextBossStrategy(summary, options);
    const decision = await decideNextBossStrategy(summary, { ...options, rival });
    const input = (index: number) => JSON.parse(String(fetch.mock.calls[index][1]?.body)).input[0].text;
    expect(input(0)).toContain('left=3');
    expect(input(0)).not.toContain('video cue');
    expect(input(1)).toContain('Recent video cue: early_lean');
    expect(input(1)).toContain('Round preference: delayed_strike');
    expect(input(1)).not.toContain(clip.data);
    expect(decision.reason).toContain('using video evidence');
    expect(decision.videoEvidenceUsed).toBe(true);
  });
});

describe('Camera rival browser workflow', () => {
  it('buffers recent observations, schedules a round plan, and cancels analysis on reset', async () => {
    vi.useFakeTimers();
    class Recorder {
      static isTypeSupported = () => true;
      state = 'inactive';
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        Object.assign(this, { stopped: true });
        const events = this as unknown as {
          ondataavailable: (event: { data: Blob }) => void;
          onstop: () => void;
        };
        events.ondataavailable({ data: new Blob(['abc']) });
        events.onstop();
      }
    }
    class Reader {
      result = 'data:video/webm;base64,YWJj';
      readAsDataURL() { (this as unknown as { onload: () => void }).onload(); }
    }
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => Response.json({ result: { cue: 'early_lean', timestampMs: 650 } }))
      .mockImplementationOnce(async () => Response.json({ result: { cue: 'repeated_sequence', timestampMs: 900 } }))
      .mockImplementationOnce(async () => Response.json({ result: { pattern: 'early_lean', preferredStrategy: 'delayed_strike' } }));
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('MediaStream', class {});
    vi.stubGlobal('MediaRecorder', Recorder);
    vi.stubGlobal('FileReader', Reader);
    vi.stubGlobal('fetch', fetch);
    try {
      const { CameraRival } = await import('../src/vision/cameraRival');
      const status = vi.fn();
      const recap = vi.fn();
      const rival = new CameraRival(status, recap);
      const stream = { getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream;
      const summary = (exchangeIndex: number) => sanitizeExchangeSummary({
        matchId: 'camera', exchangeIndex, round: 1 + Math.floor((exchangeIndex - 1) / 4),
      })!;
      const first = rival.update(summary(1), stream);
      await rival.update(summary(2), stream);
      await vi.advanceTimersByTimeAsync(2200);
      await first;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(rival.context(summary(2)).observation?.cue).toBe('early_lean');
      const second = rival.update(summary(2), stream);
      await vi.advanceTimersByTimeAsync(2200);
      await second;
      await rival.update(summary(3), stream);
      expect(rival.context(summary(3)).plan).toBeNull();
      expect(rival.context(summary(4)).plan?.preferredStrategy).toBe('delayed_strike');
      expect(rival.context(summary(8))).toEqual({ observation: null, plan: null });

      const cancelled = rival.update(summary(4), stream);
      rival.reset();
      await cancelled;
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(recap).toHaveBeenCalledTimes(3);
      expect(recap).toHaveBeenNthCalledWith(1, {
        source: 'Gemini 4 Hydrogen', moment: 'Clip after exchange 1',
        detail: 'early lean at 0.7s into the clip',
      });
      expect(recap).toHaveBeenNthCalledWith(3, {
        source: 'Gemini 4 Neon', moment: 'Plan for round 2',
        detail: 'Round 2 · early lean → delayed strike',
      });
      expect(rival.context(summary(4))).toEqual({ observation: null, plan: null });
      expect(status).toHaveBeenLastCalledWith('');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
