import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { KaiBrawlerRig } from './KaiBrawlerModel';

const MODEL_BASE = 'https://threejs.org/examples/models/gltf/';
const DOWN = new THREE.Vector3(0, -1, 0);

export function loadFighterAvatar(file: 'readyplayer.me.glb' | 'Michelle.glb') {
  return new GLTFLoader().loadAsync(MODEL_BASE + file).then(({ scene }) => scene);
}

export function disposeFighterAvatar(root: THREE.Object3D): void {
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) resources.add(object.skeleton);
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) resources.add(value);
      }
    }
  });
  for (const resource of resources) resource.dispose();
  root.removeFromParent();
}

function findBone(model: THREE.Object3D, name: string): THREE.Bone {
  const bone = model.getObjectByName(name) ?? model.getObjectByName('mixamorig' + name);
  if (!(bone instanceof THREE.Bone)) throw new Error('Missing avatar bone ' + name);
  return bone;
}

function direction(from: THREE.Object3D, to: THREE.Object3D): THREE.Vector3 {
  return to.getWorldPosition(new THREE.Vector3())
    .sub(from.getWorldPosition(new THREE.Vector3())).normalize();
}

/** Convert a world-space orientation to the joint's current parent space. */
export function setJointOrientation(joint: THREE.Bone, world: THREE.Quaternion): void {
  const parentOrientation = new THREE.Quaternion();
  joint.parent?.getWorldQuaternion(parentOrientation);
  joint.quaternion.copy(parentOrientation.invert().multiply(world));
}

function handFrame(model: THREE.Object3D, side: 'Left' | 'Right'): THREE.Matrix4 {
  const wrist = findBone(model, side + 'Hand');
  const back = direction(wrist, findBone(model, side + 'ForeArm'));
  const across = direction(findBone(model, side + 'HandPinky1'), findBone(model, side + 'HandIndex1'));
  if (side === 'Right') across.negate();
  const up = back.clone().cross(across).normalize();
  const right = up.clone().cross(back);
  return new THREE.Matrix4().makeBasis(right, up, back)
    .setPosition(wrist.getWorldPosition(new THREE.Vector3()));
}

function closeHand(model: THREE.Object3D, side: 'Left' | 'Right'): void {
  const axis = new THREE.Vector3().setFromMatrixColumn(handFrame(model, side), 0);
  const rest = new THREE.Quaternion();
  const curl = new THREE.Quaternion();
  const curls = [1.05, 1.45, 0.65];
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
    for (const [index, angle] of curls.entries()) {
      const segment = index + 1;
      const joint = findBone(model, side + 'Hand' + finger + segment);
      joint.getWorldQuaternion(rest);
      // Rotate toward the palm, with less curl at the fingertips.
      curl.setFromAxisAngle(axis, -angle);
      setJointOrientation(joint, curl.multiply(rest));
    }
  }
  const thumb = findBone(model, side + 'HandThumb1');
  const towardFingers = direction(thumb, findBone(model, side + 'HandMiddle1'));
  const thumbDirection = direction(thumb, findBone(model, side + 'HandThumb3'));
  thumb.getWorldQuaternion(rest);
  curl.identity().slerp(new THREE.Quaternion().setFromUnitVectors(thumbDirection, towardFingers), 0.5);
  setJointOrientation(thumb, curl.multiply(rest));
}

/** The existing combat rig drives the avatar, including its windups and knockout. */
export function bindOpponentAvatar(model: THREE.Group, rig: KaiBrawlerRig): () => void {
  const bounds = new THREE.Box3().setFromObject(model, true);
  model.position.y -= bounds.min.y;
  const hips = findBone(model, 'Hips');
  const hipsY = hips.position.y;
  const drivers: Array<{
    source: THREE.Object3D;
    joint: THREE.Bone;
    neutral: THREE.Quaternion;
  }> = [];

  const bind = (source: THREE.Object3D, name: string, tip?: string) => {
    const joint = findBone(model, name);
    const neutral = joint.getWorldQuaternion(new THREE.Quaternion());
    if (tip) {
      const axis = direction(joint, findBone(model, tip));
      neutral.premultiply(new THREE.Quaternion().setFromUnitVectors(axis, DOWN));
    }
    drivers.push({ source, joint, neutral });
  };

  bind(rig.pelvis, 'Hips');
  bind(rig.torso, 'Spine');
  bind(rig.head, 'Head');
  for (const side of ['Right', 'Left'] as const) {
    const arm = side === 'Right' ? rig.screenLeftArm : rig.screenRightArm;
    const leg = side === 'Right' ? rig.screenLeftLeg : rig.screenRightLeg;
    bind(arm.shoulder, side + 'Arm', side + 'ForeArm');
    bind(arm.elbow, side + 'ForeArm', side + 'Hand');
    bind(arm.wrist, side + 'Hand', side + 'HandMiddle1');
    bind(leg.hip, side + 'UpLeg', side + 'Leg');
    bind(leg.knee, side + 'Leg', side + 'Foot');
    bind(leg.ankle, side + 'Foot');
    closeHand(model, side);
  }

  // Keep the existing windup indicators and light, and replace the visible proxy meshes.
  rig.root.traverse((object) => {
    if (object instanceof THREE.Mesh &&
        object !== rig.screenLeftArm.telegraphRing && object !== rig.screenRightArm.telegraphRing) {
      object.visible = false;
    }
  });
  rig.root.add(model);
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
  });

  const orientation = new THREE.Quaternion();
  return () => {
    hips.position.y = hipsY + rig.pelvis.position.y - 0.945;
    for (const { source, joint, neutral } of drivers) {
      source.getWorldQuaternion(orientation).multiply(neutral);
      setJointOrientation(joint, orientation);
    }
  };
}

/** Bake just the avatar's arms in a closed-fist pose for the first-person camera. */
export function buildMichelleView(model: THREE.Group): [THREE.Mesh, THREE.Mesh] {
  let body: THREE.SkinnedMesh | undefined;
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) body = object;
  });
  if (!body) throw new Error('Michelle has no skinned body');

  const mesh = body;
  const source = mesh.geometry;
  const skinIndex = source.getAttribute('skinIndex');
  const skinWeight = source.getAttribute('skinWeight');
  const sourceIndex = source.getIndex();
  if (!sourceIndex || !skinIndex || !skinWeight) throw new Error('Michelle has no indexed skin weights');
  const index = sourceIndex;
  const worldVertex = new THREE.Vector3();
  const localVertex = new THREE.Vector3();

  function armView(side: 'Left' | 'Right'): THREE.Mesh {
    const frame = handFrame(model, side).invert();
    closeHand(model, side);
    model.updateMatrixWorld(true);
    const armBones = new Set<number>();
    findBone(model, side + 'Arm').traverse((bone) => {
      if (bone instanceof THREE.Bone) armBones.add(mesh.skeleton.bones.indexOf(bone));
    });

    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const vertices = new Map<number, number>();
    const uv = source.getAttribute('uv');
    const inArm = (vertex: number) => {
      let weight = 0;
      for (let influence = 0; influence < 4; influence++) {
        if (armBones.has(skinIndex.getComponent(vertex, influence))) {
          weight += skinWeight.getComponent(vertex, influence);
        }
      }
      return weight >= 0.5;
    };

    for (let i = 0; i < index.count; i += 3) {
      const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (!triangle.every(inArm)) continue;
      for (const vertex of triangle) {
        let mapped = vertices.get(vertex);
        if (mapped === undefined) {
          mapped = vertices.size;
          vertices.set(vertex, mapped);
          mesh.getVertexPosition(vertex, worldVertex).applyMatrix4(mesh.matrixWorld);
          localVertex.copy(worldVertex).applyMatrix4(frame);
          positions.push(localVertex.x, localVertex.y, localVertex.z);
          uvs.push(uv.getX(vertex), uv.getY(vertex));
        }
        indices.push(mapped);
      }
    }
    if (indices.length === 0) throw new Error('Michelle arm has no visible triangles');
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const arm = new THREE.Mesh(geometry, mesh.material);
    // Normalize to the same viewmodel scale as the existing guard and strike.
    const length = findBone(model, side + 'Hand').getWorldPosition(new THREE.Vector3())
      .distanceTo(findBone(model, side + 'ForeArm').getWorldPosition(new THREE.Vector3()));
    arm.scale.setScalar(0.34 / length);
    return arm;
  }

  // Camera-facing anatomical left is screen-left when viewed from behind the avatar.
  return [armView('Left'), armView('Right')];
}
