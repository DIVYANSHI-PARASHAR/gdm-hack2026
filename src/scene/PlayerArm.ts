import {
  CapsuleGeometry, CylinderGeometry, Group, LatheGeometry, MathUtils, Mesh, MeshStandardMaterial,
  SphereGeometry, Vector2, Vector3,
} from 'three';

import type { BoxingHand } from '../vision/boxingPose';

const upperLength = 0.69;
const forearmLength = 0.72;
const up = new Vector3(0, 1, 0);
const forward = new Vector3(0, 0, -1);

// All joints share camera-local coordinates, including during camera lean and shake.
export class PlayerArm extends Group {
  readonly glove = new Group();
  private readonly shoulder: Vector3;
  private readonly elbow = new Vector3();
  private readonly upper = new Group();
  private readonly forearm = new Group();
  private readonly axis = new Vector3();
  private readonly bend = new Vector3();
  private readonly direction = new Vector3();
  private readonly elbowGuide = new Vector3();

  constructor(private readonly side: -1 | 1) {
    super();
    this.shoulder = new Vector3(side * 0.36, -0.26, 0.10);
    this.elbowGuide.set(side * 0.32, -1, 0.12);
    const sleeve = new MeshStandardMaterial({ color: 0x393b43, roughness: 0.92, metalness: 0.02 });
    const leather = new MeshStandardMaterial({ color: side < 0 ? 0x146375 : 0x843042, roughness: 0.38, metalness: 0.05 });
    const trim = new MeshStandardMaterial({
      color: side < 0 ? 0x28d6e9 : 0xff468b,
      emissive: side < 0 ? 0x076579 : 0x8c1748,
      emissiveIntensity: 0.7,
    });

    const upperSleeve = new Mesh(new CapsuleGeometry(0.082, upperLength - 0.164, 4, 12), sleeve);
    upperSleeve.position.y = upperLength / 2;
    this.upper.add(upperSleeve);

    const forearmForm = new LatheGeometry([
      new Vector2(0.063, 0), new Vector2(0.093, 0.09), new Vector2(0.097, 0.2),
      new Vector2(0.082, 0.35), new Vector2(0.06, 0.53), new Vector2(0.053, forearmLength),
    ], 24);
    const bracer = new Mesh(forearmForm, sleeve);
    bracer.scale.z = 0.83;
    const elbowPad = new Mesh(new SphereGeometry(0.072, 16, 10), sleeve);
    this.forearm.add(bracer, elbowPad);

    // Wide knuckle pad, tucked thumb and a broad wrapped wrist strap.
    const mittForm = new LatheGeometry([
      new Vector2(0.001, -0.035), new Vector2(0.065, -0.025), new Vector2(0.081, 0.015),
      new Vector2(0.094, 0.075), new Vector2(0.111, 0.125), new Vector2(0.112, 0.17),
      new Vector2(0.101, 0.198), new Vector2(0.073, 0.215), new Vector2(0.001, 0.224),
    ], 32);
    mittForm.rotateX(-Math.PI / 2);
    const fist = new Mesh(mittForm, leather);
    fist.scale.y = 0.77;
    const pad = new SphereGeometry(1, 20, 14);
    const thumb = new Mesh(pad, leather);
    thumb.scale.set(0.045, 0.053, 0.081);
    thumb.position.set(-side * 0.077, -0.028, -0.089);
    thumb.rotation.y = side * 0.32;
    const cuff = new Mesh(new CylinderGeometry(0.077, 0.069, 0.115, 24), leather);
    cuff.geometry.rotateX(-Math.PI / 2);
    cuff.scale.y = 0.84;
    cuff.position.z = 0.03;
    const binding = new Mesh(new CylinderGeometry(0.078, 0.079, 0.013, 24), trim);
    binding.geometry.rotateX(-Math.PI / 2);
    binding.scale.y = 0.84;
    binding.position.z = 0.052;
    this.glove.add(cuff, fist, thumb, binding);
    this.glove.position.set(side * 0.39, -0.27, -0.68);
    this.add(this.upper, this.forearm, this.glove);
    this.updateJoints();
  }

  updateJoints(reach = 0, elbow: BoxingHand['elbow'] = null, dt = 1 / 60): void {
    // A straight drives the punching shoulder forward and toward the center.
    this.shoulder.set(this.side * (0.36 - 0.095 * reach), -0.26 + 0.055 * reach, 0.10 - 0.22 * reach);
    this.upper.position.copy(this.shoulder);
    const wrist = this.glove.position;
    this.axis.subVectors(wrist, this.shoulder);
    const requestedDistance = this.axis.length();
    if (requestedDistance < 1e-6) this.axis.copy(forward);
    else this.axis.divideScalar(requestedDistance);
    const distance = MathUtils.clamp(requestedDistance, 0.2, upperLength + forearmLength - 0.008);
    wrist.copy(this.shoulder).addScaledVector(this.axis, distance);

    // Solve the elbow on the two-link triangle, bending down and out from the ribs.
    const guide = this.bend.set(this.side * 0.32, -0.9, 0.10);
    if (elbow) guide.set(elbow.x, elbow.y, elbow.z).normalize();
    this.elbowGuide.lerp(guide, 1 - Math.exp(-dt * 38));
    this.bend.copy(this.elbowGuide);
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis));
    if (this.bend.lengthSq() < 1e-8) this.bend.crossVectors(this.axis, forward);
    this.bend.normalize();
    const along = (upperLength ** 2 - forearmLength ** 2 + distance ** 2) / (2 * distance);
    const across = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
    this.elbow.copy(this.shoulder).addScaledVector(this.axis, along).addScaledVector(this.bend, across);

    this.direction.subVectors(this.elbow, this.shoulder).normalize();
    this.upper.quaternion.setFromUnitVectors(up, this.direction);
    this.forearm.position.copy(this.elbow);
    this.direction.subVectors(wrist, this.elbow).normalize();
    this.forearm.quaternion.setFromUnitVectors(up, this.direction);
    // Keep the knuckles facing the opponent at guard; turn the fist over as
    // the elbow straightens. The cuff stays on the solved wrist throughout.
    this.direction.lerp(forward, 0.30 + 0.34 * reach).normalize();
    this.glove.quaternion.setFromUnitVectors(forward, this.direction);
    this.glove.rotateZ(this.side * (0.56 - 0.87 * reach));
  }
}
