export interface PoseLandmarkPoint {
  x: number; // Raw camera normalized 0..1 (unmirrored)
  y: number; // Normalized 0..1 top-to-bottom
  z: number; // Relative depth (negative = closer to camera)
  visibility?: number;
}

export interface CalibrationProfile {
  neutralCenterMx: number;
  neutralShoulderWidth: number;
  neutralLeftExt: number;
  neutralRightExt: number;
  calibratedAtMs: number;
}

export type ArmPhase = 'GUARD' | 'EXTENDED';

export interface GestureFrameResult {
  calibrated: boolean;
  calibrationProgress: number; // 0..1
  trackingValid: boolean;
  trackingLost: boolean;
  confidence: number; // 0..1
  lean: 'LEFT' | 'RIGHT' | 'NONE';
  leanScore: number; // Negative = left, positive = right (mirrored player space)
  punchTriggered: 'LEFT' | 'RIGHT' | null;
  leftExtDelta: number;
  rightExtDelta: number;
  mirroredKeypoints: {
    nose: { x: number; y: number };
    leftShoulder: { x: number; y: number };
    rightShoulder: { x: number; y: number };
    leftElbow: { x: number; y: number };
    rightElbow: { x: number; y: number };
    leftWrist: { x: number; y: number };
    rightWrist: { x: number; y: number };
  } | null;
}

const MIN_LANDMARK_CONFIDENCE = 0.45;
const TRACKING_LOSS_HOLD_MS = 360;
const CALIBRATION_REQUIRED_SAMPLES = 16;

const LEAN_ENTER_THRESHOLD = 0.26;
const LEAN_EXIT_THRESHOLD = 0.14;

const PUNCH_EXT_DELTA_THRESHOLD = 0.23;
const PUNCH_RETRACT_RESET_DELTA = 0.12;
const PUNCH_EXT_VELOCITY_THRESHOLD = 1.35; // units/sec
const PUNCH_WRIST_SPEED_THRESHOLD = 1.1; // shoulder-widths/sec
const PUNCH_REFRACTORY_MS = 220;

interface CalibrationSample {
  centerMx: number;
  shoulderWidth: number;
  leftExt: number;
  rightExt: number;
}

export class GestureRecognizer {
  private calibration: CalibrationProfile | null = null;
  private calibSamples: CalibrationSample[] = [];
  private isCalibrating = true;

  private currentLean: 'LEFT' | 'RIGHT' | 'NONE' = 'NONE';
  private leftArmPhase: ArmPhase = 'GUARD';
  private rightArmPhase: ArmPhase = 'GUARD';
  private leftLastPunchMs = -9999;
  private rightLastPunchMs = -9999;

  private prevTimestampMs: number | null = null;
  private prevLeftExt = 0;
  private prevRightExt = 0;
  private prevLeftWristRel = { x: 0, y: 0 };
  private prevRightWristRel = { x: 0, y: 0 };
  private prevLeanScore = 0;

  private lowConfidenceSinceMs: number | null = null;
  private trackingLost = false;

  public resetCalibration(): void {
    this.calibration = null;
    this.calibSamples = [];
    this.isCalibrating = true;
    this.currentLean = 'NONE';
    this.leftArmPhase = 'GUARD';
    this.rightArmPhase = 'GUARD';
    this.prevTimestampMs = null;
  }

  public isCalibrated(): boolean {
    return this.calibration !== null && !this.isCalibrating;
  }

  public getCalibration(): CalibrationProfile | null {
    return this.calibration;
  }

  public setCalibrationProfile(profile: CalibrationProfile): void {
    this.calibration = { ...profile };
    this.isCalibrating = false;
  }

  public processLandmarks(
    landmarks: PoseLandmarkPoint[] | null | undefined,
    timestampMs: number
  ): GestureFrameResult {
    if (!landmarks || landmarks.length < 17) {
      return this.handleMissingPose(timestampMs, 0);
    }

    const nose = landmarks[0];
    const lShoulder = landmarks[11];
    const rShoulder = landmarks[12];
    const lElbow = landmarks[13];
    const rElbow = landmarks[14];
    const lWrist = landmarks[15];
    const rWrist = landmarks[16];

    const keyVisibility = [
      nose.visibility ?? 1,
      lShoulder.visibility ?? 1,
      rShoulder.visibility ?? 1,
      lElbow.visibility ?? 1,
      rElbow.visibility ?? 1,
      lWrist.visibility ?? 1,
      rWrist.visibility ?? 1,
    ];
    const avgConfidence =
      keyVisibility.reduce((acc, v) => acc + v, 0) / keyVisibility.length;
    const shouldersVisible =
      (lShoulder.visibility ?? 1) >= MIN_LANDMARK_CONFIDENCE &&
      (rShoulder.visibility ?? 1) >= MIN_LANDMARK_CONFIDENCE;

    if (!shouldersVisible || avgConfidence < MIN_LANDMARK_CONFIDENCE) {
      return this.handleMissingPose(timestampMs, avgConfidence);
    }

    // Tracking is valid
    this.lowConfidenceSinceMs = null;
    this.trackingLost = false;

    // Convert raw camera X to mirrored player-screen X (0 = left edge, 1 = right edge)
    const mNose = { x: 1 - nose.x, y: nose.y, z: nose.z };
    const mLSh = { x: 1 - lShoulder.x, y: lShoulder.y, z: lShoulder.z };
    const mRSh = { x: 1 - rShoulder.x, y: rShoulder.y, z: rShoulder.z };
    const mLEl = { x: 1 - lElbow.x, y: lElbow.y, z: lElbow.z };
    const mREl = { x: 1 - rElbow.x, y: rElbow.y, z: rElbow.z };
    const mLWr = { x: 1 - lWrist.x, y: lWrist.y, z: lWrist.z };
    const mRWr = { x: 1 - rWrist.x, y: rWrist.y, z: rWrist.z };

    const mirroredKeypoints = {
      nose: { x: mNose.x, y: mNose.y },
      leftShoulder: { x: mLSh.x, y: mLSh.y },
      rightShoulder: { x: mRSh.x, y: mRSh.y },
      leftElbow: { x: mLEl.x, y: mLEl.y },
      rightElbow: { x: mREl.x, y: mREl.y },
      leftWrist: { x: mLWr.x, y: mLWr.y },
      rightWrist: { x: mRWr.x, y: mRWr.y },
    };

    const shoulderMidMx = (mLSh.x + mRSh.x) * 0.5;
    const upperBodyMx = shoulderMidMx * 0.65 + mNose.x * 0.35;
    const liveShoulderWidth = Math.max(
      0.08,
      Math.hypot(mRSh.x - mLSh.x, mRSh.y - mLSh.y)
    );

    const leftExt = this.computeArmExtension(mLSh, mLEl, mLWr, -1, liveShoulderWidth);
    const rightExt = this.computeArmExtension(mRSh, mREl, mRWr, 1, liveShoulderWidth);

    // Handle calibration collection
    if (this.isCalibrating || !this.calibration) {
      // Ensure user is reasonably centered inside camera frame during calibration
      if (upperBodyMx > 0.2 && upperBodyMx < 0.8) {
        this.calibSamples.push({
          centerMx: upperBodyMx,
          shoulderWidth: liveShoulderWidth,
          leftExt,
          rightExt,
        });
      }

      const progress = Math.min(
        1,
        this.calibSamples.length / CALIBRATION_REQUIRED_SAMPLES
      );

      if (this.calibSamples.length >= CALIBRATION_REQUIRED_SAMPLES) {
        const n = this.calibSamples.length;
        this.calibration = {
          neutralCenterMx:
            this.calibSamples.reduce((s, c) => s + c.centerMx, 0) / n,
          neutralShoulderWidth:
            this.calibSamples.reduce((s, c) => s + c.shoulderWidth, 0) / n,
          neutralLeftExt:
            this.calibSamples.reduce((s, c) => s + c.leftExt, 0) / n,
          neutralRightExt:
            this.calibSamples.reduce((s, c) => s + c.rightExt, 0) / n,
          calibratedAtMs: timestampMs,
        };
        this.isCalibrating = false;
        this.prevTimestampMs = timestampMs;
        this.prevLeftExt = leftExt;
        this.prevRightExt = rightExt;
        this.prevLeftWristRel = {
          x: (mLWr.x - mLSh.x) / liveShoulderWidth,
          y: (mLWr.y - mLSh.y) / liveShoulderWidth,
        };
        this.prevRightWristRel = {
          x: (mRWr.x - mRSh.x) / liveShoulderWidth,
          y: (mRWr.y - mRSh.y) / liveShoulderWidth,
        };
      }

      return {
        calibrated: !this.isCalibrating,
        calibrationProgress: progress,
        trackingValid: true,
        trackingLost: false,
        confidence: avgConfidence,
        lean: 'NONE',
        leanScore: 0,
        punchTriggered: null,
        leftExtDelta: 0,
        rightExtDelta: 0,
        mirroredKeypoints,
      };
    }

    // Compute normalized upper-body lean displacement + subtle shoulder tilt assist
    const refWidth =
      this.calibration.neutralShoulderWidth * 0.5 + liveShoulderWidth * 0.5;
    const rawDisplacement = (upperBodyMx - this.calibration.neutralCenterMx) / refWidth;
    const shoulderTilt = (mRSh.y - mLSh.y) / liveShoulderWidth;
    // Leaning right lowers right shoulder (mRSh.y > mLSh.y -> positive shoulderTilt)
    const leanScore = rawDisplacement * 0.82 + shoulderTilt * 0.22;

    // Lean hysteresis state machine
    if (this.currentLean === 'NONE') {
      if (leanScore <= -LEAN_ENTER_THRESHOLD) {
        this.currentLean = 'LEFT';
      } else if (leanScore >= LEAN_ENTER_THRESHOLD) {
        this.currentLean = 'RIGHT';
      }
    } else if (this.currentLean === 'LEFT') {
      if (leanScore >= LEAN_ENTER_THRESHOLD) {
        this.currentLean = 'RIGHT';
      } else if (leanScore > -LEAN_EXIT_THRESHOLD) {
        this.currentLean = 'NONE';
      }
    } else if (this.currentLean === 'RIGHT') {
      if (leanScore <= -LEAN_ENTER_THRESHOLD) {
        this.currentLean = 'LEFT';
      } else if (leanScore < LEAN_EXIT_THRESHOLD) {
        this.currentLean = 'NONE';
      }
    }

    // Compute velocities for punch detection
    const dtSec =
      this.prevTimestampMs !== null
        ? Math.max(0.005, Math.min(0.2, (timestampMs - this.prevTimestampMs) / 1000))
        : 0.033;

    const leanVelocity = Math.abs(leanScore - this.prevLeanScore) / dtSec;
    const leftWristRel = {
      x: (mLWr.x - mLSh.x) / liveShoulderWidth,
      y: (mLWr.y - mLSh.y) / liveShoulderWidth,
    };
    const rightWristRel = {
      x: (mRWr.x - mRSh.x) / liveShoulderWidth,
      y: (mRWr.y - mRSh.y) / liveShoulderWidth,
    };

    const leftExtDelta = leftExt - this.calibration.neutralLeftExt;
    const rightExtDelta = rightExt - this.calibration.neutralRightExt;

    let punchTriggered: 'LEFT' | 'RIGHT' | null = null;

    if (this.prevTimestampMs !== null) {
      const leftExtVel = (leftExt - this.prevLeftExt) / dtSec;
      const rightExtVel = (rightExt - this.prevRightExt) / dtSec;

      const leftWristSpeed =
        Math.hypot(
          leftWristRel.x - this.prevLeftWristRel.x,
          leftWristRel.y - this.prevLeftWristRel.y
        ) / dtSec +
        Math.max(0, leftExtVel) * 0.45;

      const rightWristSpeed =
        Math.hypot(
          rightWristRel.x - this.prevRightWristRel.x,
          rightWristRel.y - this.prevRightWristRel.y
        ) / dtSec +
        Math.max(0, rightExtVel) * 0.45;

      // Suppress accidental punch triggers during rapid whole-body sway/lean onset
      const torsoRapidSway = leanVelocity > 2.9;

      // Update Left Arm Hysteresis (prevents retraction double-triggers)
      if (this.leftArmPhase === 'EXTENDED') {
        if (
          leftExtVel <= 0.15 &&
          leftExtDelta <= PUNCH_RETRACT_RESET_DELTA &&
          timestampMs - this.leftLastPunchMs >= PUNCH_REFRACTORY_MS
        ) {
          this.leftArmPhase = 'GUARD';
        }
      } else if (
        !torsoRapidSway &&
        (lWrist.visibility ?? 1) >= MIN_LANDMARK_CONFIDENCE &&
        timestampMs - this.leftLastPunchMs >= PUNCH_REFRACTORY_MS &&
        leftExtDelta >= PUNCH_EXT_DELTA_THRESHOLD &&
        leftExtVel >= PUNCH_EXT_VELOCITY_THRESHOLD &&
        leftWristSpeed >= PUNCH_WRIST_SPEED_THRESHOLD
      ) {
        this.leftArmPhase = 'EXTENDED';
        this.leftLastPunchMs = timestampMs;
        punchTriggered = 'LEFT';
      }

      // Update Right Arm Hysteresis
      if (this.rightArmPhase === 'EXTENDED') {
        if (
          rightExtVel <= 0.15 &&
          rightExtDelta <= PUNCH_RETRACT_RESET_DELTA &&
          timestampMs - this.rightLastPunchMs >= PUNCH_REFRACTORY_MS
        ) {
          this.rightArmPhase = 'GUARD';
        }
      } else if (
        !torsoRapidSway &&
        (rWrist.visibility ?? 1) >= MIN_LANDMARK_CONFIDENCE &&
        timestampMs - this.rightLastPunchMs >= PUNCH_REFRACTORY_MS &&
        rightExtDelta >= PUNCH_EXT_DELTA_THRESHOLD &&
        rightExtVel >= PUNCH_EXT_VELOCITY_THRESHOLD &&
        rightWristSpeed >= PUNCH_WRIST_SPEED_THRESHOLD
      ) {
        // If both crossed threshold on exact same frame, pick the faster extending arm
        if (!punchTriggered || rightExtVel > leftExtVel) {
          this.rightArmPhase = 'EXTENDED';
          this.rightLastPunchMs = timestampMs;
          punchTriggered = 'RIGHT';
        }
      }
    }

    this.prevTimestampMs = timestampMs;
    this.prevLeftExt = leftExt;
    this.prevRightExt = rightExt;
    this.prevLeftWristRel = leftWristRel;
    this.prevRightWristRel = rightWristRel;
    this.prevLeanScore = leanScore;

    return {
      calibrated: true,
      calibrationProgress: 1,
      trackingValid: true,
      trackingLost: false,
      confidence: avgConfidence,
      lean: this.currentLean,
      leanScore,
      punchTriggered,
      leftExtDelta,
      rightExtDelta,
      mirroredKeypoints,
    };
  }

  private computeArmExtension(
    shoulder: { x: number; y: number; z: number },
    elbow: { x: number; y: number; z: number },
    wrist: { x: number; y: number; z: number },
    sideSign: -1 | 1, // -1 for Left arm (on left side of mirrored screen), +1 for Right arm
    shoulderWidth: number
  ): number {
    const radial2D =
      Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y) / shoulderWidth;

    // Forward depth toward camera (wrist more negative z than shoulder)
    const depthForward = Math.max(
      -0.4,
      Math.min(2.0, (shoulder.z - wrist.z) / Math.max(0.14, shoulderWidth))
    );

    // 2D/3D elbow opening angle
    const v1x = shoulder.x - elbow.x;
    const v1y = shoulder.y - elbow.y;
    const v2x = wrist.x - elbow.x;
    const v2y = wrist.y - elbow.y;
    const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    let elbowAngleDeg = 90;
    if (mag > 1e-5) {
      const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / mag));
      elbowAngleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
    }
    const elbowNorm = Math.max(0, Math.min(1.2, (elbowAngleDeg - 65) / 95));

    // Cross-centerline punch drive (left wrist driving right toward center, right wrist driving left toward center)
    const inwardDrive = Math.max(
      -0.25,
      Math.min(1.1, (-sideSign * (wrist.x - shoulder.x)) / shoulderWidth)
    );

    return (
      radial2D * 0.42 +
      depthForward * 0.4 +
      elbowNorm * 0.28 +
      inwardDrive * 0.22
    );
  }

  private handleMissingPose(
    timestampMs: number,
    confidence: number
  ): GestureFrameResult {
    if (this.lowConfidenceSinceMs === null) {
      this.lowConfidenceSinceMs = timestampMs;
    } else if (timestampMs - this.lowConfidenceSinceMs >= TRACKING_LOSS_HOLD_MS) {
      this.trackingLost = true;
    }

    this.currentLean = 'NONE';
    this.prevTimestampMs = null;

    return {
      calibrated: this.isCalibrated(),
      calibrationProgress: this.isCalibrated()
        ? 1
        : this.calibSamples.length / CALIBRATION_REQUIRED_SAMPLES,
      trackingValid: false,
      trackingLost: this.trackingLost,
      confidence,
      lean: 'NONE',
      leanScore: 0,
      punchTriggered: null,
      leftExtDelta: 0,
      rightExtDelta: 0,
      mirroredKeypoints: null,
    };
  }
}
