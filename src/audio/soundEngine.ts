import { CombatEvent } from '../shared/types';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  public unlock(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public handleCombatEvent(event: CombatEvent): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || this.ctx.state !== 'running') return;

    switch (event.type) {
      case 'PLAYER_PUNCH_THROW':
        this.playWhoosh(240, 90, 0.09, 0.14);
        break;
      case 'PLAYER_PUNCH_HIT':
        this.playImpact(145, 42, 0.16, 0.34, false);
        break;
      case 'PLAYER_PUNCH_COUNTER_HIT':
        this.playImpact(190, 38, 0.24, 0.45, true);
        break;
      case 'PLAYER_PUNCH_DODGED_BY_BOSS':
        this.playWhoosh(480, 180, 0.12, 0.16);
        break;
      case 'PLAYER_PUNCH_BAITED':
        this.playElectricClang();
        break;
      case 'BOSS_WINDUP_START':
        this.playWindupCharge(
          event.side === 'CENTER' ? 190 : event.side === 'LEFT' ? 155 : 220
        );
        break;
      case 'BOSS_STRIKE_START':
        this.playWhoosh(160, 55, 0.16, 0.28);
        break;
      case 'BOSS_STRIKE_HIT_PLAYER':
        this.playPlayerHit();
        break;
      case 'PLAYER_DODGE_SUCCESS':
        this.playDodgeChime();
        break;
      case 'BOSS_RECOVERY_OPEN':
        this.playOpeningCue();
        break;
      case 'MATCH_VICTORY':
        this.playFanfare(true);
        break;
      case 'MATCH_DEFEAT':
        this.playFanfare(false);
        break;
      default:
        break;
    }
  }

  private playWhoosh(
    startFreq: number,
    endFreq: number,
    duration: number,
    volume: number
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(startFreq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
  }

  private playImpact(
    startFreq: number,
    endFreq: number,
    duration: number,
    volume: number,
    isCounter: boolean
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Sub-bass punch thump
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(volume, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);

    // Metallic crunch burst
    this.playWhoosh(950, 220, duration * 0.65, volume * 0.55);

    if (isCounter) {
      const ring = this.ctx.createOscillator();
      ring.type = 'sine';
      ring.frequency.setValueAtTime(660, now);
      ring.frequency.exponentialRampToValueAtTime(990, now + 0.18);

      const ringGain = this.ctx.createGain();
      ringGain.gain.setValueAtTime(0.18, now);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      ring.connect(ringGain);
      ringGain.connect(this.ctx.destination);
      ring.start(now);
      ring.stop(now + 0.2);
    }
  }

  private playElectricClang(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(340, now + 0.06);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  private playWindupCharge(baseFreq: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.15, now + 0.36);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.13, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  private playPlayerHit(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.28);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);

    this.playWhoosh(400, 80, 0.22, 0.28);
  }

  private playDodgeChime(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(840, now + 0.14);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  private playOpeningCue(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(660, now + 0.07);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  private playFanfare(victory: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = victory ? [330, 440, 554.37, 659.25] : [293.66, 261.63, 220, 164.81];

    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.11;
      const osc = this.ctx.createOscillator();
      osc.type = victory ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  }

  public playOutfitChime(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const chord = [392.0, 493.88, 587.33, 783.99]; // Warm G major 7 chime
    chord.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.08;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  public playPurchaseChime(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // Crisp C5-E5-G5-C6 confirmation chime
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.065;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  }
}
