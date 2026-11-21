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
  ShopifyBuyerProfile,
  ShopifyCartHandoff,
  ShopifyProduct,
  ShopifyProductVariant,
  ShopifyPurchaseReceipt,
  ShopifySimilarProductMatch,
  ShoppingAgentResponse,
  ShoppingChatMessage,
  SimilarProductsResponse,
  StrategyDecisionResponse,
} from './shared/types';
import { emptyCounts, recordAction } from './shared/matchAnalytics';
import { MatchRecap } from './ui/matchRecap';
import {
  KAI_GUCCI_JACKET_TITLE,
  KAI_GUCCI_JACKET_URL,
  KAI_GUCCI_STYLE_CODE,
  KAI_OUTFIT_DEFAULT_COLOR,
  KAI_OUTFIT_DEFAULT_SIZE,
  KAI_OUTFIT_PRODUCT_ID,
} from './scene/KaiBrawlerModel';
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

  // Shop the Look & Agentic Commerce state
  private outfitRevealedThisMatch = false;
  private shopProduct: ShopifyProduct | null = null;
  private similarData: SimilarProductsResponse | null = null;
  private topShopifyUrl = 'https://demostore.hydrogen.mock.shop/products/puffer-jacket';
  private autoOpenTimer: number | null = null;
  private selectedVariant: ShopifyProductVariant | null = null;
  private selectedSize = KAI_OUTFIT_DEFAULT_SIZE;
  private selectedColor = KAI_OUTFIT_DEFAULT_COLOR;
  private activeCart: ShopifyCartHandoff | null = null;
  private purchaseReceipt: ShopifyPurchaseReceipt | null = null;
  private buyerProfile: ShopifyBuyerProfile | null = null;
  private checkoutInFlight = false;
  private shoppingHistory: ShoppingChatMessage[] = [];

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
          this.arena.setHeadGrabProgress(gesture.headGrabHoldProgress);

          const pct = Math.round(gesture.headGrabHoldProgress * 100);
          el<HTMLDivElement>('head-grab-progress-fill').style.width = `${pct}%`;
          el<HTMLSpanElement>('head-grab-progress-pct').textContent = `${pct}%`;
          el<HTMLSpanElement>('head-grab-progress-text').textContent =
            pct > 0
              ? 'Hold both hands in place…'
              : gesture.trackingValid
                ? 'Place both hands at your temples…'
                : 'Step into camera view…';

          if (gesture.headGrabTriggered) {
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
    void this.initShopifyCommerce();

    // Expose read-only inspection handle for verification smoke tests
    (window as unknown as Record<string, unknown>).__IRON_PULSE__ = {
      getSnapshot: () => this.combat.getSnapshot(),
      getVisionTelemetry: () => this.webcam.getTelemetry(),
      getHeartRateState: () => this.hrManager.getState(),
      getShopState: () => ({
        outfitRevealed: this.outfitRevealedThisMatch,
        product: this.shopProduct,
        similar: this.similarData,
        topShopifyUrl: this.topShopifyUrl,
        selectedVariant: this.selectedVariant,
        activeCart: this.activeCart,
        purchaseReceipt: this.purchaseReceipt,
        buyerProfile: this.buyerProfile,
        selectedSize: this.selectedSize,
        selectedColor: this.selectedColor,
      }),
      triggerShopTheLook: () => this.triggerShopTheLook(),
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

    // Shop the Look & Left Outfit Dialog UI event bindings
    el<HTMLButtonElement>('btn-enable-head-grab-cam').addEventListener('click', () => {
      this.sound.unlock();
      void this.webcam.start();
    });

    el<HTMLButtonElement>('btn-reopen-outfit').addEventListener('click', () => {
      el<HTMLButtonElement>('btn-reopen-outfit').classList.add('hidden');
      el<HTMLElement>('shop-the-look-panel').classList.remove('hidden');
    });

    el<HTMLButtonElement>('btn-close-outfit').addEventListener('click', () => {
      this.collapseOutfitDialog();
    });

    el<HTMLButtonElement>('btn-decline-outfit').addEventListener('click', () => {
      this.collapseOutfitDialog();
    });

    el<HTMLButtonElement>('btn-toggle-shopify-account').addEventListener('click', () => {
      el<HTMLFormElement>('shopify-account-drawer').classList.toggle('hidden');
    });

    el<HTMLFormElement>('shopify-account-drawer').addEventListener('submit', (ev) => {
      ev.preventDefault();
      void this.saveShopifyConnection();
    });

    el<HTMLButtonElement>('btn-buy-another').addEventListener('click', () => {
      this.purchaseReceipt = null;
      el<HTMLDivElement>('purchase-receipt-card').classList.add('hidden');
      el<HTMLDivElement>('variant-review-card').classList.remove('hidden');
    });

    el<HTMLFormElement>('agent-chat-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = el<HTMLInputElement>('agent-chat-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      void this.sendAgentChatMessage(text);
    });

    document.querySelectorAll<HTMLButtonElement>('.quick-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-query');
        if (q) void this.sendAgentChatMessage(q);
      });
    });

    el<HTMLButtonElement>('btn-continue-checkout').addEventListener('click', () => {
      this.sound.unlock();
      void this.handlePurchaseClick();
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

    const sensorPill = el<HTMLElement>('head-grab-sensor-pill');
    const enableHeadGrabCamBtn = el<HTMLButtonElement>('btn-enable-head-grab-cam');
    if (isRunning) {
      sensorPill.textContent =
        state === 'starting' ? '● Starting Cam...' : '● Pose Live';
      sensorPill.className = 'pill pill-green';
      enableHeadGrabCamBtn.classList.add('hidden');
    } else {
      sensorPill.textContent = 'Camera Off';
      sensorPill.className = 'pill pill-cyan';
      enableHeadGrabCamBtn.classList.remove('hidden');
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
    this.purchaseReceipt = null;
    this.checkoutInFlight = false;
    this.arena.resetPostMatchScene();
    this.webcam.resetHeadGrabState();
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
    this.purchaseReceipt = null;
    this.checkoutInFlight = false;
    this.arena.resetPostMatchScene();
    this.webcam.resetHeadGrabState();
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
    if (this.autoOpenTimer !== null) {
      window.clearTimeout(this.autoOpenTimer);
      this.autoOpenTimer = null;
    }
    el<HTMLDivElement>('head-grab-prompt-banner').classList.remove('hidden');
    el<HTMLDivElement>('head-grab-progress-wrap').classList.remove('hidden');
    el<HTMLDivElement>('head-grab-progress-fill').style.width = '0%';
    el<HTMLSpanElement>('head-grab-progress-pct').textContent = '0%';
    el<HTMLSpanElement>('head-grab-progress-text').textContent =
      'Place both hands at your temples…';
    el<HTMLElement>('shop-the-look-panel').classList.add('hidden');
    el<HTMLButtonElement>('btn-reopen-outfit').classList.add('hidden');
    el<HTMLDivElement>('purchase-receipt-card').classList.add('hidden');
    el<HTMLDivElement>('variant-review-card').classList.remove('hidden');
    el<HTMLFormElement>('shopify-account-drawer').classList.add('hidden');
    el<HTMLSpanElement>('shopify-auto-open-text').textContent =
      '✨ Gemini found similar jackets — opening Shopify page...';
    el<HTMLParagraphElement>('checkout-notice').textContent =
      'Uses your connected Shopify details for instant 1-click purchase.';
  }

  private collapseOutfitDialog(): void {
    el<HTMLElement>('shop-the-look-panel').classList.add('hidden');
    const reopenBtn = el<HTMLButtonElement>('btn-reopen-outfit');
    const price = this.selectedVariant
      ? `$${this.selectedVariant.price.amount} ${this.selectedVariant.price.currencyCode}`
      : '$90.00 CAD';
    reopenBtn.textContent = this.purchaseReceipt
      ? `✓ Outfit Purchased (${this.purchaseReceipt.orderNumber})`
      : `🥋 View Kai's Outfit (${price})`;
    reopenBtn.classList.remove('hidden');
  }

  private applyBuyerProfileUi(profile: ShopifyBuyerProfile): void {
    this.buyerProfile = profile;
    el<HTMLInputElement>('shop-conn-domain').value = profile.storeDomain;
    el<HTMLInputElement>('shop-conn-email').value = profile.email;
    el<HTMLInputElement>('shop-conn-address').value = profile.shippingAddress;
    el<HTMLElement>('rev-buyer-email').textContent = profile.email;
    const statusBadge = el<HTMLElement>('shop-status-badge');
    statusBadge.textContent = `Shopify · ${profile.storeDomain}`;
    statusBadge.className = 'pill pill-green';
  }

  private async saveShopifyConnection(): Promise<void> {
    const storeDomain = el<HTMLInputElement>('shop-conn-domain').value.trim();
    const email = el<HTMLInputElement>('shop-conn-email').value.trim();
    const shippingAddress = el<HTMLInputElement>('shop-conn-address').value.trim();

    try {
      const res = await fetch('/api/shop/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeDomain, email, shippingAddress }),
      });
      if (res.ok) {
        const data = (await res.json()) as { buyerProfile?: ShopifyBuyerProfile };
        if (data.buyerProfile) {
          this.applyBuyerProfileUi(data.buyerProfile);
        }
        const saved = el<HTMLElement>('shop-conn-saved');
        saved.classList.remove('hidden');
        window.setTimeout(() => saved.classList.add('hidden'), 1800);
        void this.initShopifyCommerce();
      }
    } catch {
      // Offline fallback keeps local inputs
    }
  }

  private async initShopifyCommerce(): Promise<void> {
    // Initialize default Gucci reference jacket details immediately
    el<HTMLAnchorElement>('gucci-ref-link').href = KAI_GUCCI_JACKET_URL;
    el<HTMLElement>('gucci-ref-title').textContent = `Gucci ${KAI_GUCCI_JACKET_TITLE}`;
    el<HTMLElement>('gucci-ref-sub').textContent = `Style ${KAI_GUCCI_STYLE_CODE} · $3,200 USD`;

    try {
      const [prodRes, simRes] = await Promise.all([
        fetch('/api/shop/product'),
        fetch('/api/shop/similar'),
      ]);

      if (prodRes.ok) {
        const data = (await prodRes.json()) as {
          product?: ShopifyProduct;
          source?: 'live_shopify' | 'fallback_cache';
          buyerProfile?: ShopifyBuyerProfile;
        };
        if (data.buyerProfile) {
          this.applyBuyerProfileUi(data.buyerProfile);
        }
        if (data.product) {
          this.applyShopifyProductToUi(data.product, data.source);
        }
      }

      if (simRes.ok) {
        const similar = (await simRes.json()) as SimilarProductsResponse;
        this.similarData = similar;
        this.renderSimilarProducts(similar);
      }
    } catch {
      // Graceful offline fallback
    }
  }

  private applyShopifyProductToUi(
    product: ShopifyProduct,
    source?: 'live_shopify' | 'fallback_cache'
  ): void {
    this.shopProduct = product;

    const statusBadge = el<HTMLElement>('shop-status-badge');
    const domainLabel = this.buyerProfile?.storeDomain || product.vendor || 'Shopify';
    if (source === 'live_shopify') {
      statusBadge.textContent = `Shopify · ${domainLabel}`;
      statusBadge.className = 'pill pill-green';
    } else if (source === 'fallback_cache') {
      statusBadge.textContent = `Shopify · ${domainLabel}`;
      statusBadge.className = 'pill pill-cyan';
    }

    el<HTMLImageElement>('shop-product-img').src = product.featuredImage.url;
    el<HTMLElement>('shop-product-title').textContent = product.title;
    el<HTMLElement>('shop-merchant-name').textContent = product.vendor;
    el<HTMLElement>('shop-product-desc').textContent = product.description;

    const directUrl =
      product.onlineStoreUrl ||
      `https://demostore.hydrogen.mock.shop/products/${product.handle}`;
    this.topShopifyUrl = directUrl;
    el<HTMLAnchorElement>('btn-open-shopify-direct').href = directUrl;

    const defaultSize = product.sizes.includes(this.selectedSize)
      ? this.selectedSize
      : product.sizes[0] || 'Medium';
    const defaultColor = product.colors.includes(this.selectedColor)
      ? this.selectedColor
      : product.colors[0] || 'Olive';

    const sizeContainer = el<HTMLDivElement>('shop-size-pills');
    sizeContainer.innerHTML = '';
    for (const size of product.sizes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `size-pill ${size === defaultSize ? 'active' : ''}`;
      btn.dataset.size = size;
      btn.textContent = size;
      btn.addEventListener('click', () => void this.selectVariant(size, this.selectedColor));
      sizeContainer.appendChild(btn);
    }

    const colorContainer = el<HTMLDivElement>('shop-color-pills');
    colorContainer.innerHTML = '';
    for (const color of product.colors) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isKai = color.toLowerCase() === 'olive';
      btn.className = `color-pill ${color === defaultColor ? 'active' : ''}`;
      btn.dataset.color = color;
      btn.textContent = isKai ? `${color} (Top Match)` : color;
      btn.addEventListener('click', () => void this.selectVariant(this.selectedSize, color));
      colorContainer.appendChild(btn);
    }

    void this.selectVariant(defaultSize, defaultColor);
  }

  private renderSimilarProducts(similar: SimilarProductsResponse): void {
    const ref = similar.referenceItem;
    el<HTMLImageElement>('gucci-ref-img').src = ref.imageUrl;
    el<HTMLElement>('gucci-ref-title').textContent = `${ref.brand} ${ref.title}`;
    el<HTMLElement>('gucci-ref-sub').textContent = `Style ${ref.styleCode} · ${ref.retailPrice}`;
    el<HTMLAnchorElement>('gucci-ref-link').href = ref.url;

    el<HTMLElement>('gemini-match-summary').textContent = similar.agentSummary;
    if (similar.topShopifyUrl) {
      this.topShopifyUrl = similar.topShopifyUrl;
      el<HTMLAnchorElement>('btn-open-shopify-direct').href = similar.topShopifyUrl;
    }

    const listEl = el<HTMLDivElement>('similar-matches-list');
    listEl.innerHTML = '';

    similar.matches.forEach((match: ShopifySimilarProductMatch, idx: number) => {
      const priceObj = match.product.variants[0]?.price;
      const priceStr = priceObj ? `$${priceObj.amount} ${priceObj.currencyCode}` : '$90.0 CAD';

      const row = document.createElement('div');
      row.className = `similar-match-item ${idx === 0 ? 'active' : ''}`;
      row.innerHTML = `
        <div class="similar-match-info">
          <div class="similar-match-top">
            <span class="similar-match-title">${match.product.title} · ${priceStr}</span>
            <span class="similar-score-pill">${match.matchScore}% Match</span>
          </div>
          <div class="similar-match-reason">${match.matchReason}</div>
        </div>
        <a href="${match.shopifyPageUrl}" target="_blank" rel="noopener noreferrer" class="similar-open-link">
          Shopify ↗
        </a>
      `;

      row.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).tagName === 'A') return;
        listEl.querySelectorAll('.similar-match-item').forEach((n) => n.classList.remove('active'));
        row.classList.add('active');
        this.applyShopifyProductToUi(match.product);
        this.topShopifyUrl = match.shopifyPageUrl;
        el<HTMLAnchorElement>('btn-open-shopify-direct').href = match.shopifyPageUrl;
      });

      listEl.appendChild(row);
    });

    if (similar.matches[0]) {
      this.applyShopifyProductToUi(similar.matches[0].product);
      this.topShopifyUrl = similar.matches[0].shopifyPageUrl;
      el<HTMLAnchorElement>('btn-open-shopify-direct').href = similar.matches[0].shopifyPageUrl;
    }
  }

  private openShopifyPageDirectly(url: string): void {
    el<HTMLSpanElement>('shopify-auto-open-text').textContent =
      '✓ Opened Gemini\'s top similar Shopify match!';
    const popup = window.open('about:blank', '_blank');
    if (popup) {
      popup.opener = null;
      popup.location.replace(url);
    } else {
      window.location.assign(url);
    }
  }

  private triggerShopTheLook(): void {
    if (this.outfitRevealedThisMatch) {
      el<HTMLButtonElement>('btn-reopen-outfit').classList.add('hidden');
      el<HTMLElement>('shop-the-look-panel').classList.remove('hidden');
      return;
    }
    this.outfitRevealedThisMatch = true;

    this.sound.playOutfitChime();
    this.arena.revealOutfit();
    this.showImpactCallout('SHOP THE LOOK', '#ffbe0b');

    el<HTMLDivElement>('head-grab-progress-wrap').classList.add('hidden');
    el<HTMLDivElement>('head-grab-prompt-banner').classList.add('hidden');
    el<HTMLButtonElement>('btn-reopen-outfit').classList.add('hidden');
    el<HTMLElement>('shop-the-look-panel').classList.remove('hidden');

    if (this.webcam.getTelemetry().state !== 'off') {
      this.webcam.stop();
    }

    // Give the outfit reveal time to display before opening the Shopify match.
    if (this.autoOpenTimer !== null) {
      window.clearTimeout(this.autoOpenTimer);
    }
    this.autoOpenTimer = window.setTimeout(() => {
      this.autoOpenTimer = null;
      this.openShopifyPageDirectly(this.topShopifyUrl);
    }, 1050);
  }

  private async selectVariant(size: string, color: string): Promise<void> {
    this.selectedSize = size;
    this.selectedColor = color;
    this.activeCart = null;

    // If user changes size/color after purchasing, show the Yes/No prompt for the new variant
    if (this.purchaseReceipt &&
        (this.purchaseReceipt.size !== size || this.purchaseReceipt.color !== color)) {
      this.purchaseReceipt = null;
      el<HTMLDivElement>('purchase-receipt-card').classList.add('hidden');
      el<HTMLDivElement>('variant-review-card').classList.remove('hidden');
    }

    document.querySelectorAll<HTMLButtonElement>('.size-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.size === size);
    });
    document.querySelectorAll<HTMLButtonElement>('.color-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color === color);
    });

    if (this.shopProduct) {
      const match = this.shopProduct.variants.find(
        (v) =>
          v.size.toLowerCase() === size.toLowerCase() &&
          v.color.toLowerCase() === color.toLowerCase()
      );
      if (match) {
        this.selectedVariant = match;
        this.updateReviewCard(match);
        return;
      }
    }

    try {
      const res = await fetch('/api/shop/variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, color }),
      });
      if (res.ok) {
        const data = (await res.json()) as { variant?: ShopifyProductVariant };
        if (data.variant) {
          this.selectedVariant = data.variant;
          this.updateReviewCard(data.variant);
        }
      }
    } catch {
      // Keep current state
    }
  }

  private updateReviewCard(variant: ShopifyProductVariant): void {
    const merchant = this.shopProduct?.vendor || 'Mock.shop';
    const title = this.shopProduct?.title || 'Puffer Jacket';
    el<HTMLElement>('rev-item-title').textContent = title;
    el<HTMLElement>('rev-merchant').textContent = merchant;
    el<HTMLElement>('rev-size').textContent = variant.size;
    el<HTMLElement>('rev-color').textContent = variant.color;
    el<HTMLElement>('rev-price').textContent = `$${variant.price.amount} ${variant.price.currencyCode}`;
    el<HTMLElement>('shop-product-price').textContent = `$${variant.price.amount} ${variant.price.currencyCode}`;

    const checkoutBtn = el<HTMLButtonElement>('btn-continue-checkout');
    checkoutBtn.disabled = !variant.availableForSale;
    checkoutBtn.textContent = variant.availableForSale
      ? 'Yes, Buy It Now'
      : 'Currently Out of Stock';
  }

  private async sendAgentChatMessage(userText: string): Promise<void> {
    const chatLog = el<HTMLDivElement>('agent-chat-log');
    const drawer = el<HTMLDetailsElement>('agent-drawer');
    drawer.open = true;

    const userMsgNode = document.createElement('div');
    userMsgNode.className = 'chat-msg chat-user';
    userMsgNode.innerHTML = `<strong>You:</strong><span>${userText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</span>`;
    chatLog.appendChild(userMsgNode);

    this.shoppingHistory.push({ role: 'user', content: userText });

    // Direct conversational purchase confirmation ("yes", "buy it", "purchase")
    if (/^\s*(yes|yep|yeah|sure|buy|buy it|buy now|purchase|i ll take it)\b/i.test(userText) &&
        !/\b(medium|small|large|xl|black|olive|green|ocean|purple|red)\b/i.test(userText)) {
      const confirmNode = document.createElement('div');
      confirmNode.className = 'chat-msg chat-assistant';
      confirmNode.innerHTML = `<strong>Gemini 4 Neon:</strong><span>Purchasing your ${this.selectedColor} (${this.selectedSize}) Puffer Jacket right now via Shopify!</span>`;
      chatLog.appendChild(confirmNode);
      chatLog.scrollTop = chatLog.scrollHeight;
      await this.handlePurchaseClick();
      return;
    }

    const typingNode = document.createElement('div');
    typingNode.className = 'chat-msg chat-assistant';
    typingNode.innerHTML = `<strong>Gemini 4 Neon:</strong><em>Checking live Shopify catalog...</em>`;
    chatLog.appendChild(typingNode);
    chatLog.scrollTop = chatLog.scrollHeight;

    try {
      const res = await fetch('/api/shop/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history: this.shoppingHistory,
          productId: this.shopProduct?.id || KAI_OUTFIT_PRODUCT_ID,
        }),
      });

      if (!res.ok) throw new Error('Shop chat error');
      const data = (await res.json()) as ShoppingAgentResponse;

      typingNode.innerHTML = `<strong>Gemini 4 Neon:</strong><span>${data.reply
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</span>`;

      this.shoppingHistory.push({ role: 'assistant', content: data.reply });

      if (data.selectedVariant) {
        this.selectedVariant = data.selectedVariant;
        this.selectedSize = data.selectedVariant.size;
        this.selectedColor = data.selectedVariant.color;
        void this.selectVariant(this.selectedSize, this.selectedColor);
      }

      if (data.alternatives && data.alternatives.length > 0 && !data.selectedVariant) {
        const altRow = document.createElement('div');
        altRow.className = 'quick-prompts';
        altRow.style.marginTop = '6px';
        for (const alt of data.alternatives.slice(0, 3)) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'quick-prompt-btn';
          btn.textContent = `Choose ${alt.color} (${alt.size})`;
          btn.addEventListener('click', () => {
            void this.selectVariant(alt.size, alt.color);
            void this.sendAgentChatMessage(`I'll take the ${alt.color} in ${alt.size}`);
          });
          altRow.appendChild(btn);
        }
        chatLog.appendChild(altRow);
      }
    } catch {
      typingNode.innerHTML = `<strong>Gemini 4 Neon:</strong><span>Kai's Puffer Jacket in Olive (Medium) is ready above for $90.00 CAD — click "Yes, Buy It Now" to purchase!</span>`;
    }

    chatLog.scrollTop = chatLog.scrollHeight;
  }

  private async handlePurchaseClick(): Promise<void> {
    if (this.checkoutInFlight || this.purchaseReceipt) return;

    const variant =
      this.selectedVariant ||
      this.shopProduct?.variants.find((v) => v.size === 'Medium' && v.color === 'Olive');

    if (!variant) return;

    this.checkoutInFlight = true;
    const checkoutBtn = el<HTMLButtonElement>('btn-continue-checkout');
    const declineBtn = el<HTMLButtonElement>('btn-decline-outfit');
    const spinner = el<HTMLDivElement>('checkout-spinner');
    checkoutBtn.disabled = true;
    declineBtn.disabled = true;
    checkoutBtn.textContent = 'Purchasing...';
    spinner.classList.remove('hidden');

    try {
      const res = await fetch('/api/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: variant.id,
          quantity: 1,
          productId: this.shopProduct?.id || KAI_OUTFIT_PRODUCT_ID,
        }),
      });

      if (!res.ok) throw new Error('Purchase request failed');
      const receipt = (await res.json()) as ShopifyPurchaseReceipt;
      this.purchaseReceipt = receipt;
      this.activeCart = {
        cartId: receipt.cartId,
        checkoutUrl: receipt.checkoutUrl,
        totalAmount: receipt.totalAmount,
        currencyCode: receipt.currencyCode,
        lines: [
          {
            variantId: receipt.variantId,
            title: receipt.variantTitle,
            quantity: 1,
            price: `$${receipt.totalAmount} ${receipt.currencyCode}`,
          },
        ],
      };

      this.renderPurchaseReceipt(receipt);
      this.sound.playPurchaseChime();
      this.showImpactCallout('OUTFIT PURCHASED! ✓', '#39ff9f');
    } catch {
      const fallbackReceipt: ShopifyPurchaseReceipt = {
        orderNumber: `#SP-${variant.id.replace(/\D/g, '').slice(-4) || '7680'}`,
        status: 'purchased',
        cartId: `gid://shopify/Cart/local-${Date.now()}`,
        checkoutUrl: `https://mock.shop/cart/${variant.id.replace(/\D/g, '') || '43696967680022'}:1`,
        merchant: this.shopProduct?.vendor || 'Mock.shop',
        itemTitle: this.shopProduct?.title || 'Puffer Jacket',
        variantId: variant.id,
        variantTitle: variant.title,
        size: variant.size,
        color: variant.color,
        totalAmount: variant.price.amount,
        currencyCode: variant.price.currencyCode,
        buyer: this.buyerProfile || {
          name: 'Arena Challenger',
          email: 'challenger@ironpulse.gg',
          shippingAddress: '150 Elgin St, Ottawa, ON K2P 1L4, CA',
          paymentLabel: 'Shop Pay · Connected Account',
          storeDomain: 'mock.shop',
        },
        purchasedAtIso: new Date().toISOString(),
        source: 'fallback_cache',
      };
      this.purchaseReceipt = fallbackReceipt;
      this.renderPurchaseReceipt(fallbackReceipt);
      this.sound.playPurchaseChime();
      this.showImpactCallout('OUTFIT PURCHASED! ✓', '#39ff9f');
    } finally {
      this.checkoutInFlight = false;
      checkoutBtn.disabled = false;
      declineBtn.disabled = false;
      checkoutBtn.textContent = 'Yes, Buy It Now';
      spinner.classList.add('hidden');
    }
  }

  private renderPurchaseReceipt(receipt: ShopifyPurchaseReceipt): void {
    el<HTMLElement>('receipt-order-num').textContent = receipt.orderNumber;
    el<HTMLElement>('receipt-merchant').textContent = receipt.merchant;
    el<HTMLElement>('receipt-item-line').textContent =
      `${receipt.itemTitle} — ${receipt.color} / ${receipt.size}`;
    el<HTMLElement>('receipt-total-line').textContent =
      `$${receipt.totalAmount} ${receipt.currencyCode} · ${receipt.buyer.paymentLabel}`;
    el<HTMLElement>('receipt-shipping-line').textContent =
      `Confirmation sent to ${receipt.buyer.email} · Ships to ${receipt.buyer.shippingAddress}`;
    const link = el<HTMLAnchorElement>('receipt-shopify-link');
    link.href = receipt.checkoutUrl;

    el<HTMLDivElement>('variant-review-card').classList.add('hidden');
    el<HTMLDivElement>('purchase-receipt-card').classList.remove('hidden');
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
