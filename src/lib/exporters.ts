import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export async function exportGLB(object: THREE.Object3D): Promise<Blob> {
  const result = await new GLTFExporter().parseAsync(object, { binary: true });
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJSON(data: unknown, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

/** Load a user-supplied model file (.glb, self-contained .gltf, .obj or .fbx). */
export async function loadModelFile(file: File): Promise<THREE.Object3D> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'obj') return new OBJLoader().parse(await file.text());
  if (ext === 'fbx') return new FBXLoader().parse(await file.arrayBuffer(), '');
  if (ext === 'glb' || ext === 'gltf') {
    const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
    const gltf = await new GLTFLoader().parseAsync(data, '');
    return gltf.scene;
  }
  throw new Error(`Unsupported file type: .${ext}. Use .glb, .gltf, .obj or .fbx.`);
}
