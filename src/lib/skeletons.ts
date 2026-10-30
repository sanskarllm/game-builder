import * as THREE from 'three';

/**
 * Canonical humanoid skeleton, mapped onto the naming conventions each engine's
 * retargeting system recognises. Coordinates follow glTF: +Y up, the character
 * faces +Z, so the character's LEFT side is +X.
 */
export type RigTarget = 'unity' | 'unreal' | 'mixamo';

type Side = 'L' | 'R';
type LimbJoint =
  | 'shoulder'
  | 'upperArm'
  | 'lowerArm'
  | 'hand'
  | 'upperLeg'
  | 'lowerLeg'
  | 'foot'
  | 'toes';
export type JointId = 'root' | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head' | `${LimbJoint}.${Side}`;

export interface JointDef {
  id: JointId;
  parent: JointId | null;
}

const limbChain = (side: Side): JointDef[] => [
  { id: `shoulder.${side}`, parent: 'upperChest' },
  { id: `upperArm.${side}`, parent: `shoulder.${side}` },
  { id: `lowerArm.${side}`, parent: `upperArm.${side}` },
  { id: `hand.${side}`, parent: `lowerArm.${side}` },
  { id: `upperLeg.${side}`, parent: 'hips' },
  { id: `lowerLeg.${side}`, parent: `upperLeg.${side}` },
  { id: `foot.${side}`, parent: `lowerLeg.${side}` },
  { id: `toes.${side}`, parent: `foot.${side}` },
];

/** Ordered parent-first. */
export const JOINTS: JointDef[] = [
  { id: 'root', parent: null },
  { id: 'hips', parent: 'root' },
  { id: 'spine', parent: 'hips' },
  { id: 'chest', parent: 'spine' },
  { id: 'upperChest', parent: 'chest' },
  { id: 'neck', parent: 'upperChest' },
  { id: 'head', parent: 'neck' },
  ...limbChain('L'),
  ...limbChain('R'),
];

export const JOINT_PARENT: Record<JointId, JointId | null> = Object.fromEntries(
  JOINTS.map((j) => [j.id, j.parent]),
) as Record<JointId, JointId | null>;

type NameTable = Record<JointId, string | null>;

function sided(prefix: (side: Side) => string, suffix: (side: Side) => string, limb: Record<LimbJoint, string>) {
  const out: Partial<NameTable> = {};
  for (const side of ['L', 'R'] as Side[]) {
    for (const [joint, name] of Object.entries(limb) as [LimbJoint, string][]) {
      out[`${joint}.${side}`] = `${prefix(side)}${name}${suffix(side)}`;
    }
  }
  return out;
}

/** `null` means the target has no such bone (the joint is skipped). */
export const BONE_NAMES: Record<RigTarget, NameTable> = {
  // Unity Mecanim Humanoid auto-mapping names (also Godot's SkeletonProfileHumanoid).
  unity: {
    root: null,
    hips: 'Hips',
    spine: 'Spine',
    chest: 'Chest',
    upperChest: 'UpperChest',
    neck: 'Neck',
    head: 'Head',
    ...sided((s) => (s === 'L' ? 'Left' : 'Right'), () => '', {
      shoulder: 'Shoulder',
      upperArm: 'UpperArm',
      lowerArm: 'LowerArm',
      hand: 'Hand',
      upperLeg: 'UpperLeg',
      lowerLeg: 'LowerLeg',
      foot: 'Foot',
      toes: 'Toes',
    }),
  } as NameTable,
  // Unreal Engine mannequin (SK_Mannequin) bone names.
  unreal: {
    root: 'root',
    hips: 'pelvis',
    spine: 'spine_01',
    chest: 'spine_02',
    upperChest: 'spine_03',
    neck: 'neck_01',
    head: 'head',
    ...sided(() => '', (s) => (s === 'L' ? '_l' : '_r'), {
      shoulder: 'clavicle',
      upperArm: 'upperarm',
      lowerArm: 'lowerarm',
      hand: 'hand',
      upperLeg: 'thigh',
      lowerLeg: 'calf',
      foot: 'foot',
      toes: 'ball',
    }),
  } as NameTable,
  // Mixamo naming, handy for reusing Mixamo animation clips.
  mixamo: {
    root: null,
    hips: 'mixamorig:Hips',
    spine: 'mixamorig:Spine',
    chest: 'mixamorig:Spine1',
    upperChest: 'mixamorig:Spine2',
    neck: 'mixamorig:Neck',
    head: 'mixamorig:Head',
    ...sided((s) => (s === 'L' ? 'mixamorig:Left' : 'mixamorig:Right'), () => '', {
      shoulder: 'Shoulder',
      upperArm: 'Arm',
      lowerArm: 'ForeArm',
      hand: 'Hand',
      upperLeg: 'UpLeg',
      lowerLeg: 'Leg',
      foot: 'Foot',
      toes: 'ToeBase',
    }),
  } as NameTable,
};

export const TARGET_INFO: Record<RigTarget, { label: string; short: string; steps: string[] }> = {
  unity: {
    label: 'Unity Humanoid (Mecanim)',
    short: 'Unity',
    steps: [
      'Download the rigged .glb.',
      'Import it with a glTF importer package (UnityGLTF or glTFast), or open it in Blender and export FBX for the classic Unity pipeline.',
      'In the model import settings choose Rig → Animation Type: Humanoid. Bone names match Unity’s auto-mapping (Hips, Spine, Chest, LeftUpperArm…).',
      'Configure the Avatar if any bone is unassigned, then drive it with any Humanoid animation clip.',
    ],
  },
  unreal: {
    label: 'Unreal Engine Mannequin',
    short: 'Unreal',
    steps: [
      'Download the rigged .glb (Unreal 5 imports glTF skeletal meshes directly).',
      'Drag it into the Content Browser and import as a Skeletal Mesh.',
      'Bone names follow the UE mannequin (root, pelvis, spine_01…, upperarm_l…).',
      'Create an IK Rig and use the IK Retargeter to borrow animations from the UE Mannequin.',
    ],
  },
  mixamo: {
    label: 'Mixamo naming',
    short: 'Mixamo',
    steps: [
      'Download the rigged .glb.',
      'Bone names use the mixamorig: prefix, so Mixamo animation clips bind directly in three.js, Blender or any engine with Mixamo support.',
    ],
  },
};

/**
 * Landmarks describing where a humanoid's joints sit, in model units relative to
 * an origin at the centre of the feet. Heights are Y values, X values are
 * distances from the centre line.
 */
export interface RigFit {
  hipY: number;
  kneeY: number;
  ankleY: number;
  shoulderY: number;
  neckY: number;
  headY: number;
  headTopY: number;
  shoulderX: number;
  legX: number;
  /** X position of the fingertips. */
  armReach: number;
  /** Arm droop below horizontal in degrees: 0 = T-pose, ~45 = A-pose. */
  armAngle: number;
  footForward: number;
}

export const FIT_FIELDS: { key: keyof RigFit; label: string; kind: 'height' | 'width' | 'angle' }[] = [
  { key: 'headTopY', label: 'Head top', kind: 'height' },
  { key: 'headY', label: 'Head base', kind: 'height' },
  { key: 'neckY', label: 'Neck base', kind: 'height' },
  { key: 'shoulderY', label: 'Shoulder height', kind: 'height' },
  { key: 'hipY', label: 'Hip height', kind: 'height' },
  { key: 'kneeY', label: 'Knee height', kind: 'height' },
  { key: 'ankleY', label: 'Ankle height', kind: 'height' },
  { key: 'shoulderX', label: 'Shoulder width (half)', kind: 'width' },
  { key: 'armReach', label: 'Fingertip reach', kind: 'width' },
  { key: 'armAngle', label: 'Arm angle (°)', kind: 'angle' },
  { key: 'legX', label: 'Leg spacing (half)', kind: 'width' },
  { key: 'footForward', label: 'Foot length', kind: 'width' },
];

export interface JointLayout {
  joints: Record<JointId, THREE.Vector3>;
  /** End points for leaf bones, used for skin weighting and display. */
  tails: { head: THREE.Vector3; 'hand.L': THREE.Vector3; 'hand.R': THREE.Vector3; 'toes.L': THREE.Vector3; 'toes.R': THREE.Vector3 };
}

export function jointPositions(fit: RigFit, origin: THREE.Vector3 = new THREE.Vector3()): JointLayout {
  const P = (x: number, y: number, z: number) => new THREE.Vector3(origin.x + x, origin.y + y, origin.z + z);
  const h = fit.headTopY;
  const torso = fit.shoulderY - fit.hipY;
  const joints = {
    root: P(0, 0, 0),
    hips: P(0, fit.hipY, 0),
    spine: P(0, fit.hipY + torso * 0.22, 0),
    chest: P(0, fit.hipY + torso * 0.5, 0),
    upperChest: P(0, fit.hipY + torso * 0.78, 0),
    neck: P(0, fit.neckY, 0),
    head: P(0, fit.headY, 0),
  } as Record<JointId, THREE.Vector3>;
  const tails = { head: P(0, fit.headTopY, 0) } as JointLayout['tails'];

  const angle = THREE.MathUtils.degToRad(fit.armAngle);
  const armLen = Math.max(0.01, (fit.armReach - fit.shoulderX) / Math.max(0.2, Math.cos(angle)));
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const upperArm = P(s * fit.shoulderX, fit.shoulderY, 0);
    const dir = new THREE.Vector3(s * Math.cos(angle), -Math.sin(angle), 0);
    joints[`shoulder.${side}`] = P(s * fit.shoulderX * 0.25, fit.shoulderY, 0);
    joints[`upperArm.${side}`] = upperArm;
    joints[`lowerArm.${side}`] = upperArm.clone().addScaledVector(dir, armLen * 0.43);
    joints[`hand.${side}`] = upperArm.clone().addScaledVector(dir, armLen * 0.8);
    tails[`hand.${side}`] = upperArm.clone().addScaledVector(dir, armLen);

    joints[`upperLeg.${side}`] = P(s * fit.legX, fit.hipY - 0.03 * h, 0);
    joints[`lowerLeg.${side}`] = P(s * fit.legX, fit.kneeY, 0.008 * h);
    joints[`foot.${side}`] = P(s * fit.legX, fit.ankleY, 0);
    joints[`toes.${side}`] = P(s * fit.legX, fit.ankleY * 0.3, fit.footForward * 0.65);
    tails[`toes.${side}`] = P(s * fit.legX, fit.ankleY * 0.3, fit.footForward);
  }
  return { joints, tails };
}

/** Canonical joint → engine bone name, as a downloadable mapping table. */
export function boneMap(target: RigTarget): Record<string, string> {
  const out: Record<string, string> = {};
  for (const j of JOINTS) {
    const name = BONE_NAMES[target][j.id];
    if (name) out[j.id] = name;
  }
  return out;
}
