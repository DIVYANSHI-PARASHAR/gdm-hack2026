import { RIVAL_CLIP_MAX_BYTES, RIVAL_CLIP_MS, parseObservation, parseRoundPlan } from '../shared/rival';
import type { RecapEntry } from '../ui/matchRecap';
import type { ExchangeSummaryPayload } from '../shared/types';

type Clip = { mimeType: string; data: string };

export class CameraRival {
  private job: AbortController | null = null;
  private clips: { exchange: number; clip: Clip }[] = [];
  private lastPlanRound = 0;
  private observation: { exchange: number; result: ReturnType<typeof parseObservation> } | null = null;
  private plan: { round: number; result: ReturnType<typeof parseRoundPlan> } | null = null;

  constructor(
    private readonly setStatus: (status: string) => void,
    private readonly addRecapEntry?: (entry: RecapEntry) => void,
  ) {}

  reset(): void {
    this.job?.abort();
    this.job = null;
    this.clips = [];
    this.lastPlanRound = 0;
    this.observation = null;
    this.plan = null;
    this.setStatus('');
  }

  context(summary: ExchangeSummaryPayload) {
    const targetRound = summary.round + Number(summary.exchangeIndex % 4 === 0);
    return {
      observation: this.observation && summary.exchangeIndex - this.observation.exchange <= 3
        ? this.observation.result : null,
      plan: this.plan?.round === targetRound ? this.plan.result : null,
    };
  }

  async update(summary: ExchangeSummaryPayload, stream: MediaStream): Promise<void> {
    if (this.job) return;
    const job = new AbortController();
    this.job = job;
    const position = (summary.exchangeIndex - 1) % 4;
    const targetRound = summary.round + Number(position >= 2);
    const clips = this.clips.filter((item) => summary.exchangeIndex - item.exchange <= 5);
    // Plan the upcoming round late in the current one, or catch up after it starts.
    const plan = clips.length === 2 && this.lastPlanRound !== targetRound;
    const source = plan ? 'Gemini 4 Neon' : 'Gemini 4 Hydrogen';
    const moment = plan ? `Plan for round ${targetRound}` : `Clip after exchange ${summary.exchangeIndex}`;
    const report = (detail: string) => {
      this.setStatus(`${source} · ${detail}`);
      this.addRecapEntry?.({ source, moment, detail });
    };
    try {
      if (plan) {
        this.lastPlanRound = targetRound;
        this.setStatus('Neon is comparing clips…');
        const result = parseRoundPlan(await this.analyze('plan', clips.map((item) => item.clip), job.signal));
        if (job.signal.aborted) return;
        this.plan = { round: targetRound, result };
        report(result
          ? `Round ${targetRound} · ${label(result.pattern)} → ${label(result.preferredStrategy)}`
          : 'No recurring cue');
        return;
      }

      this.setStatus('Hydrogen is watching this exchange…');
      const clip = await recordClip(stream, job.signal);
      if (job.signal.aborted) return;
      this.clips = [...this.clips.slice(-1), { exchange: summary.exchangeIndex, clip }];
      const result = parseObservation(await this.analyze('observe', [clip], job.signal));
      if (job.signal.aborted) return;
      this.observation = { exchange: summary.exchangeIndex, result };
      report(result && result.cue !== 'unclear'
        ? `${label(result.cue)} at ${(result.timestampMs / 1000).toFixed(1)}s into the clip`
        : 'Unclear footage');
    } catch {
      if (!job.signal.aborted) report('Video analysis unavailable');
    } finally {
      if (this.job === job) this.job = null;
    }
  }

  private async analyze(stage: 'observe' | 'plan', clips: Clip[], signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const res = await fetch('/api/boss/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true, stage, clips }),
      signal,
    });
    if (!res.ok) throw new Error(`Video HTTP ${res.status}`);
    return (await res.json()).result;
  }
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export async function recordClip(stream: MediaStream, signal: AbortSignal): Promise<Clip> {
  signal.throwIfAborted();
  const type = ['video/webm', 'video/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime));
  const track = stream.getVideoTracks().find((candidate) => candidate.readyState === 'live');
  if (!type || !track) throw new Error('Camera recording unavailable');

  const blob = await new Promise<Blob>((resolve, reject) => {
    const recorder = new MediaRecorder(new MediaStream([track]), { mimeType: type, videoBitsPerSecond: 480_000 });
    const chunks: Blob[] = [];
    const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    const timeout = window.setTimeout(stop, RIVAL_CLIP_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
    };
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      cleanup();
      if (signal.aborted) reject(signal.reason);
      else resolve(new Blob(chunks, { type }));
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error('Camera recording failed'));
    };
    try {
      recorder.start();
      signal.addEventListener('abort', stop, { once: true });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
  if (blob.size === 0 || blob.size > RIVAL_CLIP_MAX_BYTES) throw new Error('Invalid clip size');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { mimeType: type, data };
}
