import './style.css';
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
  SyncedCaloriesResponse,
} from './shared/types';
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
  private hrManager: FitbitHeartRateManager;

  private controlMode: 'keyboard' | 'webcam' = 'keyboard';
  private pendingStartAfterCalibration = false;
  private debugOpen = false;
  private vignetteTimeout: number | null = null;
  private calloutTimeout: number | null = null;

  // Keyboard lean tracking
  private keyLeanLeft = false;
  private keyLeanRight = false;

  // Server capability & Google Health state
  private googleHealthConfigured = false;
  private googleHealthConnected = false;
  private lastStrategyLatencyMs: number | null = null;

  // Last completed match timestamps for post-match calorie sync
  private completedMatchStartMs: number | null = null;
  private completedMatchEndMs: number | null = null;

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

        if (this.controlMode !== 'webcam') return;
        const snap = this.combat.getSnapshot();

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
    void this.fetchServerConfig();

    // Expose read-only inspection handle for verification smoke tests
    (window as unknown as Record<string, unknown>).__IRON_PULSE__ = {
      getSnapshot: () => this.combat.getSnapshot(),
      getVisionTelemetry: () => this.webcam.getTelemetry(),
      getHeartRateState: () => this.hrManager.getState(),
    };

    requestAnimationFrame((now) => this.tick(now));
  }

  private async fetchServerConfig(): Promise<void> {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      const data = (await res.json()) as {
        geminiConfigured?: boolean;
        googleHealthConfigured?: boolean;
        googleHealthConnected?: boolean;
      };
      this.googleHealthConfigured = Boolean(data.googleHealthConfigured);
      this.googleHealthConnected = Boolean(data.googleHealthConnected);
    } catch {
      // Offline / zero-credential fallback works seamlessly
    }
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

    // Fitbit Air BLE + Demo HR controls
    el<HTMLButtonElement>('btn-connect-fitbit').addEventListener('click', () => {
      void this.hrManager.connectFitbitAir();
    });

    el<HTMLButtonElement>('btn-demo-hr').addEventListener('click', () => {
      const state = this.hrManager.getState();
      if (state.source === 'demo') {
        this.hrManager.disconnect();
      } else {
        this.hrManager.startDemoMode();
      }
    });

    el<HTMLButtonElement>('btn-disconnect-hr').addEventListener('click', () => {
      this.hrManager.disconnect();
    });

    el<HTMLButtonElement>('btn-hr-guide').addEventListener('click', () => {
      el<HTMLDivElement>('hr-guide-popover').classList.toggle('hidden');
    });

    // Google Health OAuth + Synced Calories retry
    el<HTMLButtonElement>('btn-connect-ghealth').addEventListener('click', () => {
      this.openGoogleHealthOAuthPopup();
    });

    el<HTMLButtonElement>('btn-retry-calories').addEventListener('click', () => {
      void this.loadSyncedMatchCalories();
    });

    window.addEventListener('message', (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; ok?: boolean } | null;
      if (data?.type === 'GOOGLE_HEALTH_OAUTH_COMPLETE') {
        this.googleHealthConnected = Boolean(data.ok);
        void this.loadSyncedMatchCalories();
      }
    });
  }

  private bindKeyboardControls(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat) return;

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

    this.syncModalVisibility();
  }

  private resumeFromTrackingPause(): void {
    const t = this.webcam.getTelemetry();
    if (this.controlMode === 'webcam' && t.state !== 'active') return;
    this.combat.resumeFromTrackingLoss();
    this.syncModalVisibility();
  }

  private beginFight(): void {
    this.keyLeanLeft = false;
    this.keyLeanRight = false;
    this.completedMatchStartMs = null;
    this.completedMatchEndMs = null;
    this.hrManager.beginMatchRecording();
    this.combat.startMatch(Date.now());
    this.syncModalVisibility();
  }

  private handleCombatEvent(event: CombatEvent): void {
    this.sound.handleCombatEvent(event);
    this.arena.handleCombatEvent(event);

    switch (event.type) {
      case 'PLAYER_PUNCH_THROW':
        this.hrManager.notifyExertion(0.08);
        break;
      case 'PLAYER_PUNCH_HIT':
        this.showImpactCallout(event.label || 'CLEAN HIT!', '#00f0ff');
        this.hrManager.notifyExertion(0.11);
        break;
      case 'PLAYER_PUNCH_COUNTER_HIT':
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
        this.showImpactCallout(event.label || 'HIT!', '#ff1744');
        this.flashVignette('flash-hit');
        this.hrManager.notifyExertion(0.12);
        break;
      case 'PLAYER_DODGE_SUCCESS':
        this.showImpactCallout('DODGED!', '#00f0ff');
        this.flashVignette('flash-dodge');
        this.hrManager.notifyExertion(0.1);
        break;
      case 'MATCH_VICTORY':
      case 'MATCH_DEFEAT':
        this.onMatchFinished(event.type === 'MATCH_VICTORY');
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
    const camState = this.webcam.getTelemetry().state;
    if (
      camState === 'starting' ||
      camState === 'calibrating' ||
      camState === 'active' ||
      camState === 'tracking_lost'
    ) {
      this.webcam.stop();
    }

    const snap = this.combat.getSnapshot();
    this.completedMatchStartMs = snap.matchStartWallMs;
    this.completedMatchEndMs = snap.matchEndWallMs ?? Date.now();
    const hrSummary = this.hrManager.endMatchRecording();

    const resultPanel = el<HTMLElement>('screen-result');
    resultPanel.classList.toggle('victory', victory);
    resultPanel.classList.toggle('defeat', !victory);

    el<HTMLDivElement>('result-eyebrow').textContent = victory
      ? 'CHALLENGER TRIUMPHANT'
      : 'ARMOR DEPLETED';
    const heading = el<HTMLHeadingElement>('result-title');
    heading.textContent = victory ? 'KNOCKOUT VICTORY' : 'DEFEAT';
    heading.style.color = victory ? '#39ff9f' : '#ff1744';
    el<HTMLParagraphElement>('result-subtitle').textContent = victory
      ? 'You shattered KRONOS-V’s plasma core!'
      : 'KRONOS-V overwhelmed your guard. Study its windup and strike back!';

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

    // Populate Heart Rate result card (strictly separated from Synced Calories)
    const demoTag = el<HTMLSpanElement>('res-hr-demo-tag');
    demoTag.classList.toggle('hidden', !hrSummary.isDemo);

    if (hrSummary.sampleCount > 0 && hrSummary.averageBpm && hrSummary.peakBpm) {
      el<HTMLElement>('res-avg-bpm').textContent = hrSummary.isDemo
        ? `${hrSummary.averageBpm} BPM (Demo data)`
        : `${hrSummary.averageBpm} BPM`;
      el<HTMLElement>('res-peak-bpm').textContent = hrSummary.isDemo
        ? `${hrSummary.peakBpm} BPM (Demo data)`
        : `${hrSummary.peakBpm} BPM`;
      el<HTMLParagraphElement>('res-hr-note').textContent = hrSummary.isDemo
        ? `Recorded ${hrSummary.sampleCount} simulated samples (Demo data).`
        : `Recorded ${hrSummary.sampleCount} live BLE heart rate samples during the match.`;
    } else {
      el<HTMLElement>('res-avg-bpm').textContent = '--';
      el<HTMLElement>('res-peak-bpm').textContent = '--';
      el<HTMLParagraphElement>('res-hr-note').textContent =
        'No heart rate samples recorded during this match.';
    }

    // Trigger post-match Google Health Synced Total Calories check
    void this.loadSyncedMatchCalories();
    this.syncModalVisibility();
  }

  private openGoogleHealthOAuthPopup(): void {
    const w = 520;
    const h = 660;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    window.open(
      '/api/health/oauth/start',
      'google_health_oauth',
      `width=${w},height=${h},left=${left},top=${top}`
    );
  }

  private async loadSyncedMatchCalories(): Promise<void> {
    const valEl = el<HTMLElement>('res-cal-value');
    const badgeEl = el<HTMLElement>('res-cal-badge');
    const noteEl = el<HTMLParagraphElement>('res-cal-note');
    const connectBtn = el<HTMLButtonElement>('btn-connect-ghealth');
    const retryBtn = el<HTMLButtonElement>('btn-retry-calories');

    await this.fetchServerConfig();

    if (!this.googleHealthConfigured) {
      valEl.textContent = 'Unavailable';
      badgeEl.textContent = 'Not Configured';
      noteEl.textContent =
        'Optional Google Health OAuth is not configured in .env. Live BLE BPM remains independent.';
      connectBtn.classList.add('hidden');
      retryBtn.classList.add('hidden');
      return;
    }

    if (!this.googleHealthConnected) {
      valEl.textContent = 'Not Connected';
      badgeEl.textContent = 'OAuth 2.0';
      noteEl.textContent =
        'Connect Google Health (read-only fitness scope) to import synced total calories for this match interval.';
      connectBtn.classList.remove('hidden');
      retryBtn.classList.add('hidden');
      return;
    }

    if (!this.completedMatchStartMs || !this.completedMatchEndMs) {
      valEl.textContent = 'Unavailable';
      return;
    }

    valEl.textContent = 'Checking sync...';
    badgeEl.textContent = 'Syncing';
    connectBtn.classList.add('hidden');
    retryBtn.classList.add('hidden');

    try {
      const res = await fetch('/api/health/match-calories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchStartTimeMs: this.completedMatchStartMs,
          matchEndTimeMs: this.completedMatchEndMs,
        }),
      });

      const data = (await res.json()) as SyncedCaloriesResponse;

      if (data.status === 'synced' && typeof data.kcal === 'number') {
        valEl.textContent = `${data.kcal.toFixed(1)} kcal`;
        badgeEl.textContent = 'Synced';
        noteEl.textContent = data.message;
        retryBtn.classList.remove('hidden');
      } else if (data.status === 'awaiting_sync') {
        valEl.textContent = 'Awaiting sync';
        badgeEl.textContent = 'Pending';
        noteEl.textContent = data.message;
        retryBtn.classList.remove('hidden');
      } else if (data.status === 'disconnected') {
        this.googleHealthConnected = false;
        valEl.textContent = 'Not Connected';
        badgeEl.textContent = 'Reconnect';
        noteEl.textContent = data.message;
        connectBtn.classList.remove('hidden');
      } else {
        valEl.textContent = 'Unavailable';
        badgeEl.textContent = 'Unavailable';
        noteEl.textContent = data.message;
        retryBtn.classList.remove('hidden');
      }
    } catch {
      valEl.textContent = 'Unavailable';
      badgeEl.textContent = 'Offline';
      noteEl.textContent = 'Could not reach local server for calorie sync.';
      retryBtn.classList.remove('hidden');
    }
  }

  private renderHeartRateHud(state: HeartRateManagerState): void {
    const bpmEl = el<HTMLElement>('hr-bpm-value');
    const demoBadge = el<HTMLElement>('hr-demo-badge');
    const pill = el<HTMLElement>('hr-status-pill');
    const detail = el<HTMLElement>('hr-status-detail');
    const heartIcon = el<HTMLElement>('hr-heart-icon');
    const connectBtn = el<HTMLButtonElement>('btn-connect-fitbit');
    const demoBtn = el<HTMLButtonElement>('btn-demo-hr');
    const disconnectBtn = el<HTMLButtonElement>('btn-disconnect-hr');

    bpmEl.textContent =
      state.currentBpm !== null ? String(state.currentBpm) : '--';
    demoBadge.classList.toggle('hidden', !state.isDemo);
    detail.textContent = state.statusDetail;

    const statusLabels: Record<HeartRateManagerState['status'], string> = {
      unsupported: 'Unsupported browser',
      idle: 'Idle',
      pairing: 'Pairing...',
      connected: state.isDemo ? 'Demo data' : 'Live BLE',
      stale: 'Stale data',
      disconnected: 'Disconnected',
    };
    pill.textContent = statusLabels[state.status];

    const isLive = state.status === 'connected' && state.currentBpm !== null;
    heartIcon.classList.toggle('pulsing', isLive);
    connectBtn.disabled =
      state.status === 'pairing' || state.status === 'unsupported';
    demoBtn.textContent = state.isDemo
      ? 'Stop Demo data'
      : 'Simulate HR (Demo data)';
    disconnectBtn.classList.toggle(
      'hidden',
      state.source === 'none' || state.status === 'idle'
    );
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

    startCard.classList.add('hidden');
    calibCard.classList.add('hidden');
    pausedCard.classList.add('hidden');
    resultCard.classList.add('hidden');

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

    this.combat.update(dtMs, Date.now());
    const snap = this.combat.getSnapshot();

    this.arena.render(snap, dtMs / 1000);
    this.webcam.markFrameRendered(performance.now());
    this.updateHud(snap);

    requestAnimationFrame((next) => this.tick(next));
  }
}

new IronPulseApp();
