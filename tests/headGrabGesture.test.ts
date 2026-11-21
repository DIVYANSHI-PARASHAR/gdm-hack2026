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

function makeHeadGrabPose(): PoseLandmarkPoint[] {
  const pose = makeNeutralPose();
  pose[15] = { x: 0.59, y: 0.22, z: -0.02, visibility: 0.94 };
  pose[16] = { x: 0.41, y: 0.22, z: -0.02, visibility: 0.94 };
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

describe('Post-match head grab', () => {
  it.each([false, true])('fires once after a sustained hold (calibrated=%s)', (calibrated) => {
    const { hold, step, recognizer } = makeSession(calibrated);
    const pose = makeHeadGrabPose();

    expect(hold(pose, 10).every((frame) => !frame.headGrabTriggered)).toBe(true);
    const triggered = step(pose);
    expect(triggered.headGrabHoldProgress).toBe(1);
    expect(triggered.headGrabTriggered).toBe(true);
    expect(hold(pose).every((frame) => !frame.headGrabTriggered)).toBe(true);

    recognizer.resetHeadGrabState();
    expect(hold(pose).at(-1)?.headGrabTriggered).toBe(true);
  });

  it('ignores a boxing guard, a high punch, a hug, and a single visible hand', () => {
    const { hold } = makeSession(true);
    const guard = makeNeutralPose();
    const punch = makeHeadGrabPose();
    punch[15].z = -0.6;
    const hug = makeNeutralPose();
    hug[15] = { ...hug[15], x: 0.36 };
    hug[16] = { ...hug[16], x: 0.64 };
    const oneHand = makeHeadGrabPose();
    oneHand[16].visibility = 0.1;

    for (const pose of [guard, punch, hug, oneHand]) {
      for (const frame of hold(pose)) {
        expect(frame.headGrabHoldProgress).toBe(0);
        expect(frame.headGrabTriggered).toBe(false);
      }
    }
  });

  it('does not count time between widely spaced frames toward the hold', () => {
    const { hold, step } = makeSession();
    const pose = makeHeadGrabPose();
    expect(hold(pose, 6).at(-1)?.headGrabHoldProgress).toBe(0.5);
    expect(step(pose, 1000).headGrabHoldProgress).toBe(0);
    expect(hold(pose, 9).every((frame) => !frame.headGrabTriggered)).toBe(true);
    expect(step(pose).headGrabTriggered).toBe(true);
  });

  it.each([null, makeNeutralPose()])('clears partial progress when the hold breaks', (interruption) => {
    const { hold, step } = makeSession();
    const pose = makeHeadGrabPose();
    expect(hold(pose, 6).at(-1)?.headGrabHoldProgress).toBeGreaterThan(0);
    expect(step(interruption).headGrabHoldProgress).toBe(0);
    expect(hold(pose, 10).every((frame) => !frame.headGrabTriggered)).toBe(true);
    expect(step(pose).headGrabTriggered).toBe(true);
  });
});
