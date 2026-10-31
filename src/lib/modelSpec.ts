import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './random';

/**
 * A ModelSpec is a JSON-serialisable description of a model built from
 * primitives. Characters and text-to-3D assets are stored as specs so they can
 * be persisted, re-generated, rigged and exported without keeping meshes around.
 */
export type Vec3 = [number, number, number];

export type Shape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'ico' | 'octa' | 'blob';

export interface MaterialSpec {
  color: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  flatShading?: boolean;
}

export interface PartSpec {
  name?: string;
  shape: Shape;
  /**
   * Shape arguments:
   * box [w, h, d] · sphere [r, thetaLength?] · cylinder [rTop, rBottom, h, segments?, thetaLength?]
   * cone [r, h, segments?] · torus [r, tube, arc?] · capsule [r, length] · ico [r, detail?]
   * octa [r] · blob [r, roughness]
   */
  args: number[];
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  material: MaterialSpec;
  seed?: number;
}

export interface InstanceSpec {
  position: Vec3;
  rotationY?: number;
  scale?: number;
}

export interface ModelSpec {
  parts: PartSpec[];
  /** Optional copies of the whole part list (e.g. "three trees"). */
  instances?: InstanceSpec[];
}

export function createGeometry(part: PartSpec): THREE.BufferGeometry {
  const a = part.args;
  switch (part.shape) {
    case 'box':
      return new THREE.BoxGeometry(a[0] ?? 1, a[1] ?? 1, a[2] ?? 1);
    case 'sphere':
      return new THREE.SphereGeometry(a[0] ?? 0.5, 28, 18, 0, Math.PI * 2, 0, a[1] ?? Math.PI);
    case 'cylinder':
      return new THREE.CylinderGeometry(a[0] ?? 0.5, a[1] ?? a[0] ?? 0.5, a[2] ?? 1, a[3] ?? 24, 1, false, 0, a[4] ?? Math.PI * 2);
    case 'cone':
      return new THREE.ConeGeometry(a[0] ?? 0.5, a[1] ?? 1, a[2] ?? 24);
    case 'torus':
      return new THREE.TorusGeometry(a[0] ?? 0.5, a[1] ?? 0.1, 12, 36, a[2] ?? Math.PI * 2);
    case 'capsule':
      return new THREE.CapsuleGeometry(a[0] ?? 0.2, a[1] ?? 0.5, 6, 14);
    case 'ico':
      return new THREE.IcosahedronGeometry(a[0] ?? 0.5, a[1] ?? 0);
    case 'octa':
      return new THREE.OctahedronGeometry(a[0] ?? 0.5, 0);
    case 'blob':
      return blobGeometry(a[0] ?? 0.5, a[1] ?? 0.3, part.seed ?? 1);
  }
}

/** A lumpy sphere: displacement is a smooth function of direction so seams stay closed. */
function blobGeometry(radius: number, roughness: number, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const waves = Array.from({ length: 5 }, () => ({
    f: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(1.5 + rand() * 3),
    phase: rand() * Math.PI * 2,
    amp: 0.3 + rand() * 0.7,
  }));
  const ampSum = waves.reduce((s, w) => s + w.amp, 0);
  const g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let n = 0;
    for (const w of waves) n += w.amp * Math.sin(v.dot(w.f) + w.phase);
    v.multiplyScalar(radius * (1 + (roughness * n) / ampSum));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const merged = mergeVertices(g);
  merged.computeVertexNormals();
  return merged;
}

export function createMaterial(m: MaterialSpec): THREE.MeshStandardMaterial {
  const opacity = m.opacity ?? 1;
  return new THREE.MeshStandardMaterial({
    color: m.color,
    metalness: m.metalness ?? 0.05,
    roughness: m.roughness ?? 0.7,
    emissive: m.emissive ?? '#000000',
    emissiveIntensity: m.emissiveIntensity ?? 1,
    transparent: opacity < 1,
    opacity,
    flatShading: m.flatShading ?? false,
  });
}

function partMatrix(part: PartSpec): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0])));
  return new THREE.Matrix4().compose(new THREE.Vector3(...part.position), q, new THREE.Vector3(...(part.scale ?? [1, 1, 1])));
}

/**
 * Build a THREE.Group from a spec. With `merge`, parts sharing a material are
 * merged into one mesh (fewer draw calls and cleaner skinning/export).
 */
export function buildFromSpec(spec: ModelSpec, opts: { merge?: boolean; name?: string } = {}): THREE.Group {
  const base = new THREE.Group();
  base.name = opts.name ?? 'Model';

  if (opts.merge) {
    const buckets = new Map<string, { mat: MaterialSpec; geoms: THREE.BufferGeometry[] }>();
    for (const part of spec.parts) {
      let g = createGeometry(part);
      g.applyMatrix4(partMatrix(part));
      if (g.attributes.uv) g.deleteAttribute('uv');
      if (!g.index) g = mergeVertices(g);
      const key = JSON.stringify(part.material);
      const bucket = buckets.get(key) ?? { mat: part.material, geoms: [] };
      bucket.geoms.push(g);
      buckets.set(key, bucket);
    }
    let i = 0;
    for (const { mat, geoms } of buckets.values()) {
      const merged = mergeGeometries(geoms, false);
      const meshes = merged ? [merged] : geoms;
      for (const g of meshes) {
        const mesh = new THREE.Mesh(g, createMaterial(mat));
        mesh.name = `${base.name}_part${i++}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        base.add(mesh);
      }
    }
  } else {
    spec.parts.forEach((part, i) => {
      const mesh = new THREE.Mesh(createGeometry(part), createMaterial(part.material));
      mesh.name = part.name ?? `${base.name}_part${i}`;
      mesh.position.set(...part.position);
      if (part.rotation) mesh.rotation.set(...part.rotation);
      if (part.scale) mesh.scale.set(...part.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      base.add(mesh);
    });
  }

  if (!spec.instances || spec.instances.length <= 1) {
    const inst = spec.instances?.[0];
    if (inst) {
      base.position.set(...inst.position);
      base.rotation.y = inst.rotationY ?? 0;
      base.scale.setScalar(inst.scale ?? 1);
    }
    return base;
  }

  const root = new THREE.Group();
  root.name = base.name;
  spec.instances.forEach((inst, i) => {
    const copy = base.clone();
    copy.name = `${base.name}_${i + 1}`;
    copy.position.set(...inst.position);
    copy.rotation.y = inst.rotationY ?? 0;
    copy.scale.setScalar(inst.scale ?? 1);
    root.add(copy);
  });
  return root;
}

export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => m?.dispose());
    }
  });
}
