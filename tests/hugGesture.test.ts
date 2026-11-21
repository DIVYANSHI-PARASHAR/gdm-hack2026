import { describe, expect, it } from 'vitest';
import {
  GestureRecognizer,
  PoseLandmarkPoint,
} from '../src/vision/gestureRecognizer';

function makeNeutralPose(): PoseLandmarkPoint[] {
  const points: PoseLandmarkPoint[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0.0,
    visibility: 0.95,
  }));

  // Mirrors: left side of player camera is x ~ 0.65, right side is x ~ 0.35
  // Mirrored player screen: left shoulder x = 1 - 0.65 = 0.35, right shoulder x = 1 - 0.35 = 0.65
  points[0] = { x: 0.5, y: 0.28, z: -0.05, visibility: 0.98 }; // Nose
  points[11] = { x: 0.65, y: 0.42, z: 0.0, visibility: 0.95 }; // Left Shoulder
  points[12] = { x: 0.35, y: 0.42, z: 0.0, visibility: 0.95 }; // Right Shoulder
  points[13] = { x: 0.68, y: 0.62, z: -0.08, visibility: 0.92 }; // Left Elbow
  points[14] = { x: 0.32, y: 0.62, z: -0.08, visibility: 0.92 }; // Right Elbow

  // Standard neutral boxing guard: fists up near chin/cheeks, on their own side of body
  // Left wrist at x=0.58 (mirrored 0.42), Right wrist at x=0.42 (mirrored 0.58)
  points[15] = { x: 0.58, y: 0.48, z: -0.22, visibility: 0.9 }; // Left Wrist
  points[16] = { x: 0.42, y: 0.48, z: -0.22, visibility: 0.9 }; // Right Wrist

  return points;
}

function makeSelfHugPose(): PoseLandmarkPoint[] {
  const points = makeNeutralPose();
  // Deliberate self-hug: arms wrap across chest toward opposite shoulders
  // Left wrist crosses to opposite (right) shoulder: raw camera x=0.38 (mirrored 0.62), near right shoulder (mirrored 0.65)
  points[15] = { x: 0.38, y: 0.46, z: -0.08, visibility: 0.94 };
  // Right wrist crosses to opposite (left) shoulder: raw camera x=0.62 (mirrored 0.38), near left shoulder (mirrored 0.35)
  points[16] = { x: 0.62, y: 0.48, z: -0.08, visibility: 0.94 };
  return points;
}

describe('Post-Match Self-Hug Detection', () => {
  it('does NOT trigger a hug during standard boxing guard, even when held for several seconds', () => {
    const rec = new GestureRecognizer();
    let t = 0;

    // Calibrate neutral guard
    for (let i = 0; i < 16; i++) {
      rec.processLandmarks(makeNeutralPose(), (t += 33));
    }
    expect(rec.isCalibrated()).toBe(true);

    // Hold neutral boxing guard for 3 seconds (90 frames)
    for (let i = 0; i < 90; i++) {
      const frame = rec.processLandmarks(makeNeutralPose(), (t += 33));
      expect(frame.hugTriggered).toBe(false);
      expect(frame.hugHoldProgress).toBe(0);
    }
  });

  it('does NOT trigger a hug during punches (jab, cross, hook)', () => {
    const rec = new GestureRecognizer();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      rec.processLandmarks(makeNeutralPose(), (t += 33));
    }

    // Straight left punch
    const punchPose = makeNeutralPose();
    punchPose[15].z = -0.55;
    punchPose[15].x = 0.52;
    const punchFrame = rec.processLandmarks(punchPose, (t += 33));
    expect(punchFrame.hugTriggered).toBe(false);
    expect(punchFrame.hugHoldProgress).toBe(0);

    // Right hook
    const hookPose = makeNeutralPose();
    hookPose[14].y = 0.52;
    hookPose[16].x = 0.49;
    const hookFrame = rec.processLandmarks(hookPose, (t += 33));
    expect(hookFrame.hugTriggered).toBe(false);
    expect(hookFrame.hugHoldProgress).toBe(0);
  });

  it('detects a deliberate self-hug only after crossing arms and holding for the required duration', () => {
    const rec = new GestureRecognizer();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      rec.processLandmarks(makeNeutralPose(), (t += 33));
    }

    const hugPose = makeSelfHugPose();

    // Frame 1 of hug: starts accumulating hold progress
    const f1 = rec.processLandmarks(hugPose, (t += 33));
    expect(f1.hugTriggered).toBe(false);
    expect(f1.hugHoldProgress).toBeGreaterThan(0);
    expect(f1.hugHoldProgress).toBeLessThan(0.3);

    // Hold for ~300ms (not yet at 650ms threshold)
    for (let i = 0; i < 8; i++) {
      const mid = rec.processLandmarks(hugPose, (t += 33));
      expect(mid.hugTriggered).toBe(false);
      expect(mid.hugHoldProgress).toBeGreaterThan(0);
      expect(mid.hugHoldProgress).toBeLessThan(1.0);
    }

    // Continue holding past 650ms
    let triggered = false;
    for (let i = 0; i < 15; i++) {
      const frame = rec.processLandmarks(hugPose, (t += 33));
      if (frame.hugTriggered) {
        triggered = true;
        expect(frame.hugHoldProgress).toBe(1);
        break;
      }
    }
    expect(triggered).toBe(true);

    // Further frames while still holding should not repeatedly re-trigger
    const subsequent = rec.processLandmarks(hugPose, (t += 33));
    expect(subsequent.hugTriggered).toBe(false);
  });

  it('resets hold progress if arms uncross before reaching full hold threshold', () => {
    const rec = new GestureRecognizer();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      rec.processLandmarks(makeNeutralPose(), (t += 33));
    }

    const hugPose = makeSelfHugPose();
    // Start hug for ~250ms
    for (let i = 0; i < 7; i++) {
      rec.processLandmarks(hugPose, (t += 33));
    }

    // Release back to neutral guard
    const releaseFrame = rec.processLandmarks(makeNeutralPose(), (t += 100));
    expect(releaseFrame.hugTriggered).toBe(false);
    expect(releaseFrame.hugHoldProgress).toBeLessThan(0.15);

    // Stay in neutral guard
    const clearFrame = rec.processLandmarks(makeNeutralPose(), (t += 100));
    expect(clearFrame.hugHoldProgress).toBe(0);
    expect(clearFrame.hugTriggered).toBe(false);
  });

  it('resetHugState clears fired state for subsequent matches', () => {
    const rec = new GestureRecognizer();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      rec.processLandmarks(makeNeutralPose(), (t += 33));
    }

    const hugPose = makeSelfHugPose();
    // Hold until fired
    for (let i = 0; i < 25; i++) {
      rec.processLandmarks(hugPose, (t += 33));
    }

    // Reset for rematch
    rec.resetHugState();

    // Now a new self-hug can accumulate and fire again
    let refired = false;
    for (let i = 0; i < 25; i++) {
      const f = rec.processLandmarks(hugPose, (t += 33));
      if (f.hugTriggered) {
        refired = true;
        break;
      }
    }
    expect(refired).toBe(true);
  });

  it('effortlessly detects a lower chest/rib wrap even when wrists partially occlude behind arms', () => {
    const rec = new GestureRecognizer();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      rec.processLandmarks(makeNeutralPose(), (t += 33));
    }

    // Natural relaxed chest/rib hug with lower wrist visibility (hands tucked around sides)
    const relaxedHug = makeNeutralPose();
    relaxedHug[15] = { x: 0.42, y: 0.64, z: -0.04, visibility: 0.28 };
    relaxedHug[16] = { x: 0.58, y: 0.66, z: -0.04, visibility: 0.28 };

    let triggered = false;
    for (let i = 0; i < 14; i++) {
      const f = rec.processLandmarks(relaxedHug, (t += 33));
      if (f.hugTriggered) {
        triggered = true;
        break;
      }
    }
    expect(triggered).toBe(true);
  });

  it('detects crossed arms on real laptop webcam MediaPipe Z-depths even before guard calibration completes', () => {
    const rec = new GestureRecognizer();
    let t = 0;

    // Real MediaPipe Pose Landmarker Lite outputs large negative Z on folded chest wrists (-0.75 to -1.0)
    // and low elbow/wrist visibility near bottom of laptop frame
    const realWebcamFoldedArms = makeNeutralPose();
    realWebcamFoldedArms[11] = { x: 0.68, y: 0.58, z: -0.12, visibility: 0.92 };
    realWebcamFoldedArms[12] = { x: 0.32, y: 0.58, z: -0.12, visibility: 0.92 };
    realWebcamFoldedArms[13] = { x: 0.72, y: 0.88, z: -0.35, visibility: 0.22 };
    realWebcamFoldedArms[14] = { x: 0.28, y: 0.88, z: -0.35, visibility: 0.22 };
    realWebcamFoldedArms[15] = { x: 0.45, y: 0.76, z: -0.88, visibility: 0.35 };
    realWebcamFoldedArms[16] = { x: 0.55, y: 0.78, z: -0.88, visibility: 0.35 };

    let triggered = false;
    for (let i = 0; i < 14; i++) {
      const f = rec.processLandmarks(realWebcamFoldedArms, (t += 33));
      if (f.hugTriggered) {
        triggered = true;
        break;
      }
    }
    expect(triggered).toBe(true);
  });
});
