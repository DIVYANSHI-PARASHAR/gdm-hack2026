import { describe, expect, it } from 'vitest';
import {
  GestureRecognizer,
  PoseLandmarkPoint,
} from '../src/vision/gestureRecognizer';

/**
 * Helper to create a 33-point raw camera PoseLandmark array.
 * Note: In an unmirrored front-facing webcam image:
 * - Anatomical Left Shoulder (11) is on the right side of raw frame (e.g. raw.x = 0.62 -> mirrored mx = 0.38, LEFT side of screen).
 * - Anatomical Right Shoulder (12) is on the left side of raw frame (e.g. raw.x = 0.38 -> mirrored mx = 0.62, RIGHT side of screen).
 */
function makeNeutralPose(): PoseLandmarkPoint[] {
  const pts: PoseLandmarkPoint[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.98,
  }));

  // Nose centered
  pts[0] = { x: 0.5, y: 0.28, z: -0.05, visibility: 0.99 };
  // Left shoulder (11) & Right shoulder (12)
  pts[11] = { x: 0.62, y: 0.46, z: 0.0, visibility: 0.99 };
  pts[12] = { x: 0.38, y: 0.46, z: 0.0, visibility: 0.99 };
  // Elbows bent in guard
  pts[13] = { x: 0.65, y: 0.62, z: -0.04, visibility: 0.98 };
  pts[14] = { x: 0.35, y: 0.62, z: -0.04, visibility: 0.98 };
  // Wrists held near upper chest/chin guard
  pts[15] = { x: 0.58, y: 0.48, z: -0.08, visibility: 0.98 };
  pts[16] = { x: 0.42, y: 0.48, z: -0.08, visibility: 0.98 };

  return pts;
}

describe('GestureRecognizer', () => {
  it('calibrates neutral pose and maps physical leans in mirrored screen space', () => {
    const rec = new GestureRecognizer();
    let t = 0;

    // Feed 16 steady frames to finish neutral-pose calibration
    for (let i = 0; i < 16; i++) {
      t += 33;
      const res = rec.processLandmarks(makeNeutralPose(), t);
      if (i === 15) {
        expect(res.calibrated).toBe(true);
      }
    }

    // Subtle idle motion does NOT trigger lean or punch
    const idlePose = makeNeutralPose();
    idlePose[0].x += 0.015;
    idlePose[11].x += 0.015;
    idlePose[12].x += 0.015;
    t += 33;
    const idleRes = rec.processLandmarks(idlePose, t);
    expect(idleRes.lean).toBe('NONE');
    expect(idleRes.punchTriggered).toBeNull();

    // Player leans physically LEFT -> moves toward anatomical left shoulder -> raw.x increases -> mirrored mx decreases!
    const leanLeftPose = makeNeutralPose();
    for (const idx of [0, 11, 12, 13, 14, 15, 16]) {
      leanLeftPose[idx].x += 0.1;
    }
    t += 33;
    const leftRes = rec.processLandmarks(leanLeftPose, t);
    expect(leftRes.lean).toBe('LEFT');

    // Player leans physically RIGHT -> raw.x decreases -> mirrored mx increases!
    const leanRightPose = makeNeutralPose();
    for (const idx of [0, 11, 12, 13, 14, 15, 16]) {
      leanRightPose[idx].x -= 0.1;
    }
    t += 33;
    const rightRes = rec.processLandmarks(leanRightPose, t);
    expect(rightRes.lean).toBe('RIGHT');
  });

  it('detects left and right punch onset and suppresses retraction false triggers', () => {
    const rec = new GestureRecognizer();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      t += 33;
      rec.processLandmarks(makeNeutralPose(), t);
    }

    // Baseline frame after calibration
    t += 33;
    rec.processLandmarks(makeNeutralPose(), t);

    // Throw fast anatomical LEFT punch toward camera & centerline (landmarks 13 & 15 extend)
    const leftPunchPose = makeNeutralPose();
    leftPunchPose[13] = { x: 0.56, y: 0.45, z: -0.22, visibility: 0.99 };
    leftPunchPose[15] = { x: 0.5, y: 0.42, z: -0.45, visibility: 0.99 };
    t += 33;
    const punchOnset = rec.processLandmarks(leftPunchPose, t);
    expect(punchOnset.punchTriggered).toBe('LEFT');

    // Holding extended fist or retracting back to guard MUST NOT re-trigger
    t += 33;
    expect(rec.processLandmarks(leftPunchPose, t).punchTriggered).toBeNull();

    const midRetractPose = makeNeutralPose();
    midRetractPose[15] = { x: 0.54, y: 0.45, z: -0.22, visibility: 0.99 };
    t += 33;
    expect(rec.processLandmarks(midRetractPose, t).punchTriggered).toBeNull();

    // Return completely to guard and wait past refractory window
    t += 240;
    expect(rec.processLandmarks(makeNeutralPose(), t).punchTriggered).toBeNull();

    // Now throw anatomical RIGHT punch (landmarks 14 & 16 extend)
    const rightPunchPose = makeNeutralPose();
    rightPunchPose[14] = { x: 0.44, y: 0.45, z: -0.22, visibility: 0.99 };
    rightPunchPose[16] = { x: 0.5, y: 0.42, z: -0.45, visibility: 0.99 };
    t += 33;
    const rightOnset = rec.processLandmarks(rightPunchPose, t);
    expect(rightOnset.punchTriggered).toBe('RIGHT');
  });

  it('flags trackingLost after sustained low landmark visibility and recovers cleanly', () => {
    const rec = new GestureRecognizer();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      t += 33;
      rec.processLandmarks(makeNeutralPose(), t);
    }

    // Drop landmarks for > 360ms
    t += 100;
    expect(rec.processLandmarks(null, t).trackingLost).toBe(false);
    t += 400;
    expect(rec.processLandmarks(null, t).trackingLost).toBe(true);

    // Step back into view -> recovers immediately
    t += 33;
    const recovered = rec.processLandmarks(makeNeutralPose(), t);
    expect(recovered.trackingLost).toBe(false);
    expect(recovered.trackingValid).toBe(true);
  });
});
