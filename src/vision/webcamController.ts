import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  GestureFrameResult,
  GestureRecognizer,
  PoseLandmarkPoint,
} from './gestureRecognizer';
import type { PoseWorkerOutgoing } from './pose.worker';

export type WebcamState =
  | 'off'
  | 'starting'
  | 'calibrating'
  | 'active'
  | 'tracking_lost'
  | 'denied'
  | 'no_camera'
  | 'error';

export interface VisionTelemetry {
  state: WebcamState;
  executionMode: 'worker-gpu' | 'worker-cpu' | 'main-thread' | 'none';
  cameraFps: number;
  inferenceMs: number;
  confidencePct: number;
  recognizedGesture: string;
  detectionToRenderMs: number;
  calibrationProgress: number;
  errorMessage?: string;
}

export interface WebcamCallbacks {
  onStateChange?: (state: WebcamState, errorMessage?: string) => void;
  onGestureFrame?: (result: GestureFrameResult, capturePerfMs: number) => void;
}

const LOCAL_WASM_URL = '/mediapipe/wasm';
const LOCAL_MODEL_URL = '/models/pose_landmarker_lite.task';
const CDN_MODEL_FALLBACK_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class WebcamController {
  private video: HTMLVideoElement;
  private previewCanvas: HTMLCanvasElement;
  private previewCtx: CanvasRenderingContext2D;
  private callbacks: WebcamCallbacks;
  private recognizer = new GestureRecognizer();

  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private fallbackLandmarker: PoseLandmarker | null = null;
  private lastMainThreadTs = 0;

  private state: WebcamState = 'off';
  private executionMode: VisionTelemetry['executionMode'] = 'none';
  private running = false;
  private sessionId = 0;
  private startPromise: Promise<boolean> | null = null;
  private frameInFlight = false;
  private lastVideoTime = -1;

  // Telemetry metrics
  private cameraFrameTimestamps: number[] = [];
  private cameraFps = 0;
  private lastInferenceMs = 0;
  private lastConfidencePct = 0;
  private lastRecognizedGesture = 'NONE';
  private pendingCapturePerfMs: number | null = null;
  private lastDetectionToRenderMs = 0;
  private lastCalibrationProgress = 0;
  private lastErrorMessage?: string;
  private latestGestureResult: GestureFrameResult | null = null;

  private unloadCleanup: () => void;

  constructor(previewCanvas: HTMLCanvasElement, callbacks: WebcamCallbacks = {}) {
    this.previewCanvas = previewCanvas;
    this.previewCtx = previewCanvas.getContext('2d')!;
    this.callbacks = callbacks;

    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;

    this.unloadCleanup = () => {
      this.stop();
    };
    window.addEventListener('pagehide', this.unloadCleanup);
    window.addEventListener('beforeunload', this.unloadCleanup);
  }

  public async start(): Promise<boolean> {
    if (this.running) return true;
    if (this.startPromise) return this.startPromise;

    const session = ++this.sessionId;
    const promise = this.startInternal(session);
    this.startPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.startPromise === promise) {
        this.startPromise = null;
      }
    }
  }

  private async startInternal(session: number): Promise<boolean> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setState(
        'no_camera',
        'Webcam API unavailable. Ensure you are running on localhost or HTTPS.'
      );
      return false;
    }

    this.setState('starting');
    this.recognizer.resetCalibration();

    let acquiredStream: MediaStream | null = null;
    try {
      try {
        acquiredStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 60 },
            facingMode: 'user',
          },
          audio: false,
        });
      } catch (firstErr) {
        const firstDom = firstErr as DOMException;
        if (
          firstDom?.name === 'OverconstrainedError' ||
          firstDom?.name === 'ConstraintNotSatisfiedError'
        ) {
          acquiredStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw firstErr;
        }
      }
    } catch (err) {
      if (session !== this.sessionId) return false;
      const domErr = err as DOMException;
      if (
        domErr?.name === 'NotAllowedError' ||
        domErr?.name === 'PermissionDeniedError'
      ) {
        this.setState(
          'denied',
          'Camera permission denied. Allow camera access in your browser bar or play with keyboard controls.'
        );
      } else if (
        domErr?.name === 'NotFoundError' ||
        domErr?.name === 'DevicesNotFoundError'
      ) {
        this.setState(
          'no_camera',
          'No webcam detected on this device. Keyboard controls remain active.'
        );
      } else {
        this.setState(
          'error',
          `Camera unavailable (${domErr?.message || 'Unknown error'}).`
        );
      }
      return false;
    }

    if (session !== this.sessionId) {
      for (const track of acquiredStream.getTracks()) {
        track.stop();
      }
      return false;
    }

    this.stream = acquiredStream;
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      // Ignore play race if interrupted
    }

    if (session !== this.sessionId) {
      this.stopTracks();
      return false;
    }

    const engineReady = await this.initPoseEngine();
    if (session !== this.sessionId) {
      this.stopTracks();
      this.cleanupPoseEngines();
      return false;
    }

    if (!engineReady) {
      this.stopTracks();
      this.setState(
        'error',
        'Failed to initialize MediaPipe Pose Landmarker. Keyboard fallback active.'
      );
      return false;
    }

    this.running = true;
    this.frameInFlight = false;
    this.lastVideoTime = -1;
    this.setState('calibrating');
    this.scheduleNextVideoFrame();
    return true;
  }

  public recalibrate(): void {
    if (!this.running) return;
    this.recognizer.resetCalibration();
    this.setState('calibrating');
  }

  public stop(): void {
    this.sessionId += 1;
    this.startPromise = null;
    this.running = false;
    this.frameInFlight = false;
    this.stopTracks();
    this.cleanupPoseEngines();

    this.executionMode = 'none';
    this.cameraFps = 0;
    this.lastRecognizedGesture = 'NONE';
    this.setState('off');
    this.previewCtx.clearRect(
      0,
      0,
      this.previewCanvas.width,
      this.previewCanvas.height
    );
  }

  private cleanupPoseEngines(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'STOP' });
      } catch {
        // Ignore
      }
      this.worker.terminate();
      this.worker = null;
    }

    if (this.fallbackLandmarker) {
      this.fallbackLandmarker.close();
      this.fallbackLandmarker = null;
    }
  }

  public dispose(): void {
    this.stop();
    window.removeEventListener('pagehide', this.unloadCleanup);
    window.removeEventListener('beforeunload', this.unloadCleanup);
  }

  /**
   * Called right inside the main render loop after Three.js renders a frame,
   * completing the true end-to-end capture -> worker pose -> gesture -> render timing!
   */
  public markFrameRendered(renderCompletePerfMs: number = performance.now()): void {
    if (this.pendingCapturePerfMs !== null) {
      this.lastDetectionToRenderMs = Math.max(
        0,
        renderCompletePerfMs - this.pendingCapturePerfMs
      );
      this.pendingCapturePerfMs = null;
    }
    if (this.running) {
      this.drawPreviewOverlay();
    }
  }

  public getTelemetry(): VisionTelemetry {
    return {
      state: this.state,
      executionMode: this.executionMode,
      cameraFps: Math.round(this.cameraFps),
      inferenceMs: Number(this.lastInferenceMs.toFixed(1)),
      confidencePct: Math.round(this.lastConfidencePct),
      recognizedGesture: this.lastRecognizedGesture,
      detectionToRenderMs: Number(this.lastDetectionToRenderMs.toFixed(1)),
      calibrationProgress: this.lastCalibrationProgress,
      errorMessage: this.lastErrorMessage,
    };
  }

  private async initPoseEngine(): Promise<boolean> {
    const origin = window.location.origin;
    const wasmBaseUrl = `${origin}${LOCAL_WASM_URL}`;
    const modelUrl = `${origin}${LOCAL_MODEL_URL}`;

    // 1. Prefer Web Worker with transferable ImageBitmap to keep main thread & rendering completely independent
    if (typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      const workerOk = await new Promise<boolean>((resolve) => {
        try {
          const worker = new Worker(
            new URL('./pose.worker.ts', import.meta.url),
            { type: 'module' }
          );
          const timeout = window.setTimeout(() => {
            worker.terminate();
            resolve(false);
          }, 15000);

          worker.onmessage = (ev: MessageEvent<PoseWorkerOutgoing>) => {
            const data = ev.data;
            if (data.type === 'READY') {
              window.clearTimeout(timeout);
              this.worker = worker;
              this.executionMode =
                data.delegate === 'GPU' ? 'worker-gpu' : 'worker-cpu';
              this.attachWorkerListener(worker);
              resolve(true);
            } else if (data.type === 'INIT_ERROR') {
              window.clearTimeout(timeout);
              worker.terminate();
              resolve(false);
            }
          };

          worker.onerror = () => {
            window.clearTimeout(timeout);
            worker.terminate();
            resolve(false);
          };

          worker.postMessage({
            type: 'INIT',
            wasmBaseUrl,
            modelUrl,
            fallbackModelUrl: CDN_MODEL_FALLBACK_URL,
          });
        } catch {
          resolve(false);
        }
      });

      if (workerOk) return true;
    }

    // 2. Fallback to main-thread PoseLandmarker if worker WebGL/WASM isn't supported
    try {
      const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
      try {
        this.fallbackLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch {
        this.fallbackLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: CDN_MODEL_FALLBACK_URL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      }
      this.executionMode = 'main-thread';
      return true;
    } catch {
      return false;
    }
  }

  private attachWorkerListener(worker: Worker): void {
    worker.onmessage = (ev: MessageEvent<PoseWorkerOutgoing>) => {
      const msg = ev.data;
      if (msg.type !== 'RESULT') return;
      this.frameInFlight = false;
      this.handleLandmarksResult(
        msg.landmarks,
        msg.capturePerfMs,
        msg.inferenceMs
      );
    };
  }

  private scheduleNextVideoFrame(): void {
    if (!this.running) return;

    const videoWithRVFC = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };

    if (typeof videoWithRVFC.requestVideoFrameCallback === 'function') {
      videoWithRVFC.requestVideoFrameCallback(() => {
        this.onVideoFrame();
        this.scheduleNextVideoFrame();
      });
    } else {
      requestAnimationFrame(() => {
        this.onVideoFrame();
        this.scheduleNextVideoFrame();
      });
    }
  }

  private onVideoFrame(): void {
    if (!this.running || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const now = performance.now();
    this.recordCameraFrameTimestamp(now);

    // Zero-backlog gate: drop new inference capture if previous frame is still running
    if (this.frameInFlight) return;

    if (this.worker) {
      this.frameInFlight = true;
      createImageBitmap(this.video)
        .then((bitmap) => {
          if (!this.running || !this.worker) {
            bitmap.close();
            this.frameInFlight = false;
            return;
          }
          this.worker.postMessage(
            {
              type: 'FRAME',
              bitmap,
              capturePerfMs: now,
            },
            [bitmap]
          );
        })
        .catch(() => {
          this.frameInFlight = false;
        });
      return;
    }

    if (this.fallbackLandmarker) {
      this.frameInFlight = true;
      const t0 = performance.now();
      const ts = Math.max(this.lastMainThreadTs + 1, Math.floor(now));
      this.lastMainThreadTs = ts;
      let extracted: PoseLandmarkPoint[] | null = null;
      try {
        const res = this.fallbackLandmarker.detectForVideo(this.video, ts);
        if (res.landmarks && res.landmarks.length > 0) {
          extracted = res.landmarks[0].map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: lm.visibility ?? 1,
          }));
        }
      } catch {
        extracted = null;
      }
      const inferenceMs = performance.now() - t0;
      this.frameInFlight = false;
      this.handleLandmarksResult(extracted, now, inferenceMs);
    }
  }

  private handleLandmarksResult(
    landmarks: PoseLandmarkPoint[] | null,
    capturePerfMs: number,
    inferenceMs: number
  ): void {
    if (!this.running) return;

    this.lastInferenceMs = inferenceMs;
    const gesture = this.recognizer.processLandmarks(landmarks, capturePerfMs);
    this.latestGestureResult = gesture;
    this.lastConfidencePct = gesture.confidence * 100;
    this.lastCalibrationProgress = gesture.calibrationProgress;
    this.pendingCapturePerfMs = capturePerfMs;

    if (gesture.punchTriggered === 'LEFT') {
      this.lastRecognizedGesture = 'PUNCH_LEFT';
    } else if (gesture.punchTriggered === 'RIGHT') {
      this.lastRecognizedGesture = 'PUNCH_RIGHT';
    } else if (gesture.lean === 'LEFT') {
      this.lastRecognizedGesture = 'LEAN_LEFT';
    } else if (gesture.lean === 'RIGHT') {
      this.lastRecognizedGesture = 'LEAN_RIGHT';
    } else {
      this.lastRecognizedGesture = gesture.trackingValid ? 'NEUTRAL' : 'NO_POSE';
    }

    if (gesture.trackingLost) {
      if (this.state !== 'tracking_lost') {
        this.setState('tracking_lost');
      }
    } else if (!gesture.calibrated) {
      if (this.state !== 'calibrating') {
        this.setState('calibrating');
      }
    } else if (this.state !== 'active') {
      this.setState('active');
    }

    this.callbacks.onGestureFrame?.(gesture, capturePerfMs);
  }

  private drawPreviewOverlay(): void {
    const w = this.previewCanvas.width;
    const h = this.previewCanvas.height;
    const ctx = this.previewCtx;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Draw mirrored webcam feed
    if (this.video.readyState >= 2) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, w, h);
      ctx.restore();
    }

    // Subtle dark cyber vignette
    ctx.fillStyle = 'rgba(6, 10, 22, 0.24)';
    ctx.fillRect(0, 0, w, h);

    // Draw calibrated neutral center guide line
    const calib = this.recognizer.getCalibration();
    if (calib) {
      const cx = calib.neutralCenterMx * w;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, 8);
      ctx.lineTo(cx, h - 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw mirrored upper-body skeleton landmarks
    const kp = this.latestGestureResult?.mirroredKeypoints;
    if (kp) {
      const linePairs: [
        { x: number; y: number },
        { x: number; y: number },
        string,
      ][] = [
        [kp.leftShoulder, kp.rightShoulder, '#94a3b8'],
        [kp.leftShoulder, kp.leftElbow, '#00f0ff'],
        [kp.leftElbow, kp.leftWrist, '#00f0ff'],
        [kp.rightShoulder, kp.rightElbow, '#ff2a9d'],
        [kp.rightElbow, kp.rightWrist, '#ff2a9d'],
      ];

      ctx.lineWidth = 2.5;
      for (const [a, b, color] of linePairs) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }

      const joints: [{ x: number; y: number }, string, number][] = [
        [kp.nose, '#e2e8f0', 3.5],
        [kp.leftShoulder, '#00f0ff', 4],
        [kp.rightShoulder, '#ff2a9d', 4],
        [kp.leftWrist, '#39ff9f', 5.5],
        [kp.rightWrist, '#ffd60a', 5.5],
      ];

      for (const [pt, color, r] of joints) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private recordCameraFrameTimestamp(now: number): void {
    this.cameraFrameTimestamps.push(now);
    const cutoff = now - 1000;
    while (
      this.cameraFrameTimestamps.length > 0 &&
      this.cameraFrameTimestamps[0] < cutoff
    ) {
      this.cameraFrameTimestamps.shift();
    }
    this.cameraFps = this.cameraFrameTimestamps.length;
  }

  private stopTracks(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  private setState(state: WebcamState, errorMessage?: string): void {
    this.state = state;
    this.lastErrorMessage = errorMessage;
    this.callbacks.onStateChange?.(state, errorMessage);
  }
}
