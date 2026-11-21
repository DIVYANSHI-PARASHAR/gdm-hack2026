import { Group, Vector3 } from 'three';
import { PlayerArm } from '../src/scene/PlayerArm';
import { describe, expect, it } from 'vitest';
import { animateTrackedGlove } from '../src/scene/playerGlove';

describe('tracked glove animation', () => {
  it('raises, extends, holds and returns a real glove mesh to guard', () => {
    const glove = new Group();
    const rest = { x: 0, y: 0, forward: 0, reach: 0, elbow: null };
    const extended = { x: 0.25, y: 0.6, forward: 1, reach: 1, elbow: null };
    const step = (hand: typeof rest | null, frames: number) => {
      for (let i = 0; i < frames; i++) animateTrackedGlove(glove, -1, hand, 1 / 60, 1.6, 0.6);
    };
    step(rest, 90);
    const guard = glove.position.clone();
    step(extended, 1);
    expect(glove.position.y).toBeGreaterThan(guard.y);
    expect(glove.position.z).toBeLessThan(guard.z);
    step(extended, 90);
    const held = glove.position.clone();
    expect(held.x / -held.z).toBeGreaterThan(guard.x / -guard.z);
    step(extended, 60);
    expect(glove.position.distanceTo(held)).toBeLessThan(0.00001);
    step(null, 1);
    expect(glove.position.z).toBeLessThan(guard.z);
    step(null, 90);
    expect(glove.position.distanceTo(guard)).toBeLessThan(0.001);
  });
});

describe('anchored player arms', () => {
  it('keeps the stationary shoulder planted and the wrist attached through guard, jabs and extreme tracking targets', () => {
    for (const side of [-1, 1] as const) {
      const arm = new PlayerArm(side);
      const [upper, forearm] = arm.children;
      const shoulder = upper.position.clone();
      for (const target of [[side * 0.4, -0.27, -0.68], [0, 0.3, -1.4], [-side * 2, 1.5, -4], shoulder.toArray()]) {
        arm.glove.position.fromArray(target);
        arm.updateJoints();
        const elbow = new Vector3(0, 0.69, 0).applyQuaternion(upper.quaternion).add(upper.position);
        const wrist = new Vector3(0, 0.72, 0).applyQuaternion(forearm.quaternion).add(forearm.position);
        expect(upper.position.distanceTo(shoulder)).toBe(0);
        expect(elbow.distanceTo(forearm.position)).toBeLessThan(1e-6);
        expect(wrist.distanceTo(arm.glove.position)).toBeLessThan(1e-6);
        const gloveAim = new Vector3(0, 0, -1).applyQuaternion(arm.glove.quaternion);
        expect(gloveAim.length()).toBeCloseTo(1);
      }
    }
  });
});

it('drives a jab forward independently of guard height and preserves the measured elbow bend', () => {
  const arm = new PlayerArm(-1);
  const draw = (reach: number, y: number, elbowX: number) => {
    for (let i = 0; i < 15; i++) {
      const hand = { reach, x: 0, y, forward: reach, elbow: { x: elbowX, y: -0.35, z: 0 } };
      const drive = animateTrackedGlove(arm.glove, -1, hand, 1 / 60, 1.6, 0.6);
      arm.updateJoints(drive, hand.elbow, 1 / 60);
    }
    return arm.glove.position.clone();
  };
  const guard = draw(0, 0, -0.25);
  const raised = draw(0, 0.7, -0.25);
  expect(raised.z).toBeCloseTo(guard.z);
  expect(raised.y).toBeGreaterThan(guard.y);
  const elbowBefore = arm.children[1].position.x;
  draw(0, 0.7, 0.3);
  expect(arm.children[1].position.x).toBeGreaterThan(elbowBefore + 0.1);
  const extended = draw(0.85, 0.15, -0.25);
  expect(guard.z - extended.z).toBeGreaterThan(3 * Math.abs(extended.y - guard.y));
  expect(arm.children[0].position.z).toBeLessThan(0);
});
