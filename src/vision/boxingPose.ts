import type { HandOffset, PoseLandmarkPoint } from './gestureRecognizer';

export interface ArmMeasure {
  depth: number;
  straightness: number;
  palm: number;
}

export interface BoxingHand extends HandOffset {
  reach: number;
  elbow: { x: number; y: number; z: number } | null;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const distance = (a: PoseLandmarkPoint, b: PoseLandmarkPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function measureArm(
  image: PoseLandmarkPoint[], world: PoseLandmarkPoint[] | undefined, right: boolean, shoulderWidth: number,
) {
  const i = right ? 1 : 0;
  const wrist = image[15 + i];
  const points = [image[17 + i], image[19 + i], image[21 + i]].filter(
    (p) => p && (p.visibility ?? 1) >= 0.45,
  );
  const palm = points.length ? points.reduce(
    (sum, p) => sum + Math.hypot(p.x - wrist.x, p.y - wrist.y), 0,
  ) / (points.length * shoulderWidth) : 0;
  const pose = world ?? image;
  const [s, e, h] = [pose[11 + i], pose[13 + i], pose[15 + i]];
  const length = Math.max(0.001, distance(s, e) + distance(e, h));
  return {
    measure: { depth: (s.z - h.z) / length, straightness: distance(s, h) / length, palm },
    // Mirrored camera-local axes: right, up, away from the eye.
    elbow: (image[13 + i].visibility ?? 1) >= 0.45
      ? { x: (s.x - e.x) / length, y: (s.y - e.y) / length, z: (e.z - s.z) / length }
      : null,
  };
}

export function averageArm(samples: ArmMeasure[]): ArmMeasure {
  const mean = (key: keyof ArmMeasure) => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  return { depth: mean('depth'), straightness: mean('straightness'), palm: mean('palm') };
}

export function boxingHand(
  hand: HandOffset, guard: HandOffset, arm: ReturnType<typeof measureArm>, neutral: ArmMeasure,
): BoxingHand {
  const x = hand.x - guard.x;
  const y = hand.y - guard.y;
  const forward = hand.forward - guard.forward;
  const { depth, straightness, palm } = arm.measure;
  const opening = clamp((straightness - neutral.straightness) / Math.max(0.18, 0.96 - neutral.straightness));
  const depthDrive = clamp(Math.max((depth - neutral.depth) / 0.38, forward / 0.85));
  // The elbow can hide behind the wrist on head-on jabs. Apparent hand growth
  // supplies a second depth cue, but only when the tracked fingers are visible.
  const palmDrive = neutral.palm > 0.025 ? clamp((palm / neutral.palm - 1.12) / 0.85) : 0;
  const toward = Math.max(depthDrive, palmDrive * 0.82);
  const reach = clamp(toward * (0.62 + 0.38 * opening) + 0.25 * opening * clamp(depth / 0.55));
  return { x, y, forward, reach, elbow: arm.elbow };
}
