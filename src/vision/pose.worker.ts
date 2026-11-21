import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseLandmarkPoint } from './gestureRecognizer';

export interface WorkerInitMessage {
  type: 'INIT';
  wasmBaseUrl: string;
  modelUrl: string;
  fallbackModelUrl: string;
}

export interface WorkerFrameMessage {
  type: 'FRAME';
  bitmap: ImageBitmap;
  capturePerfMs: number;
}

export interface WorkerStopMessage {
  type: 'STOP';
}

export type PoseWorkerIncoming =
  | WorkerInitMessage
  | WorkerFrameMessage
  | WorkerStopMessage;

export type PoseWorkerOutgoing =
  | { type: 'READY'; delegate: 'GPU' | 'CPU' }
  | { type: 'INIT_ERROR'; message: string }
  | {
      type: 'RESULT';
      landmarks: PoseLandmarkPoint[] | null;
      capturePerfMs: number;
      inferenceMs: number;
      world?: PoseLandmarkPoint[];
    };

let landmarker: PoseLandmarker | null = null;
let lastVideoTimestampMs = 0;

async function createWithModel(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  modelAssetPath: string,
  delegate: 'GPU' | 'CPU'
): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath,
      delegate,
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function initLandmarker(msg: WorkerInitMessage): Promise<void> {
  try {
    const vision = await FilesetResolver.forVisionTasks(msg.wasmBaseUrl);
    const canTryGpu = typeof OffscreenCanvas !== 'undefined';

    const modelCandidates = [msg.modelUrl, msg.fallbackModelUrl];
    let initializedDelegate: 'GPU' | 'CPU' = 'CPU';

    for (const modelUrl of modelCandidates) {
      if (canTryGpu) {
        try {
          landmarker = await createWithModel(vision, modelUrl, 'GPU');
          initializedDelegate = 'GPU';
          break;
        } catch {
          // Fall through to CPU delegate in worker
        }
      }
      try {
        landmarker = await createWithModel(vision, modelUrl, 'CPU');
        initializedDelegate = 'CPU';
        break;
      } catch {
        // Try fallback model URL
      }
    }

    if (!landmarker) {
      throw new Error('Unable to initialize MediaPipe PoseLandmarker in worker.');
    }

    const readyMsg: PoseWorkerOutgoing = {
      type: 'READY',
      delegate: initializedDelegate,
    };
    self.postMessage(readyMsg);
  } catch (err) {
    const errMsg: PoseWorkerOutgoing = {
      type: 'INIT_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errMsg);
  }
}

self.onmessage = (event: MessageEvent<PoseWorkerIncoming>) => {
  const msg = event.data;

  if (msg.type === 'INIT') {
    void initLandmarker(msg);
    return;
  }

  if (msg.type === 'STOP') {
    if (landmarker) {
      landmarker.close();
      landmarker = null;
    }
    self.close();
    return;
  }

  if (msg.type === 'FRAME') {
    const t0 = performance.now();
    let world: PoseLandmarkPoint[] | undefined;
    let extracted: PoseLandmarkPoint[] | null = null;

    try {
      if (landmarker) {
        const monotonicTs = Math.max(
          lastVideoTimestampMs + 1,
          Math.floor(msg.capturePerfMs)
        );
        lastVideoTimestampMs = monotonicTs;

        const result = landmarker.detectForVideo(msg.bitmap, monotonicTs);
        if (result.landmarks && result.landmarks.length > 0) {
          world = result.worldLandmarks[0];
          extracted = result.landmarks[0].map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: lm.visibility ?? 1,
          }));
        }
      }
    } catch {
      extracted = null;
    } finally {
      msg.bitmap.close();
    }

    const inferenceMs = performance.now() - t0;
    const out: PoseWorkerOutgoing = {
      type: 'RESULT',
      landmarks: extracted,
      world,
      capturePerfMs: msg.capturePerfMs,
      inferenceMs,
    };
    self.postMessage(out);
  }
};
