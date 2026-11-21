import { Group, MathUtils } from 'three';
import type { BoxingHand } from '../vision/boxingPose';

// A compact guard can move freely. As the elbow opens, send the wrist into
// the ring along the punch line, keeping independent aim around the target.
export function animateTrackedGlove(
  glove: Group, side: -1 | 1, hand: BoxingHand | null, dt: number, aspect: number, tanHalfFov: number,
): number {
  const reach = MathUtils.smoothstep(hand?.reach ?? 0, 0.035, 0.78);
  const distance = 0.56 + 0.87 * reach;
  const guardX = side * (0.55 - 0.46 * reach);
  const aimX = MathUtils.clamp(hand?.x ?? 0, -1.25, 1.25) * (0.31 - 0.15 * reach);
  const aimY = MathUtils.clamp(hand?.y ?? 0, -1, 1) * (0.36 - 0.19 * reach);
  const screenY = -0.51 + 0.48 * reach + aimY;
  const halfHeight = distance * tanHalfFov;
  const targetX = (guardX + aimX) * halfHeight * Math.min(aspect, 1.95);
  const targetY = screenY * halfHeight;
  const travel = Math.hypot(targetX - glove.position.x, targetY - glove.position.y, distance + glove.position.z);
  const rate = hand ? 34 + 135 * Math.min(1, travel / 0.24) : 15;
  const blend = 1 - Math.exp(-dt * rate);
  glove.position.x = MathUtils.lerp(glove.position.x, targetX, blend);
  glove.position.y = MathUtils.lerp(glove.position.y, targetY, blend);
  glove.position.z = MathUtils.lerp(glove.position.z, -distance, blend);
  return reach;
}
