import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { autoRig, detectFit } from './autoRig';
import { buildBlueprint, SAMPLE_SCREENPLAY, SAMPLE_STORY, storyToGame } from './gameBlueprint';
import { buildHumanoid, defaultCharacter } from './humanoid';
import { buildFromSpec } from './modelSpec';
import { parseScript } from './scriptParser';
import { BONE_NAMES } from './skeletons';
import { generateModel } from './textTo3d';

describe('text to 3D', () => {
  it('understands object, colour, material and count', () => {
    const r = generateModel('three red wooden barrels');
    const values = Object.fromEntries(r.interpretation.map((i) => [i.label, i.value]));
    expect(values.Object).toBe('barrel');
    expect(values.Colour).toBe('red');
    expect(values.Material).toBe('wood');
    expect(r.spec.instances).toHaveLength(3);
  });

  it('picks the subject before a preposition', () => {
    expect(generateModel('a knight with a sword').fit).toBeDefined();
    expect(generateModel('fire sword').interpretation[0].value).toBe('sword');
  });

  it('falls back to an abstract form for unknown prompts', () => {
    const r = generateModel('quantum flibbertigibbet');
    expect(r.spec.parts[0].shape).toBe('blob');
    expect(buildFromSpec(r.spec).children.length).toBeGreaterThan(0);
  });
});

describe('auto rig', () => {
  const { spec, fit } = buildHumanoid({ ...defaultCharacter(), id: 'c1' });

  it('creates engine-named bones with normalised weights', () => {
    const model = buildFromSpec(spec, { merge: true });
    for (const target of ['unity', 'unreal', 'mixamo'] as const) {
      const rig = autoRig(model, fit, target);
      const names = rig.skeleton.bones.map((b) => b.name);
      for (const n of Object.values(BONE_NAMES[target])) if (n) expect(names).toContain(n);
      const w = rig.meshes[0].geometry.attributes.skinWeight;
      for (let i = 0; i < w.count; i += 97) {
        expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 4);
      }
    }
  });

  it('binds the left hand to left arm bones', () => {
    const model = buildFromSpec(spec, { merge: true });
    const rig = autoRig(model, fit, 'unity');
    const handIdx = rig.skeleton.bones.findIndex((b) => b.name === 'LeftHand');
    const skin = rig.meshes.find((m) => {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getX(i) > fit.armReach - 0.05) return true;
      return false;
    })!;
    const p = skin.geometry.attributes.position;
    const idx = skin.geometry.attributes.skinIndex;
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) > fit.armReach - 0.05) expect(idx.getX(i)).toBe(handIdx);
    }
  });

  it('detects a plausible fit for an unknown mesh', () => {
    const model = buildFromSpec(spec, { merge: true });
    const { fit: guess } = detectFit(model);
    expect(guess.headTopY).toBeCloseTo(fit.headTopY, 1);
    expect(guess.armReach).toBeGreaterThan(fit.armReach * 0.9);
    expect(guess.legX).toBeGreaterThan(0.05);
    expect(new THREE.Box3().setFromObject(model).max.y).toBeGreaterThan(1.7);
  });
});

describe('script reader', () => {
  it('parses a screenplay into scenes and speakers', () => {
    const p = parseScript(SAMPLE_SCREENPLAY);
    expect(p.format).toBe('screenplay');
    expect(p.title).toBe('Signal Lost');
    expect(p.scenes.map((s) => s.location)).toEqual(['Orbital Station', 'Station Hull', 'Control Room']);
    expect(p.characters.map((c) => c.name)).toEqual(expect.arrayContaining(['Nova', 'AI-7', 'Reyes']));
  });

  it('builds playable levels from a screenplay', () => {
    const bp = storyToGame(SAMPLE_SCREENPLAY);
    expect(bp.genre).toBe('Sci-Fi');
    expect(bp.characters.find((c) => c.role === 'player')?.name).toBe('Nova');
    expect(bp.levels.map((l) => l.objective.type)).toEqual(['collect', 'defeat', 'talk']);
    expect(bp.levels[0].environment).toBe('space');
    expect(bp.levels[1].enemies[0].name).toBe('Drone');
  });

  it('parses prose into characters, locations and objectives', () => {
    const p = parseScript(SAMPLE_STORY);
    expect(p.format).toBe('prose');
    expect(p.title).toBe('The Lantern of Emberfall');
    const names = p.characters.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Mara', 'Tomas', 'Grik']));
    expect(names).not.toContain('Emberfall');
    expect(names).not.toContain('Elder');

    const bp = buildBlueprint(p);
    expect(bp.genre).toBe('Fantasy');
    expect(bp.characters.find((c) => c.role === 'player')?.name).toBe('Mara');
    expect(bp.characters.find((c) => c.name === 'Grik')?.role).toBe('enemy');
    expect(bp.levels.map((l) => l.environment)).toEqual(['village', 'forest', 'cave', 'village']);
    expect(bp.levels.map((l) => l.objective.type)).toEqual(['talk', 'defeat', 'defeat', 'talk']);
    expect(bp.levels[3].name).toBe('Return to Village');
    expect(bp.levels[0].dialogue.every((d) => d.speaker === 'Tomas')).toBe(true);
  });
});
