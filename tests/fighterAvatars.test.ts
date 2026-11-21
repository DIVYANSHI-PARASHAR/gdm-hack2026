import { describe, expect, it } from 'vitest';
import { Bone, Group, Quaternion } from 'three';
import { setJointOrientation } from '../src/scene/FighterAvatars';

describe('fighter avatar pose transfer', () => {
  it('uses the current parent orientation when posing a fighter limb', () => {
    const model = new Group();
    const shoulder = new Bone();
    const elbow = new Bone();
    model.add(shoulder);
    shoulder.add(elbow);
    model.rotation.y = 0.65;
    model.scale.setScalar(1.12);

    const upperArm = new Quaternion().setFromAxisAngle(shoulder.up, 0.25);
    const forearm = new Quaternion().setFromAxisAngle(elbow.up, 1.1);
    setJointOrientation(shoulder, upperArm);
    setJointOrientation(elbow, forearm);

    expect(shoulder.getWorldQuaternion(new Quaternion()).angleTo(upperArm)).toBeLessThan(1e-6);
    expect(elbow.getWorldQuaternion(new Quaternion()).angleTo(forearm)).toBeLessThan(1e-6);
  });
});
