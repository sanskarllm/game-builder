import JSZip from 'jszip';
import * as THREE from 'three';
import type { Asset3D, GameProject } from '../store';
import { autoRig } from './autoRig';
import { exportGLB } from './exporters';
import type { StoryBlueprint } from './gameBlueprint';
import { buildHumanoid, type CharacterParams } from './humanoid';
import { buildFromSpec, disposeObject } from './modelSpec';
import { slugify } from './random';
import { boneMap, TARGET_INFO, type RigTarget } from './skeletons';

export const ENGINE_RIG: Record<GameProject['engine'], RigTarget> = {
  unity: 'unity',
  unreal: 'unreal',
  godot: 'unity', // Godot's SkeletonProfileHumanoid uses the same bone names as Unity
};

export async function rigCharacterGLB(c: CharacterParams, target: RigTarget): Promise<Blob> {
  const { spec, fit } = buildHumanoid(c);
  const model = buildFromSpec(spec, { merge: true, name: c.name });
  const rig = autoRig(model, fit, target, new THREE.Vector3());
  rig.armature.name = c.name;
  const blob = await exportGLB(rig.armature);
  disposeObject(model);
  return blob;
}

/** Bundle everything a project references into a zip ready to drop into an engine. */
export async function exportProjectBundle(
  project: GameProject,
  characters: CharacterParams[],
  assets: Asset3D[],
  story: StoryBlueprint | null,
): Promise<Blob> {
  const zip = new JSZip();
  const target = ENGINE_RIG[project.engine];
  const manifest = {
    name: project.name,
    genre: project.genre,
    perspective: project.perspective,
    engine: project.engine,
    description: project.description,
    rig: { target, boneMap: boneMap(target) },
    characters: characters.map((c) => ({ name: c.name, file: `characters/${slugify(c.name)}.glb`, params: c })),
    assets: assets.map((a) => ({ name: a.name, prompt: a.prompt, file: `assets/${slugify(a.name)}.glb` })),
    story: story ? 'story/blueprint.json' : null,
    exportedAt: new Date().toISOString(),
  };
  zip.file('project.json', JSON.stringify(manifest, null, 2));

  for (const c of characters) {
    zip.file(`characters/${slugify(c.name)}.glb`, await rigCharacterGLB(c, target));
  }
  for (const a of assets) {
    const model = buildFromSpec(a.spec, { merge: true, name: a.name });
    zip.file(`assets/${slugify(a.name)}.glb`, await exportGLB(model));
    disposeObject(model);
  }
  if (story) zip.file('story/blueprint.json', JSON.stringify(story, null, 2));

  const info = TARGET_INFO[target];
  zip.file(
    'README.txt',
    [
      `${project.name} — exported from Game Builder`,
      '',
      `Engine: ${project.engine}. Characters are rigged with ${info.label} bone names.`,
      '',
      'Importing characters:',
      ...info.steps.map((s, i) => `  ${i + 1}. ${s}`),
      '',
      'assets/ holds static props (.glb). story/blueprint.json holds levels, characters,',
      'objectives and dialogue generated from your script.',
    ].join('\n'),
  );

  return zip.generateAsync({ type: 'blob' });
}
