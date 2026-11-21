import './style.css';
import { estimateCalories } from './ble/calorieEstimate';
import { matchHeartRatePlot } from './ble/matchHeartRatePlot';
import { SoundEngine } from './audio/soundEngine';
import {
  FitbitHeartRateManager,
  HeartRateManagerState,
} from './ble/fitbitHeartRate';
import { CombatEngine, CombatSnapshot } from './game/combatEngine';
import {
  isValidStrategy,
  selectLocalStrategy,
  STRATEGY_PARAMS,
} from './game/strategies';
import { ArenaScene } from './scene/ArenaScene';
import {
  CombatEvent,
  ExchangeSummaryPayload,
  StrategyDecisionResponse,
} from './shared/types';
import { emptyCounts, recordAction } from './shared/matchAnalytics';
import { MatchRecap } from './ui/matchRecap';
import { WebcamController, WebcamState } from './vision/webcamController';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing DOM element #${id}`);
  return node as T;
}

class IronPulseApp {
  private sound = new SoundEngine();
  private arena: ArenaScene;
  private combat: CombatEngine;
  private webcam: WebcamController;
  private matchCounts = emptyCounts();
  private recap = new MatchRecap(
    el<HTMLDialogElement>('match-recap'),
    el<HTMLOListElement>('recap-timeline'),
    el('recap-analysis'),
    el('recap-outcome'),
  );
  private hrManager: FitbitHeartRateManager;

  private controlMode: 'keyboard' | 'webcam' = 'keyboard';
  private pendingStartAfterCalibration = false;
  private debugOpen = false;
  private vignetteTimeout: number | null = null;
  private calloutTimeout: number | null = null;
  private calorieEstimate = { kcal: 0, measuredMs: 0, includesDemo: false };

  // Keyboard lean tracking
  private keyLeanLeft = false;
  private keyLeanRight = false;

  private lastStrategyLatencyMs: number | null = null;

  private outfitRevealedThisMatch = false;

  private lastFramePerfMs = performance.now();

  constructor() {
    const arenaContainer = el<HTMLDivElement>('arena-container');
    this.arena = new ArenaScene(arenaContainer);

    this.combat = new CombatEngine({
      onEvent: (ev) => this.handleCombatEvent(ev),
      onExchangeSummary: (summary) => void this.requestBossStrategy(summary),
    });

    const previewCanvas = el<HTMLCanvasElement>('webcam-preview');
    this.webcam = new WebcamController(previewCanvas, {
      onStateChange: (state, errMsg) => this.handleWebcamStateChange(state, errMsg),
      onGestureFrame: (gesture) => {
        el<HTMLDivElement>('calib-bar-fill').style.width = `${Math.round(
          gesture.calibrationProgress * 100
        )}%`;

        const snap = this.combat.getSnapshot();

        // Shop the Look is available after either control mode.
        if (
          (snap.phase === 'VICTORY' || snap.phase === 'DEFEAT') &&
          !this.outfitRevealedThisMatch &&
          !this.pendingStartAfterCalibration
        ) {
          this.arena.setRightHandRaiseProgress(gesture.rightHandRaiseHoldProgress);

          const pct = Math.round(gesture.rightHandRaiseHoldProgress * 100);
          el<HTMLDivElement>('right-hand-raise-progress-fill').style.width = `${pct}%`;
          el<HTMLSpanElement>('right-hand-raise-progress-pct').textContent = `${pct}%`;
          el<HTMLSpanElement>('right-hand-raise-progress-text').textContent =
            pct > 0
              ? 'Keep your right arm raised…'
              : gesture.trackingValid
                ? 'Raise your right hand above your head…'
                : 'Step into camera view…';

          if (gesture.rightHandRaiseTriggered) {
            this.triggerShopTheLook();
            return;
          }
        }

        if (this.controlMode !== 'webcam') return;

        if (
          this.pendingStartAfterCalibration &&
          gesture.calibrated &&
          (snap.phase === 'READY' ||
            snap.phase === 'CALIBRATING' ||
            snap.phase === 'VICTORY' ||
            snap.phase === 'DEFEAT')
        ) {
          this.pendingStartAfterCalibration = false;
          this.beginFight();
          return;
        }

        if (snap.phase === 'FIGHTING' && gesture.calibrated && !gesture.trackingLost) {
          this.combat.setLean(gesture.lean);
          if (gesture.punchTriggered) {
            this.combat.throwPunch(gesture.punchTriggered);
          }
        }
      },
    });

    this.hrManager = new FitbitHeartRateManager((hrState) =>
      this.renderHeartRateHud(hrState)
    );
    this.renderHeartRateHud(this.hrManager.getState());

    this.bindUiEvents();
    this.bindKeyboardControls();

    // Expose read-only inspection handle for verification smoke tests
    (window as unknown as Record<string, unknown>).__IRON_PULSE__ = {
      getSnapshot: () => this.combat.getSnapshot(),
      getVisionTelemetry: () => this.webcam.getTelemetry(),
      getHeartRateState: () => this.hrManager.getState(),
      isOutfitRevealed: () => this.outfitRevealedThisMatch,
    };

    requestAnimationFrame((now) => this.tick(now));
  }

  private bindUiEvents(): void {
    el<HTMLButtonElement>('btn-start-keyboard').addEventListener('click', () => {
      this.sound.unlock();
      this.controlMode = 'keyboard';
      this.updateControlModeBadge();
      this.beginFight();
    });

    el<HTMLButtonElement>('btn-start-webcam').addEventListener('click', () => {
      this.sound.unlock();
      void this.activateWebcamAndStart(true);
    });

    el<HTMLButtonElement>('btn-skip-to-keyboard').addEventListener('click', () => {
      this.pendingStartAfterCalibration = false;
      this.controlMode = 'keyboard';
      this.updateControlModeBadge();
      this.webcam.stop();
      this.beginFight();
    });

    el<HTMLButtonElement>('btn-toggle-cam').addEventListener('click', () => {
      this.sound.unlock();
      const t = this.webcam.getTelemetry();
      if (t.state === 'off' || t.state === 'denied' || t.state === 'no_camera' || t.state === 'error') {
        const shouldStartMatch = this.combat.getSnapshot().phase === 'READY';
        void this.activateWebcamAndStart(shouldStartMatch);
      } else {
        this.controlMode = 'keyboard';
        this.updateControlModeBadge();
        this.webcam.stop();
        if (this.combat.getSnapshot().phase === 'PAUSED_TRACKING') {
          this.combat.resumeFromTrackingLoss();
        }
        this.syncModalVisibility();
      }
    });

    el<HTMLButtonElement>('btn-recalibrate').addEventListener('click', () => {
      this.webcam.recalibrate();
    });

    el<HTMLButtonElement>('btn-resume-fight').addEventListener('click', () => {
      this.resumeFromTrackingPause();
    });

    el<HTMLButtonElement>('btn-pause-use-keyboard').addEventListener('click', () => {
      this.controlMode = 'keyboard';
      this.updateControlModeBadge();
      this.webcam.stop();
      this.combat.resumeFromTrackingLoss();
      this.syncModalVisibility();
    });

    el<HTMLButtonElement>('btn-match-recap').addEventListener('click', () => {
      this.recap.open(el('result-title').textContent ?? '', this.matchCounts);
    });

    el<HTMLButtonElement>('btn-rematch').addEventListener('click', () => {
      this.triggerRematch();
    });

    // Debug & Mute toggles
    el<HTMLButtonElement>('btn-toggle-debug').addEventListener('click', () =>
      this.toggleDebugPanel()
    );
    el<HTMLButtonElement>('btn-close-debug').addEventListener('click', () =>
      this.toggleDebugPanel(false)
    );
    el<HTMLButtonElement>('btn-toggle-mute').addEventListener('click', () => {
      const muted = this.sound.toggleMute();
      el<HTMLButtonElement>('btn-toggle-mute').textContent = muted
        ? 'Sound: OFF'
        : 'Sound: ON';
    });

    // Fitbit Air pairing
    el<HTMLButtonElement>('btn-connect-fitbit').addEventListener('click', () => {
      void this.hrManager.connectFitbitAir();
    });

    // Post-match outfit controls
    el<HTMLButtonElement>('btn-enable-right-hand-raise-cam').addEventListener('click', () => {
      this.sound.unlock();
      void this.webcam.start();
    });

    el<HTMLButtonElement>('btn-reopen-outfit').addEventListener('click', () => {
      el<HTMLButtonElement>('btn-reopen-outfit').classList.add('hidden');
      el<HTMLElement>('shop-the-look-panel').classList.remove('hidden');
    });

    el<HTMLButtonElement>('btn-close-outfit').addEventListener('click', () => {
      el<HTMLElement>('shop-the-look-panel').classList.add('hidden');
      el<HTMLButtonElement>('btn-reopen-outfit').classList.remove('hidden');
    });
  }

  private bindKeyboardControls(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat || document.querySelector('dialog[open]')) return;
      if (ev.code === 'Space' && ev.target instanceof HTMLElement &&
          ev.target.closest('button, input, select, textarea, a')) return;
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;

      const code = ev.code;
      if (code === 'Backquote' || code === 'F3') {
        ev.preventDefault();
        this.toggleDebugPanel();
        return;
      }

      if (code === 'KeyM') {
        const muted = this.sound.toggleMute();
        el<HTMLButtonElement>('btn-toggle-mute').textContent = muted
          ? 'Sound: OFF'
          : 'Sound: ON';
        return;
      }

      if (code === 'KeyC') {
        this.webcam.recalibrate();
        return;
      }

      const snap = this.combat.getSnapshot();

      if (
        code === 'KeyG' &&
        (snap.phase === 'VICTORY' || snap.phase === 'DEFEAT') &&
        !this.outfitRevealedThisMatch
      ) {
        ev.preventDefault();
        this.sound.unlock();
        this.triggerShopTheLook();
        return;
      }

      if (code === 'Space') {
        ev.preventDefault();
        this.sound.unlock();
        if (snap.phase === 'READY') {
          this.controlMode = 'keyboard';
          this.updateControlModeBadge();
          this.beginFight();
        } else if (snap.phase === 'PAUSED_TRACKING') {
          this.resumeFromTrackingPause();
        } else if (snap.phase === 'VICTORY' || snap.phase === 'DEFEAT') {
          this.triggerRematch();
        }
        return;
      }

      if (snap.phase !== 'FIGHTING') return;
      this.sound.unlock();

      if (code === 'KeyA' || code === 'ArrowLeft') {
        ev.preventDefault();
        this.keyLeanLeft = true;
        this.applyKeyboardLean();
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        ev.preventDefault();
        this.keyLeanRight = true;
        this.applyKeyboardLean();
      } else if (code === 'KeyJ' || code === 'KeyZ' || code === 'KeyQ') {
        ev.preventDefault();
        this.combat.throwPunch('LEFT');
      } else if (code === 'KeyK' || code === 'KeyX' || code === 'KeyE') {
        ev.preventDefault();
        this.combat.throwPunch('RIGHT');
      }
    });

    window.addEventListener('keyup', (ev) => {
      const code = ev.code;
      if (code === 'KeyA' || code === 'ArrowLeft') {
        this.keyLeanLeft = false;
        this.applyKeyboardLean();
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        this.keyLeanRight = false;
        this.applyKeyboardLean();
      }
    });

    window.addEventListener('blur', () => {
      this.keyLeanLeft = false;
      this.keyLeanRight = false;
      if (this.controlMode === 'keyboard') {
        this.combat.setLean('NONE');
      }
    });
  }

  private applyKeyboardLean(): void {
    if (this.keyLeanLeft && !this.keyLeanRight) {
      this.combat.setLean('LEFT');
    } else if (this.keyLeanRight && !this.keyLeanLeft) {
      this.combat.setLean('RIGHT');
    } else {
      this.combat.setLean('NONE');
    }
  }

  private triggerRematch(): void {
    this.sound.unlock();
    if (
      this.controlMode === 'webcam' &&
      this.webcam.getTelemetry().state !== 'active'
    ) {
      void this.activateWebcamAndStart(true);
    } else {
      this.beginFight();
    }
  }

  private async activateWebcamAndStart(startMatchWhenCalibrated: boolean): Promise<void> {
    this.pendingStartAfterCalibration = startMatchWhenCalibrated;
    if (startMatchWhenCalibrated) {
      el<HTMLDivElement>('calib-bar-fill').style.width = '0%';
      this.combat.setCalibrating();
    }
    this.controlMode = 'webcam';
    this.updateControlModeBadge();
    this.syncModalVisibility();

    const ok = await this.webcam.start();
    if (!ok) {
      this.pendingStartAfterCalibration = false;
      this.controlMode = 'keyboard';
      this.updateControlModeBadge();
      // Return to start modal if we hadn't started fighting yet
      if (this.combat.getSnapshot().phase === 'CALIBRATING') {
        this.combat.cancelCalibration();
        this.syncModalVisibility();
      }
    }
  }

  private handleWebcamStateChange(state: WebcamState, errMsg?: string): void {
    const camStatus = el<HTMLDivElement>('cam-status-text');
    const placeholder = el<HTMLDivElement>('cam-placeholder');
    const gestureTag = el<HTMLDivElement>('cam-gesture-tag');
    const toggleBtn = el<HTMLButtonElement>('btn-toggle-cam');
    const recalibBtn = el<HTMLButtonElement>('btn-recalibrate');
    const resumeBtn = el<HTMLButtonElement>('btn-resume-fight');

    const isRunning =
      state === 'starting' ||
      state === 'calibrating' ||
      state === 'active' ||
      state === 'tracking_lost';

    placeholder.classList.toggle('hidden', isRunning);
    gestureTag.classList.toggle('hidden', !isRunning);
    toggleBtn.textContent = isRunning ? 'Disable Webcam' : 'Enable Webcam';
    recalibBtn.disabled = !isRunning;

    switch (state) {
      case 'off':
        camStatus.textContent =
          this.controlMode === 'webcam'
            ? 'Camera stopped — turns on at Rematch'
            : 'Keyboard mode active';
        break;
      case 'starting':
        camStatus.textContent = 'Starting camera & on-device model...';
        break;
      case 'calibrating':
        camStatus.textContent = 'Calibrating neutral boxing guard...';
        break;
      case 'active':
        camStatus.textContent = 'Webcam motion tracking live';
        if (this.combat.getSnapshot().phase === 'PAUSED_TRACKING') {
          resumeBtn.disabled = false;
          resumeBtn.textContent = 'Resume Match (Space)';
          el<HTMLHeadingElement>('pause-heading').textContent =
            'Pose Reacquired!';
          el<HTMLParagraphElement>('pause-message').textContent =
            'Tracking locked on-device. Press Space or click Resume Match to continue fighting.';
        }
        break;
      case 'tracking_lost':
        camStatus.textContent = 'Tracking lost — step into frame';
        if (
          this.controlMode === 'webcam' &&
          this.combat.getSnapshot().phase === 'FIGHTING'
        ) {
          this.combat.pauseForTrackingLoss();
          resumeBtn.disabled = true;
          resumeBtn.textContent = 'Waiting for Pose...';
          el<HTMLHeadingElement>('pause-heading').textContent =
            'Pose Tracking Lost';
          el<HTMLParagraphElement>('pause-message').textContent =
            'Step back into the webcam frame with both shoulders visible to reacquire tracking.';
          this.syncModalVisibility();
        }
        break;
      case 'denied':
      case 'no_camera':
      case 'error':
        camStatus.textContent = errMsg || 'Camera unavailable';
        break;
    }

    const sensorPill = el<HTMLElement>('right-hand-raise-sensor-pill');
    const enableRightHandRaiseCamBtn = el<HTMLButtonElement>('btn-enable-right-hand-raise-cam');
    if (isRunning) {
      sensorPill.textContent =
        state === 'starting' ? '● Starting Cam...' : '● Pose Live';
      sensorPill.className = 'pill pill-green';
      enableRightHandRaiseCamBtn.classList.add('hidden');
    } else {
      sensorPill.textContent = 'Camera Off';
      sensorPill.className = 'pill pill-cyan';
      enableRightHandRaiseCamBtn.classList.remove('hidden');
    }

    this.syncModalVisibility();
  }

  private resumeFromTrackingPause(): void {
    const t = this.webcam.getTelemetry();
    if (this.controlMode === 'webcam' && t.state !== 'active') return;
    this.combat.resumeFromTrackingLoss();
    this.syncModalVisibility();
  }

  private beginFight(): void {
    this.matchCounts = emptyCounts();
    this.recap.reset();
    this.keyLeanLeft = false;
    this.keyLeanRight = false;
    this.calorieEstimate = { kcal: 0, measuredMs: 0, includesDemo: false };
    this.outfitRevealedThisMatch = false;
    this.arena.resetPostMatchScene();
    this.webcam.resetRightHandRaiseState();
    this.resetOutfitDockUi();

    if (this.controlMode === 'keyboard' && this.webcam.getTelemetry().state !== 'off') {
      this.webcam.stop();
    }

    for (const id of ['comic-hit', 'comic-ouch', 'comic-victory']) {
      const node = el<HTMLDivElement>(id);
      for (const animation of node.getAnimations()) animation.cancel();
      node.hidden = true;
    }
    this.hrManager.beginMatchRecording();
    this.combat.startMatch(Date.now());
    this.syncModalVisibility();
  }

  private handleCombatEvent(event: CombatEvent): void {
    recordAction(this.matchCounts, event);
    this.sound.handleCombatEvent(event);
    this.arena.handleCombatEvent(event);

    switch (event.type) {
      case 'PLAYER_PUNCH_THROW':
        this.hrManager.notifyExertion(0.08);
        break;
      case 'PLAYER_PUNCH_HIT':
        this.showComicImpact('hit');
        this.hrManager.notifyExertion(0.11);
        break;
      case 'PLAYER_PUNCH_COUNTER_HIT':
        this.showComicImpact('hit');
        this.showImpactCallout(event.label || 'COUNTER HIT!', '#39ff9f');
        this.flashVignette('flash-counter');
        this.hrManager.notifyExertion(0.14);
        break;
      case 'PLAYER_PUNCH_DODGED_BY_BOSS':
        this.showImpactCallout('EVADED', '#94a3b8');
        break;
      case 'PLAYER_PUNCH_BAITED':
        this.showImpactCallout('COUNTER TRAP!', '#e0aaff');
        break;
      case 'BOSS_STRIKE_HIT_PLAYER':
        this.showComicImpact('ouch');
        this.flashVignette('flash-hit');
        this.hrManager.notifyExertion(0.12);
        break;
      case 'PLAYER_DODGE_SUCCESS':
        this.showImpactCallout('DODGED!', '#00f0ff');
        this.flashVignette('flash-dodge');
        this.hrManager.notifyExertion(0.1);
        break;
      case 'MATCH_VICTORY':
        this.showComicImpact('victory');
        this.onMatchFinished(true);
        break;
      case 'MATCH_DEFEAT':
        this.onMatchFinished(false);
        break;
      default:
        break;
    }
  }

  private async requestBossStrategy(
    summary: ExchangeSummaryPayload
  ): Promise<void> {
    const reqStart = performance.now();
    try {
      const res = await fetch('/api/boss/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summary),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const decision = (await res.json()) as StrategyDecisionResponse;
      if (!decision || !isValidStrategy(decision.strategy)) {
        throw new Error('Malformed strategy payload');
      }

      this.lastStrategyLatencyMs = Math.round(performance.now() - reqStart);
      this.combat.queueStrategyDecision(decision);
    } catch {
      // Deterministic local fallback if server is unreachable or errors
      const local = selectLocalStrategy(summary);
      this.lastStrategyLatencyMs = Math.round(performance.now() - reqStart);
      this.combat.queueStrategyDecision({
        matchId: summary.matchId,
        exchangeIndex: summary.exchangeIndex,
        strategy: local.strategy,
        source: 'local',
        reason: `${local.reason} (Client local fallback)`,
      });
    }
  }

  private onMatchFinished(victory: boolean): void {
    this.pendingStartAfterCalibration = false;
    this.outfitRevealedThisMatch = false;
    this.arena.resetPostMatchScene();
    this.webcam.resetRightHandRaiseState();
    this.resetOutfitDockUi();

    const camState = this.webcam.getTelemetry().state;
    if (camState === 'off') {
      void this.webcam.start();
    }

    const snap = this.combat.getSnapshot();
    const hrSummary = this.hrManager.endMatchRecording();

    const resultPanel = el<HTMLElement>('screen-result');
    resultPanel.classList.toggle('victory', victory);
    resultPanel.classList.toggle('defeat', !victory);

    el('result-title').textContent = victory ? 'Victory' : 'Defeat';

    el<HTMLElement>('res-duration').textContent = this.formatClock(
      snap.elapsedFightMs
    );
    el<HTMLElement>('res-punches').textContent = `${snap.stats.punchesLanded} / ${snap.stats.totalPunchesThrown}`;
    el<HTMLElement>('res-counters').textContent = String(
      snap.stats.counterHitsLanded
    );
    el<HTMLElement>('res-dodges').textContent = String(
      snap.stats.dodgesSucceeded
    );

    el('res-avg-bpm').textContent = hrSummary.averageBpm === null ? '—' : `${hrSummary.averageBpm} BPM`;
    el('res-peak-bpm').textContent = hrSummary.peakBpm === null ? '—' : `${hrSummary.peakBpm} BPM`;
    const plot = matchHeartRatePlot(
      this.hrManager.getMatchSamples(),
      snap.matchStartWallMs ?? 0,
      snap.matchEndWallMs ?? Date.now(),
    );
    el('match-hr-chart').classList.toggle('hidden', !plot);
    if (plot) {
      el('match-hr-min').textContent = String(plot.minBpm);
      el('match-hr-max').textContent = String(plot.maxBpm);
      document.getElementById('match-hr-line')?.setAttribute('d', plot.path);
      document.getElementById('match-hr-points')?.setAttribute('d', plot.points
        .map(({ x, y }) => `M${x.toFixed(2)} ${y.toFixed(2)}h0.01`).join(' '));
    }
    const hrNote = el('res-hr-note');
    hrNote.classList.toggle('hidden', Boolean(plot) && !hrSummary.isDemo);
    hrNote.textContent = hrSummary.isDemo ? 'Includes demo data.' : 'No heart rate recorded.';

    const { kcal, measuredMs, includesDemo } = this.calorieEstimate;
    el('res-calories').textContent = measuredMs > 0 ? `≈ ${kcal.toFixed(1)} kcal` : '—';
    const coverage = snap.elapsedFightMs > 0 ? Math.min(100, Math.round(100 * measuredMs / snap.elapsedFightMs)) : 0;
    const calorieNote = el('res-calories-note');
    calorieNote.classList.toggle('hidden', !includesDemo && (coverage === 0 || coverage === 100));
    calorieNote.textContent = [
      coverage > 0 && coverage < 100 ? `${coverage}% heart-rate coverage.` : '',
      includesDemo ? 'Includes demo data.' : '',
    ].filter(Boolean).join(' ');
    this.syncModalVisibility();
  }

  private resetOutfitDockUi(): void {
    el('right-hand-raise-prompt-banner').classList.remove('hidden');
    el('right-hand-raise-progress-fill').style.width = '0%';
    el('right-hand-raise-progress-pct').textContent = '0%';
    el('right-hand-raise-progress-text').textContent = 'Raise your right hand above your head…';
    el('shop-the-look-panel').classList.add('hidden');
    el('btn-reopen-outfit').classList.add('hidden');
  }

  private triggerShopTheLook(): void {
    if (this.outfitRevealedThisMatch) return;
    this.outfitRevealedThisMatch = true;

    this.sound.playOutfitChime();
    this.arena.revealOutfit();
    this.showImpactCallout('KAI’S JACKET', '#ffbe0b');

    el('right-hand-raise-prompt-banner').classList.add('hidden');
    el('shop-the-look-panel').classList.remove('hidden');

    if (this.webcam.getTelemetry().state !== 'off') {
      this.webcam.stop();
    }
  }

  private renderHeartRateHud(state: HeartRateManagerState): void {
    const bpmEl = el<HTMLElement>('hr-bpm-value');
    const pill = el<HTMLElement>('hr-status-pill');
    const detail = el<HTMLElement>('hr-status-detail');
    const heartIcon = el<HTMLElement>('hr-heart-icon');
    const connectBtn = el<HTMLButtonElement>('btn-connect-fitbit');

    const bpm = state.status === 'connected' ? state.currentBpm : null;
    bpmEl.textContent = bpm === null ? '—' : String(bpm);
    detail.textContent = bpm === null ? state.statusDetail : 'BPM-driven pulse';
    const wave = document.getElementById('hr-waveform');
    wave?.classList.toggle('is-live', bpm !== null);
    if (bpm !== null) {
      el('hr-bpm-value').closest('.hr-card')?.setAttribute('style', `--beat-period: ${60 / bpm}s`);
    }

    const statusLabels: Record<HeartRateManagerState['status'], string> = {
      unsupported: 'Unsupported browser',
      idle: 'Idle',
      pairing: 'Pairing...',
      connected: state.isDemo ? 'Demo data' : 'Live BLE',
      stale: 'Stale data',
      disconnected: 'Disconnected',
    };
    pill.textContent = statusLabels[state.status];

    heartIcon.classList.toggle('pulsing', bpm !== null);
    connectBtn.classList.toggle('hidden', bpm !== null && !state.isDemo);
    connectBtn.disabled = state.status === 'pairing' || state.status === 'unsupported';
  }

  private updateControlModeBadge(): void {
    const badge = el<HTMLElement>('input-mode-badge');
    badge.textContent =
      this.controlMode === 'webcam' ? 'WEBCAM MOTION' : 'KEYBOARD';
  }

  private syncModalVisibility(): void {
    const snap = this.combat.getSnapshot();
    const camState = this.webcam.getTelemetry().state;

    const backdrop = el<HTMLDivElement>('modal-backdrop');
    const startCard = el<HTMLDivElement>('screen-start');
    const calibCard = el<HTMLDivElement>('screen-calibrating');
    const pausedCard = el<HTMLDivElement>('screen-paused');
    const resultCard = el<HTMLElement>('screen-result');
    const outfitDock = el<HTMLElement>('outfit-dock');

    startCard.classList.add('hidden');
    calibCard.classList.add('hidden');
    pausedCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    outfitDock.classList.add('hidden');

    if (
      snap.phase === 'CALIBRATING' ||
      (this.pendingStartAfterCalibration &&
        (camState === 'starting' || camState === 'calibrating'))
    ) {
      backdrop.classList.remove('hidden');
      calibCard.classList.remove('hidden');
    } else if (snap.phase === 'READY') {
      backdrop.classList.remove('hidden');
      startCard.classList.remove('hidden');
    } else if (snap.phase === 'PAUSED_TRACKING') {
      backdrop.classList.remove('hidden');
      pausedCard.classList.remove('hidden');
    } else if (snap.phase === 'VICTORY' || snap.phase === 'DEFEAT') {
      backdrop.classList.add('hidden');
      resultCard.classList.remove('hidden');
      outfitDock.classList.remove('hidden');
    } else {
      backdrop.classList.add('hidden');
    }
  }

  private toggleDebugPanel(force?: boolean): void {
    this.debugOpen = force !== undefined ? force : !this.debugOpen;
    el<HTMLElement>('debug-panel').classList.toggle('hidden', !this.debugOpen);
  }

  private showImpactCallout(text: string, color: string): void {
    const node = el<HTMLDivElement>('impact-callout');
    node.textContent = text;
    node.style.color = color;
    node.classList.remove('hidden');
    // Restart animation cleanly
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';

    if (this.calloutTimeout !== null) {
      window.clearTimeout(this.calloutTimeout);
    }
    this.calloutTimeout = window.setTimeout(() => {
      node.classList.add('hidden');
    }, 500);
  }

  private showComicImpact(kind: 'hit' | 'ouch' | 'victory'): void {
    const node = el<HTMLDivElement>(`comic-${kind}`);
    for (const animation of node.getAnimations()) animation.cancel();
    node.hidden = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = node.animate(reducedMotion
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
      : [
          { opacity: 0, scale: 0.7 },
          { opacity: 1, scale: 1.08, offset: 0.19 },
          { opacity: 1, scale: 1, offset: 0.68 },
          { opacity: 0, scale: 0.94 },
        ], { duration: kind === 'victory' ? 1600 : 660, easing: 'ease-out' });
    animation.onfinish = () => { node.hidden = true; };
  }

  private flashVignette(cls: 'flash-hit' | 'flash-dodge' | 'flash-counter'): void {
    const vig = el<HTMLDivElement>('screen-vignette');
    vig.className = cls;
    if (this.vignetteTimeout !== null) {
      window.clearTimeout(this.vignetteTimeout);
    }
    this.vignetteTimeout = window.setTimeout(() => {
      vig.className = '';
    }, 180);
  }

  private updateHud(snap: CombatSnapshot): void {
    el<HTMLElement>('player-hp-text').textContent = `${snap.playerHp} / ${snap.playerMaxHp}`;
    el<HTMLElement>('player-hp-fill').style.width = `${
      (snap.playerHp / snap.playerMaxHp) * 100
    }%`;

    el<HTMLElement>('boss-hp-text').textContent = `${snap.bossHp} / ${snap.bossMaxHp}`;
    el<HTMLElement>('boss-hp-fill').style.width = `${
      (snap.bossHp / snap.bossMaxHp) * 100
    }%`;

    el<HTMLElement>('round-badge').textContent = `ROUND ${snap.round}`;
    el<HTMLElement>('exchange-badge').textContent = `EXCHANGE ${snap.exchangeIndex}`;
    el<HTMLElement>('match-timer').textContent = this.formatClock(
      snap.elapsedFightMs
    );

    const stratInfo = STRATEGY_PARAMS[snap.activeStrategy];
    el<HTMLElement>('boss-strategy-badge').textContent = stratInfo.displayName;

    // Telegraph banner
    const banner = el<HTMLDivElement>('telegraph-banner');
    if (snap.phase === 'FIGHTING') {
      if (snap.bossState === 'WINDUP') {
        banner.className = 'telegraph-banner';
        if (snap.bossAttackSide === 'LEFT') {
          banner.textContent = '⚠ LEFT SWEEP — LEAN RIGHT >>';
        } else if (snap.bossAttackSide === 'RIGHT') {
          banner.textContent = '<< LEAN LEFT — RIGHT SWEEP ⚠';
        } else {
          banner.textContent = '⚠ HEAVY STRAIGHT — LEAN LEFT OR RIGHT ⚠';
        }
      } else if (snap.bossState === 'RECOVERY') {
        banner.className = 'telegraph-banner opening';
        banner.textContent = '★ CORE EXPOSED — PUNCH NOW! ★';
      } else if (snap.bossState === 'BAIT_GUARD') {
        banner.className = 'telegraph-banner bait';
        banner.textContent = '⚡ COUNTER GUARD — HOLD YOUR PUNCHES! ⚡';
      } else {
        banner.classList.add('hidden');
      }
    } else {
      banner.classList.add('hidden');
    }

    // Webcam gesture tag & debug panel
    const vision = this.webcam.getTelemetry();
    el<HTMLElement>('cam-gesture-tag').textContent = vision.recognizedGesture;

    if (this.debugOpen) {
      el<HTMLElement>('dbg-cam-state').textContent = vision.state;
      el<HTMLElement>('dbg-pose-mode').textContent = vision.executionMode;
      el<HTMLElement>('dbg-cam-fps').textContent = `${vision.cameraFps} fps`;
      el<HTMLElement>('dbg-infer-ms').textContent = `${vision.inferenceMs.toFixed(1)} ms`;
      el<HTMLElement>('dbg-conf').textContent = `${vision.confidencePct}%`;
      el<HTMLElement>('dbg-gesture').textContent = vision.recognizedGesture;
      el<HTMLElement>('dbg-latency').textContent = `${vision.detectionToRenderMs.toFixed(1)} ms`;
      el<HTMLElement>('dbg-boss-state').textContent = snap.bossState;
      el<HTMLElement>('dbg-strategy').textContent = snap.activeStrategy;
      el<HTMLElement>('dbg-ai-source').textContent =
        snap.activeStrategySource === 'gemini'
          ? `Gemini (gemini-decision-1)${
              this.lastStrategyLatencyMs !== null
                ? ` [${this.lastStrategyLatencyMs}ms]`
                : ''
            }`
          : 'Local Deterministic AI';
      el<HTMLElement>('dbg-ai-detail').textContent = snap.activeStrategyReason;
      el<HTMLElement>('dbg-stale-count').textContent = String(
        snap.staleResponsesDiscarded
      );
    }
  }

  private formatClock(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private tick(nowPerfMs: number): void {
    const dtMs = Math.min(100, Math.max(0, nowPerfMs - this.lastFramePerfMs));
    this.lastFramePerfMs = nowPerfMs;

    if (dtMs > 0 && this.combat.isFighting()) {
      const hr = this.hrManager.getState();
      if (hr.status === 'connected' && hr.currentBpm !== null) {
        this.calorieEstimate.kcal += estimateCalories(hr.currentBpm, dtMs);
        this.calorieEstimate.measuredMs += dtMs;
        this.calorieEstimate.includesDemo ||= hr.isDemo;
      }
    }
    this.combat.update(dtMs, Date.now());
    const snap = this.combat.getSnapshot();

    this.arena.render(snap, dtMs / 1000);
    this.webcam.markFrameRendered(performance.now());
    this.updateHud(snap);

    requestAnimationFrame((next) => this.tick(next));
  }
}

new IronPulseApp();
