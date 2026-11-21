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

function makeRightHandRaisePose(): PoseLandmarkPoint[] {
  const pose = makeNeutralPose();
  pose[14] = { x: 0.34, y: 0.25, z: -0.03, visibility: 0.94 };
  pose[16] = { x: 0.33, y: 0.09, z: -0.04, visibility: 0.94 };
  return pose;
}

function makeSession(calibrated = false) {
  const recognizer = new GestureRecognizer();
  let timestamp = 0;
  const step = (pose: PoseLandmarkPoint[] | null, frameMs = 34) =>
    recognizer.processLandmarks(pose, (timestamp += frameMs));
  const hold = (pose: PoseLandmarkPoint[], frames = 11) =>
    Array.from({ length: frames }, () => step(pose));
  if (calibrated) {
    hold(makeNeutralPose(), 20);
    expect(recognizer.isCalibrated()).toBe(true);
  }
  return { recognizer, step, hold };
}

describe('Post-match right-hand raise', () => {
  it.each([false, true])('fires once after a sustained hold (calibrated=%s)', (calibrated) => {
    const { hold, step, recognizer } = makeSession(calibrated);
    const pose = makeRightHandRaisePose();

    expect(hold(pose, 10).every((frame) => !frame.rightHandRaiseTriggered)).toBe(true);
    const triggered = step(pose);
    expect(triggered.rightHandRaiseHoldProgress).toBe(1);
    expect(triggered.rightHandRaiseTriggered).toBe(true);
    expect(hold(pose).every((frame) => !frame.rightHandRaiseTriggered)).toBe(true);

    recognizer.resetRightHandRaiseState();
    expect(hold(pose).at(-1)?.rightHandRaiseTriggered).toBe(true);
  });

  it('ignores a left-hand raise, a boxing guard, and an occluded right wrist', () => {
    const { hold } = makeSession(true);
    const guard = makeNeutralPose();
    const leftArm = makeNeutralPose();
    leftArm[13] = { x: 0.66, y: 0.25, z: -0.03 };
    leftArm[15] = { x: 0.67, y: 0.09, z: -0.04 };
    const occluded = makeRightHandRaisePose();
    occluded[16].visibility = 0.1;
    const handsAtTemples = makeNeutralPose();
    handsAtTemples[15] = { x: 0.59, y: 0.22, z: -0.02 };
    handsAtTemples[16] = { x: 0.41, y: 0.22, z: -0.02 };

    for (const pose of [guard, leftArm, occluded, handsAtTemples]) {
      for (const frame of hold(pose)) {
        expect(frame.rightHandRaiseHoldProgress).toBe(0);
        expect(frame.rightHandRaiseTriggered).toBe(false);
      }
    }
  });

  it('accepts the angled upper arm and vertical forearm shown in the camera preview', () => {
    const { hold } = makeSession(true);
    const pose = makeNeutralPose();
    // Approximate raw x/y coordinates from the mirrored preview. Depth is simulated.
    pose[0] = { x: 0.54, y: 0.56, z: -0.08 };
    pose[11] = { x: 0.67, y: 0.82, z: 0 };
    pose[12] = { x: 0.46, y: 0.59, z: 0.02 };
    pose[14] = { x: 0.32, y: 0.35, z: -0.14 };
    pose[16] = { x: 0.32, y: 0.11, z: -0.18 };

    expect(hold(pose).at(-1)?.rightHandRaiseTriggered).toBe(true);
  });

  it('completes with slow inference and low arm landmark confidence', () => {
    const { step } = makeSession(true);
    const pose = makeNeutralPose();
    // Approximate the second preview, with simulated confidence and depth noise.
    pose[0] = { x: 0.56, y: 0.67, z: 0 };
    pose[11].visibility = 0.15;
    pose[12] = { x: 0.46, y: 0.81, z: 0 };
    pose[14] = { x: 0.38, y: 0.58, z: -0.12, visibility: 0.18 };
    pose[16] = { x: 0.43, y: 0.31, z: -0.6, visibility: 0.28 };

    expect(step(pose, 200).rightHandRaiseHoldProgress).toBe(0);
    for (let i = 0; i < 2; i++) {
      expect(step(pose, 200).rightHandRaiseTriggered).toBe(false);
    }
    expect(step(pose, 200).rightHandRaiseTriggered).toBe(true);
  });

  it('uses anatomical right-arm landmarks when the image x coordinates are flipped', () => {
    const { hold } = makeSession();
    const pose = makeRightHandRaisePose().map((point) => ({ ...point, x: 1 - point.x }));
    expect(hold(pose).at(-1)?.rightHandRaiseTriggered).toBe(true);
  });

  it('does not count time between widely spaced frames toward the hold', () => {
    const { hold, step } = makeSession();
    const pose = makeRightHandRaisePose();
    expect(hold(pose, 6).at(-1)?.rightHandRaiseHoldProgress).toBe(0.5);
    expect(step(pose, 1000).rightHandRaiseHoldProgress).toBe(0);
    expect(hold(pose, 9).every((frame) => !frame.rightHandRaiseTriggered)).toBe(true);
    expect(step(pose).rightHandRaiseTriggered).toBe(true);
  });

  it.each([null, makeNeutralPose()])('clears partial progress when the hold breaks', (interruption) => {
    const { hold, step } = makeSession();
    const pose = makeRightHandRaisePose();
    expect(hold(pose, 6).at(-1)?.rightHandRaiseHoldProgress).toBeGreaterThan(0);
    expect(step(interruption).rightHandRaiseHoldProgress).toBe(0);
    expect(hold(pose, 10).every((frame) => !frame.rightHandRaiseTriggered)).toBe(true);
    expect(step(pose).rightHandRaiseTriggered).toBe(true);
  });
});
