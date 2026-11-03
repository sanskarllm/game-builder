const invalid = message => Object.assign(new Error(message), {status: 400});
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

export function saveEditor(project, body) {
  const revision = project.editor?.revision ?? 0;
  if (body.revision !== revision) {
    throw Object.assign(new Error('This editor changed in another tab. Your draft is kept on this PC. Reopen the saved version to continue.'), {status: 409});
  }
  const doc = body.document;
  if (!isObject(doc) || JSON.stringify(doc).length > 2_000_000 || !isObject(doc.scenes) || !Object.hasOwn(doc.scenes, 'start')) throw invalid('The editor needs a starting scene and a document under 2 MB.');
  const entries = Object.entries(doc.scenes);
  if (entries.length > 1000 || !Array.isArray(doc.variables) || !Array.isArray(doc.overlays) || !isObject(doc.time)) throw invalid('Invalid editor document.');
  for (const [id, scene] of entries) {
    if (!safeId(id) || !isObject(scene) || scene.id !== id || typeof scene.title !== 'string' || typeof scene.dialogue !== 'string' || typeof scene.speakerId !== 'string' || !Array.isArray(scene.choices)) throw invalid('Invalid scene.');
    if (scene.choices.some(choice => !isObject(choice) || typeof choice.text !== 'string' || typeof choice.nextNodeId !== 'string' || (choice.nextNodeId && !Object.hasOwn(doc.scenes, choice.nextNodeId)))) throw invalid('A choice points to a missing scene.');
    if (scene.characters && (!Array.isArray(scene.characters) || scene.characters.some(c => !isObject(c) || typeof c.characterId !== 'string'))) throw invalid('Invalid scene cast.');
  }
  if (doc.variables.some(v => !isObject(v) || typeof v.name !== 'string' || !['int','string','bool'].includes(v.type)) || doc.overlays.some(o => !isObject(o) || typeof o.id !== 'string')) throw invalid('Invalid story controls.');
  return {revision: revision + 1, document: {scenes: doc.scenes, variables: doc.variables, overlays: doc.overlays, time: doc.time}};
}

