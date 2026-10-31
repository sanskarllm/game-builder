import * as THREE from 'three';
import { BONE_NAMES, JOINTS, JOINT_PARENT, jointPositions, type JointId, type RigFit, type RigTarget } from './skeletons';

export interface RigResult {
  armature: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Partial<Record<JointId, THREE.Bone>>;
  meshes: THREE.SkinnedMesh[];
  vertexCount: number;
}

/** Guess joint landmarks for an arbitrary humanoid-ish model from its geometry. */
export function detectFit(object: THREE.Object3D): { fit: RigFit; origin: THREE.Vector3 } {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const h = Math.max(1e-3, box.max.y - box.min.y);
  const origin = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);

  const xs: number[] = [];
  const ys: number[] = [];
  const v = new THREE.Vector3();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      xs.push(v.x - origin.x);
      ys.push(v.y - origin.y);
    }
  });

  const inBand = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let i = 0; i < ys.length; i++) if (ys[i] >= lo * h && ys[i] <= hi * h) out.push(xs[i]);
    return out;
  };

  const armBand = inBand(0.72, 0.88);
  let armReach = armBand.length ? Math.max(...armBand.map(Math.abs)) : 0.45 * h;

  const legBand = inBand(0.18, 0.32);
  const mean = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const left = mean(legBand.filter((x) => x > 0.005 * h));
  const right = mean(legBand.filter((x) => x < -0.005 * h).map((x) => -x));
  const legX = left && right ? (left + right) / 2 : left || right || 0.055 * h;
  const shoulderX = THREE.MathUtils.clamp(legX * 2.2, 0.07 * h, 0.18 * h);

  let armAngle = 0;
  if (armReach < shoulderX + 0.15 * h) {
    // Arms hang down rather than out: assume an A-pose-ish layout.
    armAngle = 60;
    armReach = shoulderX + 0.2 * h;
  }

  return {
    origin,
    fit: {
      hipY: 0.5 * h,
      kneeY: 0.27 * h,
      ankleY: 0.045 * h,
      shoulderY: 0.8 * h,
      neckY: 0.82 * h,
      headY: 0.86 * h,
      headTopY: h,
      shoulderX,
      legX,
      armReach,
      armAngle,
      footForward: 0.1 * h,
    },
  };
}

interface Segment {
  index: number;
  side: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  len2: number;
}

/**
 * Build an engine-ready skeleton for `source` and skin every mesh to it.
 * Geometry is baked into world space, bones are created with identity
 * orientation, and weights come from distance-to-bone falloff (4 influences).
 */
export function autoRig(
  source: THREE.Object3D,
  fit: RigFit,
  target: RigTarget,
  origin: THREE.Vector3 = new THREE.Vector3(),
): RigResult {
  source.updateMatrixWorld(true);
  const { joints, tails } = jointPositions(fit, origin);
  const names = BONE_NAMES[target];

  const bones: Partial<Record<JointId, THREE.Bone>> = {};
  const order: JointId[] = [];
  for (const j of JOINTS) {
    const name = names[j.id];
    if (!name) continue;
    const bone = new THREE.Bone();
    bone.name = name;
    let parent = j.parent;
    while (parent && !bones[parent]) parent = JOINT_PARENT[parent];
    bone.position.copy(joints[j.id]);
    if (parent) {
      bone.position.sub(joints[parent]);
      bones[parent]!.add(bone);
    }
    bone.userData.joint = j.id;
    bones[j.id] = bone;
    order.push(j.id);
  }

  const h = fit.headTopY;
  const segmentEnds: Partial<Record<JointId, [THREE.Vector3, THREE.Vector3]>> = {
    hips: [joints.hips.clone().setY(joints.hips.y - 0.05 * h), joints.spine],
    spine: [joints.spine, joints.chest],
    chest: [joints.chest, joints.upperChest],
    upperChest: [joints.upperChest, joints.neck],
    neck: [joints.neck, joints.head],
    head: [joints.head, tails.head],
  };
  for (const side of ['L', 'R'] as const) {
    segmentEnds[`shoulder.${side}`] = [joints[`shoulder.${side}`], joints[`upperArm.${side}`]];
    segmentEnds[`upperArm.${side}`] = [joints[`upperArm.${side}`], joints[`lowerArm.${side}`]];
    segmentEnds[`lowerArm.${side}`] = [joints[`lowerArm.${side}`], joints[`hand.${side}`]];
    segmentEnds[`hand.${side}`] = [joints[`hand.${side}`], tails[`hand.${side}`]];
    segmentEnds[`upperLeg.${side}`] = [joints[`upperLeg.${side}`], joints[`lowerLeg.${side}`]];
    segmentEnds[`lowerLeg.${side}`] = [joints[`lowerLeg.${side}`], joints[`foot.${side}`]];
    segmentEnds[`foot.${side}`] = [joints[`foot.${side}`], joints[`toes.${side}`]];
    segmentEnds[`toes.${side}`] = [joints[`toes.${side}`], tails[`toes.${side}`]];
  }

  const segments: Segment[] = [];
  order.forEach((id, index) => {
    const ends = segmentEnds[id];
    if (!ends) return; // root carries no weight
    const [a, b] = ends;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    segments.push({
      index,
      side: id.endsWith('.L') ? 1 : id.endsWith('.R') ? -1 : 0,
      ax: a.x,
      ay: a.y,
      az: a.z,
      bx: dx,
      by: dy,
      bz: dz,
      len2: dx * dx + dy * dy + dz * dz || 1e-9,
    });
  });

  const tol = 0.015 * h;
  const eps = 0.002 * h;
  const meshes: THREE.SkinnedMesh[] = [];
  let vertexCount = 0;

  source.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) return;
    const geom = mesh.geometry.clone();
    geom.applyMatrix4(mesh.matrixWorld);
    geom.deleteAttribute('skinIndex');
    geom.deleteAttribute('skinWeight');
    const pos = geom.attributes.position;
    const n = pos.count;
    vertexCount += n;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const bestI = [0, 0, 0, 0];
    const bestW = [0, 0, 0, 0];

    for (let v = 0; v < n; v++) {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      bestW.fill(0);
      bestI.fill(0);
      for (const s of segments) {
        if (s.side === 1 && x < origin.x - tol) continue;
        if (s.side === -1 && x > origin.x + tol) continue;
        const px = x - s.ax;
        const py = y - s.ay;
        const pz = z - s.az;
        let t = (px * s.bx + py * s.by + pz * s.bz) / s.len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - s.bx * t;
        const qy = py - s.by * t;
        const qz = pz - s.bz * t;
        const d = Math.sqrt(qx * qx + qy * qy + qz * qz) + eps;
        const w = 1 / (d * d * d * d);
        if (w <= bestW[3]) continue;
        let k = 3;
        while (k > 0 && bestW[k - 1] < w) {
          bestW[k] = bestW[k - 1];
          bestI[k] = bestI[k - 1];
          k--;
        }
        bestW[k] = w;
        bestI[k] = s.index;
      }
      let sum = bestW[0] + bestW[1] + bestW[2] + bestW[3];
      for (let k = 0; k < 4; k++) if (bestW[k] < sum * 0.02) bestW[k] = 0;
      sum = bestW[0] + bestW[1] + bestW[2] + bestW[3] || 1;
      for (let k = 0; k < 4; k++) {
        skinIndex[v * 4 + k] = bestI[k];
        skinWeight[v * 4 + k] = bestW[k] / sum;
      }
    }

    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    const skinned = new THREE.SkinnedMesh(geom, mesh.material);
    skinned.name = mesh.name || `Mesh${meshes.length}`;
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    skinned.frustumCulled = false;
    meshes.push(skinned);
  });

  const armature = new THREE.Group();
  armature.name = 'Armature';
  const rootBone = bones[order[0]]!;
  armature.add(rootBone);
  meshes.forEach((m) => armature.add(m));
  armature.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order.map((id) => bones[id]!));
  meshes.forEach((m) => m.bind(skeleton));

  return { armature, skeleton, bones, meshes, vertexCount };
}

export type TestPose = 'bind' | 'armsDown' | 'walk' | 'wave';

/** Pose the rig to check deformation. `t` is time in seconds for animated poses. */
export function applyPose(bones: Partial<Record<JointId, THREE.Bone>>, pose: TestPose, t = 0): void {
  for (const bone of Object.values(bones)) bone?.rotation.set(0, 0, 0);
  const rot = (id: JointId, x: number, y: number, z: number) => bones[id]?.rotation.set(x, y, z);
  if (pose === 'bind') return;

  const armDown = 1.25;
  if (pose === 'armsDown') {
    rot('upperArm.L', 0, 0, -armDown);
    rot('upperArm.R', 0, 0, armDown);
    rot('lowerArm.L', 0, 0, -0.15);
    rot('lowerArm.R', 0, 0, 0.15);
    return;
  }
  if (pose === 'walk') {
    const s = Math.sin(t * 4);
    rot('upperLeg.L', -s * 0.5, 0, 0);
    rot('upperLeg.R', s * 0.5, 0, 0);
    rot('lowerLeg.L', Math.max(0, Math.sin(t * 4 + 1.2)) * 0.9, 0, 0);
    rot('lowerLeg.R', Math.max(0, Math.sin(t * 4 + 1.2 + Math.PI)) * 0.9, 0, 0);
    rot('upperArm.L', s * 0.45, 0, -armDown);
    rot('upperArm.R', -s * 0.45, 0, armDown);
    rot('lowerArm.L', 0, 0, -0.25);
    rot('lowerArm.R', 0, 0, 0.25);
    rot('spine', 0, s * 0.08, 0);
    rot('head', 0, -s * 0.05, 0);
    return;
  }
  // wave
  rot('upperArm.L', 0, 0, -armDown);
  rot('upperArm.R', 0, 0, -1.1);
  rot('lowerArm.R', 0, 0, -0.5 + Math.sin(t * 6) * 0.45);
  rot('head', 0, -0.25, Math.sin(t * 2) * 0.05);
}
