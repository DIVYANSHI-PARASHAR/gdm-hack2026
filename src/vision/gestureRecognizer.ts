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
  neutralLeftWristX?: number;
  neutralRightWristX?: number;
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
  rightHandRaiseHoldProgress: number; // 0..1 hold progress toward right-hand raise
  rightHandRaiseTriggered: boolean;   // true once hold threshold is reached
}

const MIN_LANDMARK_CONFIDENCE = 0.45;
const TRACKING_LOSS_HOLD_MS = 360;
const CALIBRATION_REQUIRED_SAMPLES = 16;
const RIGHT_HAND_RAISE_HOLD_MS = 340;
const RIGHT_HAND_RAISE_MAX_FRAME_GAP_MS = 400;
const RIGHT_HAND_RAISE_MAX_FRAME_CREDIT_MS = 120;

const LEAN_ENTER_THRESHOLD = 0.26;
const LEAN_EXIT_THRESHOLD = 0.14;

const PUNCH_EXT_DELTA_THRESHOLD = 0.23;
const PUNCH_RETRACT_RESET_DELTA = 0.12;
const PUNCH_EXT_VELOCITY_THRESHOLD = 1.35; // units/sec
const PUNCH_WRIST_SPEED_THRESHOLD = 1.1; // shoulder-widths/sec
const PUNCH_REFRACTORY_MS = 220;
const HOOK_MIN_TRAVEL = 0.22; // shoulder widths inward from guard
const HOOK_MIN_SPEED = 2.0; // shoulder widths per second

interface CalibrationSample {
  centerMx: number;
  shoulderWidth: number;
  leftExt: number;
  rightExt: number;
  leftWristX: number;
  rightWristX: number;
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

  private rightHandRaiseHoldMs = 0;
  private lastRightHandRaiseFrameMs: number | null = null;
  private wasRightHandRaised = false;
  private rightHandRaiseFired = false;

  public resetRightHandRaiseState(): void {
    this.lastRightHandRaiseFrameMs = null;
    this.rightHandRaiseHoldMs = 0;
    this.wasRightHandRaised = false;
    this.rightHandRaiseFired = false;
  }

  public resetCalibration(): void {
    this.calibration = null;
    this.calibSamples = [];
    this.isCalibrating = true;
    this.currentLean = 'NONE';
    this.leftArmPhase = 'GUARD';
    this.rightArmPhase = 'GUARD';
    this.prevTimestampMs = null;
    this.resetRightHandRaiseState();
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
    const raise = this.evaluateRightHandRaise(landmarks?.[0], landmarks?.[16], timestampMs);
    if (!landmarks || landmarks.length < 17) {
      return { ...this.handleMissingPose(timestampMs, 0), ...raise };
    }

    const nose = landmarks[0];
    const lShoulder = landmarks[11];
    const rShoulder = landmarks[12];
    const lElbow = landmarks[13];
    const rElbow = landmarks[14];
    const lWrist = landmarks[15];
    const rWrist = landmarks[16];

    const coreVisibility = [
      nose.visibility ?? 1,
      lShoulder.visibility ?? 1,
      rShoulder.visibility ?? 1,
    ];
    const keyVisibility = [
      ...coreVisibility,
      lElbow.visibility ?? 1,
      rElbow.visibility ?? 1,
      lWrist.visibility ?? 1,
      rWrist.visibility ?? 1,
    ];
    const coreConfidence =
      coreVisibility.reduce((acc, v) => acc + v, 0) / coreVisibility.length;
    const avgConfidence =
      keyVisibility.reduce((acc, v) => acc + v, 0) / keyVisibility.length;
    const shouldersVisible =
      (lShoulder.visibility ?? 1) >= 0.38 &&
      (rShoulder.visibility ?? 1) >= 0.38;

    if (!shouldersVisible || coreConfidence < MIN_LANDMARK_CONFIDENCE) {
      return { ...this.handleMissingPose(timestampMs, avgConfidence), ...raise };
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
      // (Don't sample right-hand-raise poses as neutral boxing guard!)
      if (upperBodyMx > 0.2 && upperBodyMx < 0.8 && !this.wasRightHandRaised) {
        this.calibSamples.push({
          centerMx: upperBodyMx,
          shoulderWidth: liveShoulderWidth,
          leftExt,
          rightExt,
          leftWristX: (mLWr.x - mLSh.x) / liveShoulderWidth,
          rightWristX: (mRWr.x - mRSh.x) / liveShoulderWidth,
        });
      }

      const progress = Math.min(
        1,
        this.calibSamples.length / CALIBRATION_REQUIRED_SAMPLES
      );

      this.prevTimestampMs = timestampMs;

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
          neutralLeftWristX: this.calibSamples.reduce((s, c) => s + c.leftWristX, 0) / n,
          neutralRightWristX: this.calibSamples.reduce((s, c) => s + c.rightWristX, 0) / n,
        };
        this.isCalibrating = false;
        this.prevLeftExt = leftExt;
        this.prevRightExt = rightExt;
        this.prevLeftWristRel = {
          x: (mLWr.x - mLSh.x) / this.calibration.neutralShoulderWidth,
          y: (mLWr.y - mLSh.y) / this.calibration.neutralShoulderWidth,
        };
        this.prevRightWristRel = {
          x: (mRWr.x - mRSh.x) / this.calibration.neutralShoulderWidth,
          y: (mRWr.y - mRSh.y) / this.calibration.neutralShoulderWidth,
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
        ...raise,
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
      x: (mLWr.x - mLSh.x) / this.calibration.neutralShoulderWidth,
      y: (mLWr.y - mLSh.y) / this.calibration.neutralShoulderWidth,
    };
    const rightWristRel = {
      x: (mRWr.x - mRSh.x) / this.calibration.neutralShoulderWidth,
      y: (mRWr.y - mRSh.y) / this.calibration.neutralShoulderWidth,
    };

    // Profiles created before hook detection learn the wrist's guard X on the first frame.
    this.calibration.neutralLeftWristX ??= leftWristRel.x;
    this.calibration.neutralRightWristX ??= rightWristRel.x;

    const leftExtDelta = leftExt - this.calibration.neutralLeftExt;
    const rightExtDelta = rightExt - this.calibration.neutralRightExt;

    let punchTriggered: 'LEFT' | 'RIGHT' | null = null;

    if (this.prevTimestampMs !== null) {
      const leftExtVel = (leftExt - this.prevLeftExt) / dtSec;
      const rightExtVel = (rightExt - this.prevRightExt) / dtSec;

      const armScore = (
        side: 'LEFT' | 'RIGHT',
        current: { x: number; y: number },
        previous: { x: number; y: number },
        guardX: number,
        extension: number,
        extensionSpeed: number,
        shoulder: PoseLandmarkPoint,
        elbow: PoseLandmarkPoint,
        wrist: PoseLandmarkPoint,
        visible: boolean,
      ): number => {
        const left = side === 'LEFT';
        const inward = left ? 1 : -1;
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        const inwardTravel = inward * (current.x - guardX);
        const inwardSpeed = inward * dx / dtSec;
        const lastPunch = left ? this.leftLastPunchMs : this.rightLastPunchMs;
        if ((left ? this.leftArmPhase : this.rightArmPhase) === 'EXTENDED') {
          if (timestampMs - lastPunch >= PUNCH_REFRACTORY_MS &&
              extensionSpeed <= 0.15 && extension <= PUNCH_RETRACT_RESET_DELTA &&
              inwardTravel <= PUNCH_RETRACT_RESET_DELTA) {
            if (left) this.leftArmPhase = 'GUARD';
            else this.rightArmPhase = 'GUARD';
          }
          return 0;
        }
        if (!visible || timestampMs - lastPunch < PUNCH_REFRACTORY_MS) return 0;

        // A hook can travel across the body with almost no increase in reach or depth.
        // Require the elbow and wrist to form an inward-facing forearm rather than
        // treating an arbitrary sideways movement of the hand as a punch.
        const forearmX = inward * (wrist.x - elbow.x);
        const elbowHeight = Math.abs(elbow.y - shoulder.y) / liveShoulderWidth;
        const hook = inwardTravel >= HOOK_MIN_TRAVEL && inwardSpeed >= HOOK_MIN_SPEED &&
          Math.abs(dx) >= Math.abs(dy) && forearmX >= liveShoulderWidth * 0.18 &&
          forearmX >= Math.abs(wrist.y - elbow.y) * 0.7 && elbowHeight <= 0.6;
        if (hook) return inwardSpeed;

        const wristSpeed = Math.hypot(dx, dy) / dtSec + Math.max(0, extensionSpeed) * 0.45;
        return leanVelocity <= 2.9 && extension >= PUNCH_EXT_DELTA_THRESHOLD &&
          extensionSpeed >= PUNCH_EXT_VELOCITY_THRESHOLD &&
          wristSpeed >= PUNCH_WRIST_SPEED_THRESHOLD ? extensionSpeed : 0;
      };

      const leftScore = armScore('LEFT', leftWristRel, this.prevLeftWristRel,
        this.calibration.neutralLeftWristX, leftExtDelta, leftExtVel,
        mLSh, mLEl, mLWr, Math.min(lWrist.visibility ?? 1, lElbow.visibility ?? 1) >= MIN_LANDMARK_CONFIDENCE);
      const rightScore = armScore('RIGHT', rightWristRel, this.prevRightWristRel,
        this.calibration.neutralRightWristX, rightExtDelta, rightExtVel,
        mRSh, mREl, mRWr, Math.min(rWrist.visibility ?? 1, rElbow.visibility ?? 1) >= MIN_LANDMARK_CONFIDENCE);
      if (leftScore > 0 && leftScore >= rightScore) {
        this.leftArmPhase = 'EXTENDED';
        this.leftLastPunchMs = timestampMs;
        punchTriggered = 'LEFT';
      } else if (rightScore > 0) {
        this.rightArmPhase = 'EXTENDED';
        this.rightLastPunchMs = timestampMs;
        punchTriggered = 'RIGHT';
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
      ...raise,
    };
  }

  private evaluateRightHandRaise(
    nose: PoseLandmarkPoint | undefined,
    wrist: PoseLandmarkPoint | undefined,
    timestampMs: number
  ): Pick<GestureFrameResult, 'rightHandRaiseHoldProgress' | 'rightHandRaiseTriggered'> {
    const dtMs = timestampMs - (this.lastRightHandRaiseFrameMs ?? timestampMs);
    this.lastRightHandRaiseFrameMs = timestampMs;

    // The post-match pose only needs the face and anatomical right wrist.
    const rightHandRaised = !!nose && !!wrist &&
      (nose.visibility ?? 1) >= 0.35 &&
      (wrist.visibility ?? 1) >= 0.25 &&
      nose.y - wrist.y >= 0.08;
    this.rightHandRaiseHoldMs = rightHandRaised && this.wasRightHandRaised &&
      dtMs > 0 && dtMs <= RIGHT_HAND_RAISE_MAX_FRAME_GAP_MS
      ? Math.min(
          RIGHT_HAND_RAISE_HOLD_MS,
          this.rightHandRaiseHoldMs + Math.min(dtMs, RIGHT_HAND_RAISE_MAX_FRAME_CREDIT_MS)
        )
      : 0;
    this.wasRightHandRaised = rightHandRaised;
    const rightHandRaiseTriggered = this.rightHandRaiseHoldMs === RIGHT_HAND_RAISE_HOLD_MS && !this.rightHandRaiseFired;
    this.rightHandRaiseFired ||= rightHandRaiseTriggered;
    return {
      rightHandRaiseHoldProgress: this.rightHandRaiseHoldMs / RIGHT_HAND_RAISE_HOLD_MS,
      rightHandRaiseTriggered,
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
  ): Omit<GestureFrameResult, 'rightHandRaiseHoldProgress' | 'rightHandRaiseTriggered'> {
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
