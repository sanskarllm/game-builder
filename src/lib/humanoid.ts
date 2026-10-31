import * as THREE from 'three';
import type { MaterialSpec, ModelSpec, PartSpec, Vec3 } from './modelSpec';
import type { RigFit } from './skeletons';

export type HairStyle = 'none' | 'short' | 'long' | 'mohawk';
export type Outfit = 'casual' | 'armor' | 'robe';

export interface CharacterParams {
  id: string;
  name: string;
  /** Total height in metres. */
  height: number;
  build: number;
  headScale: number;
  legLength: number;
  armLength: number;
  skin: string;
  shirt: string;
  pants: string;
  shoes: string;
  hair: string;
  hairStyle: HairStyle;
  outfit: Outfit;
  createdAt: number;
}

export const CHARACTER_PRESETS: Record<string, Pick<CharacterParams, 'headScale' | 'legLength' | 'armLength' | 'build'>> = {
  Realistic: { headScale: 1, legLength: 1, armLength: 1, build: 1 },
  Heroic: { headScale: 0.85, legLength: 1.08, armLength: 1.02, build: 1.25 },
  Slender: { headScale: 0.95, legLength: 1.1, armLength: 1.05, build: 0.8 },
  Chibi: { headScale: 1.9, legLength: 0.75, armLength: 0.85, build: 1.1 },
};

export function defaultCharacter(name = 'New Character'): CharacterParams {
  return {
    id: '',
    name,
    height: 1.8,
    build: 1,
    headScale: 1,
    legLength: 1,
    armLength: 1,
    skin: '#e0ac69',
    shirt: '#3d6fd6',
    pants: '#2b2f3a',
    shoes: '#4a3022',
    hair: '#3b2414',
    hairStyle: 'short',
    outfit: 'casual',
    createdAt: Date.now(),
  };
}

const mat = (color: string, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  color,
  metalness: 0.05,
  roughness: 0.75,
  ...extra,
});

/** A capsule spanning two points. */
export function limb(a: Vec3, b: Vec3, radius: number, material: MaterialSpec, name?: string): PartSpec {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  return {
    name,
    shape: 'capsule',
    args: [radius, Math.max(0.001, len)],
    position: [mid.x, mid.y, mid.z],
    rotation: [e.x, e.y, e.z],
    material,
  };
}

/**
 * Build a T-posed humanoid from parameters. Returns the spec plus the exact
 * joint landmarks, so the rigging step does not have to guess.
 */
export function buildHumanoid(p: CharacterParams): { spec: ModelSpec; fit: RigFit } {
  const H = p.height;
  const b = p.build;
  const sb = Math.sqrt(b);

  const headR = 0.062 * H * p.headScale;
  const headC = H - headR;
  const neckTop = headC - headR * 0.8;
  const shoulderY = neckTop - 0.045 * H;
  const hipY = Math.min(0.47 * H * p.legLength, shoulderY - 0.16 * H);
  const kneeY = hipY * 0.53;
  const ankleY = 0.05 * H;
  const shoulderX = 0.115 * H * b;
  const legX = 0.052 * H * b;
  const armLen = 0.4 * H * p.armLength;
  const elbowX = shoulderX + armLen * 0.43;
  const wristX = shoulderX + armLen * 0.8;
  const tipX = shoulderX + armLen;
  const limbR = 0.03 * H * sb;

  const skin = mat(p.skin, { roughness: 0.6 });
  const armor = p.outfit === 'armor';
  const shirt = armor ? mat(p.shirt, { metalness: 0.85, roughness: 0.3 }) : mat(p.shirt);
  const pants = mat(p.pants);
  const shoes = mat(p.shoes, { roughness: 0.5 });
  const hair = mat(p.hair, { roughness: 0.9 });
  const dark = mat('#15151c', { roughness: 0.3 });

  const parts: PartSpec[] = [];

  // Torso & pelvis
  const torsoR = 0.085 * H * b;
  const span = shoulderY - hipY + 0.05 * H;
  parts.push({
    name: 'Torso',
    shape: 'capsule',
    args: [torsoR, Math.max(0.01, span - 2 * torsoR)],
    position: [0, (hipY + shoulderY) / 2 + 0.01 * H, 0],
    scale: [1, 1, 0.68],
    material: shirt,
  });
  parts.push({
    name: 'Pelvis',
    shape: 'sphere',
    args: [0.09 * H * b],
    position: [0, hipY, 0],
    scale: [1.05, 0.55, 0.75],
    material: pants,
  });

  // Neck & head
  parts.push(limb([0, shoulderY - 0.01 * H, 0], [0, neckTop + headR * 0.2, 0], 0.028 * H * sb, skin, 'Neck'));
  parts.push({ name: 'Head', shape: 'sphere', args: [headR], position: [0, headC, 0], material: skin });
  for (const s of [1, -1]) {
    parts.push({
      name: 'Eye',
      shape: 'sphere',
      args: [0.12 * headR],
      position: [s * 0.36 * headR, headC + 0.08 * headR, 0.86 * headR],
      material: dark,
    });
  }

  // Hair
  if (p.hairStyle !== 'none' && p.hairStyle !== 'mohawk') {
    parts.push({
      name: 'Hair',
      shape: 'sphere',
      args: [headR * 1.07, Math.PI * 0.5],
      position: [0, headC + 0.02 * headR, -0.03 * headR],
      rotation: [-0.25, 0, 0],
      material: hair,
    });
  }
  if (p.hairStyle === 'long') {
    parts.push({
      name: 'HairBack',
      shape: 'box',
      args: [headR * 1.9, headR * 1.6, headR * 0.5],
      position: [0, headC - 0.5 * headR, -0.65 * headR],
      material: hair,
    });
  }
  if (p.hairStyle === 'mohawk') {
    parts.push({
      name: 'Mohawk',
      shape: 'box',
      args: [headR * 0.3, headR * 0.5, headR * 1.6],
      position: [0, headC + headR * 0.95, -0.1 * headR],
      material: hair,
    });
  }

  // Limbs
  const forearmMat = p.outfit === 'casual' ? skin : shirt;
  for (const s of [1, -1]) {
    parts.push({
      name: 'Shoulder',
      shape: 'sphere',
      args: [armor ? 0.05 * H * sb : limbR * 1.15],
      position: [s * shoulderX, shoulderY, 0],
      material: shirt,
    });
    parts.push(limb([s * shoulderX, shoulderY, 0], [s * elbowX, shoulderY, 0], limbR, shirt, 'UpperArm'));
    parts.push(limb([s * elbowX, shoulderY, 0], [s * wristX, shoulderY, 0], limbR * 0.85, forearmMat, 'LowerArm'));
    parts.push(limb([s * wristX, shoulderY, 0], [s * (tipX - limbR * 0.8), shoulderY, 0], limbR * 0.8, skin, 'Hand'));

    parts.push(limb([s * legX, hipY - 0.01 * H, 0], [s * legX, kneeY, 0], 0.048 * H * sb, pants, 'UpperLeg'));
    parts.push(limb([s * legX, kneeY, 0], [s * legX, ankleY + 0.01 * H, 0], 0.038 * H * sb, pants, 'LowerLeg'));
    parts.push({
      name: 'Foot',
      shape: 'box',
      args: [0.065 * H * sb, 0.05 * H, 0.15 * H],
      position: [s * legX, 0.025 * H, 0.035 * H],
      material: shoes,
    });
  }

  if (p.outfit === 'robe') {
    const top = hipY + 0.04 * H;
    const bottom = 0.07 * H;
    parts.push({
      name: 'Robe',
      shape: 'cylinder',
      args: [0.095 * H * b, 0.17 * H * b, top - bottom, 24],
      position: [0, (top + bottom) / 2, 0],
      material: shirt,
    });
  }

  const fit: RigFit = {
    hipY,
    kneeY,
    ankleY,
    shoulderY,
    neckY: shoulderY + 0.012 * H,
    headY: neckTop,
    headTopY: H + (p.hairStyle === 'mohawk' ? 0.2 * headR : 0.05 * headR),
    shoulderX,
    legX,
    armReach: tipX,
    armAngle: 0,
    footForward: 0.11 * H,
  };

  return { spec: { parts }, fit };
}
