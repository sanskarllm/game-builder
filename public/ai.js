// Meta AI client + every prompt Game Forge sends.
// All generation (story, dialogue, edits, 2D art, music, 3D models) goes
// through one function, llama(), which posts to the local server's
// /api/chat proxy → Meta Model API (Muse Spark), or a host serving Meta Llama.

export const PROVIDERS = [
  { id: 'muse', label: 'Meta Model API · Muse Spark', baseUrl: 'https://api.meta.ai/v1', model: 'muse-spark-1.1', needsKey: true, reasoning: true,
    keyHint: 'Key from dev.meta.ai/api-keys', models: ['muse-spark-1.1', 'muse-spark-1.3'] },
  { id: 'meta', label: 'Meta Llama API (llama.com)', keyHint: 'LLM|… from llama.developer.meta.com', baseUrl: 'https://api.llama.com/compat/v1', model: 'Llama-4-Maverick-17B-128E-Instruct-FP8', needsKey: true,
    models: ['Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama-4-Scout-17B-16E-Instruct-FP8', 'Llama-3.3-70B-Instruct', 'Llama-3.3-8B-Instruct'] },
  { id: 'groq', label: 'Groq · Meta Llama', baseUrl: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-maverick-17b-128e-instruct', needsKey: true,
    models: ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile'] },
  { id: 'together', label: 'Together AI · Meta Llama', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', needsKey: true,
    models: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  { id: 'ollama', label: 'Ollama (local Llama)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false,
    models: ['llama3.2', 'llama3.1', 'llama3.3', 'llama4'] },
];

let settings = { provider: 'muse', baseUrl: PROVIDERS[0].baseUrl, model: PROVIDERS[0].model, apiKey: '' };
export function setLlamaSettings(s) { settings = { ...settings, ...s }; }

export async function llama(messages, { temperature = 0.7, maxTokens = 2048, signal, effort = 'low' } = {}) {
  const prov = PROVIDERS.find(p => p.id === settings.provider);
  const reasoning = !!(prov && prov.reasoning) || /^muse/i.test(settings.model);
  const r = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ messages, temperature, maxTokens, reasoning, reasoningEffort: reasoning ? effort : undefined, baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey || undefined }),
  });
  const data = await r.json().catch(() => ({ error: 'The local Game Forge server did not answer. Is `node server.js` running?' }));
  if (!r.ok || data.error) throw new Error(data.error || ('HTTP ' + r.status));
  return data.text;
}

// Pull a JSON object out of model output (handles ```json fences, chatter
// before/after, trailing commas).
export function parseJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) { /* keep trying */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    const inner = t.slice(a, b + 1);
    try { return JSON.parse(inner); } catch (e) { /* keep trying */ }
    try { return JSON.parse(inner.replace(/,\s*([}\]])/g, '$1')); } catch (e) { /* give up */ }
  }
  throw new Error('Meta AI replied with something that is not valid JSON.');
}

async function llamaJSON(system, user, opts) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const first = await llama(messages, opts);
  try { return parseJSON(first); } catch (e) {
    const retry = await llama([...messages, { role: 'assistant', content: first }, { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the JSON object, no prose, no code fences.' }], { ...opts, temperature: 0.2 });
    return parseJSON(retry);
  }
}

// ---------- game builder ----------
const GAME_SCHEMA = `{
  "title": string, "logline": string (one sentence pitch),
  "characters": [{"name": string, "role": "Lead|Mentor|Antagonist|Ally|Minor", "desc": string (visual description for an artist), "color": "#rrggbb"}],
  "backgrounds": [{"name": string, "desc": string (visual description of the location)}],
  "music": [{"name": "snake_case_name.mp3", "mood": string}],
  "scenes": [{"id": "s1", "title": string, "bg": background name, "music": music name, "transition": "Fade|Cut|Dissolve|Slide left",
    "chars": [{"name": character name, "expr": one-word expression, "pos": "L|C|R"}],
    "lines": [{"who": character name or "Narrator", "text": string}],
    "choices": [{"text": string, "to": scene id}]}]
}`;

export async function buildGame(idea, { genre, length, tone }) {
  const n = { short: '6-8', medium: '9-12', long: '13-16' }[length] || '8-10';
  const system = `You are Forge, a senior narrative game designer powered by Meta AI. You design branching visual novels.
Return ONLY a JSON object with this exact shape:
${GAME_SCHEMA}
Rules:
- ${n} scenes. "s1" is the opening scene. Scene ids are "s1", "s2", ...
- 2 to 4 ending scenes; an ending has "choices": [].
- Every non-ending scene has 1-3 choices and every "to" must be an existing scene id. No scene may be unreachable from s1.
- Every scene's "bg" must be one of the background names, "music" one of the music names, every "chars" name one of the character names.
- 3 to 6 dialogue lines per scene, vivid and in-character, under 220 characters each. Max 3 characters on stage, using distinct positions.
- 3-6 characters, 3-7 backgrounds, 3-5 music tracks.`;
  const user = `Game idea: ${idea}\nGenre: ${genre || 'any'}\nTone: ${tone || 'any'}\nWrite the full game now.`;
  return normalizeGame(await llamaJSON(system, user, { temperature: 0.85, maxTokens: 8000, effort: 'medium' }));
}

// Make whatever the model returned safe to load: unique ids, valid links,
// assets that exist, and a laid-out scene chart.
export function normalizeGame(g) {
  const game = {
    title: String(g.title || 'Untitled Game'), logline: String(g.logline || ''),
    characters: [], backgrounds: [], music: [], scenes: [], assets3d: g.assets3d || [],
  };
  const uniq = (list, key) => { const seen = new Set(); return list.filter(x => x && x[key] && !seen.has(x[key]) && seen.add(x[key])); };
  game.characters = uniq((g.characters || []).map(c => ({ name: String(c.name || '').trim(), role: c.role || 'Minor', desc: c.desc || '', color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : undefined, svg: c.svg, img: c.img })), 'name');
  game.backgrounds = uniq((g.backgrounds || []).map(b => ({ name: String(b.name || '').trim(), desc: b.desc || '', svg: b.svg, img: b.img })), 'name');
  game.music = uniq((g.music || []).map(m => ({ ...m, name: String(m.name || '').trim(), mood: m.mood || '' })), 'name');

  let scenes = (g.scenes || []).filter(s => s && typeof s === 'object');
  const idMap = {}; scenes.forEach((s, i) => { const id = String(s.id || 's' + (i + 1)); idMap[id] = idMap[id] ? 's' + (i + 1) + '_' + i : id; s.id = idMap[id]; });
  const ids = new Set(scenes.map(s => s.id));
  const ensure = (list, name, make) => { if (name && !list.some(x => x.name === name)) list.push(make(name)); };
  scenes = scenes.map(s => {
    const sc = {
      id: s.id, title: String(s.title || 'Scene'), bg: String(s.bg || (game.backgrounds[0] || {}).name || 'Backdrop'),
      music: String(s.music || (game.music[0] || {}).name || ''), transition: ['Fade', 'Cut', 'Dissolve', 'Slide left'].includes(s.transition) ? s.transition : 'Fade',
      chars: (s.chars || []).slice(0, 4).map(c => ({ name: String(c.name || c), expr: String(c.expr || 'neutral'), pos: ['L', 'C', 'R'].includes(c.pos) ? c.pos : 'C' })),
      lines: (s.lines || []).map(l => typeof l === 'string' ? { who: 'Narrator', text: l } : { who: String(l.who || 'Narrator'), text: String(l.text || '') }).filter(l => l.text),
      choices: (s.choices || []).map(c => ({ text: String(c.text || 'Continue'), to: String(c.to || '') })).filter(c => ids.has(c.to) && c.to !== s.id),
      x: s.x, y: s.y,
    };
    ensure(game.backgrounds, sc.bg, name => ({ name, desc: name }));
    if (sc.music) ensure(game.music, sc.music, name => ({ name, mood: name }));
    sc.chars.forEach(c => ensure(game.characters, c.name, name => ({ name, role: 'Minor', desc: name })));
    return sc;
  });
  game.scenes = scenes;
  if (scenes.some(s => typeof s.x !== 'number')) layoutScenes(game.scenes);
  return game;
}

// Left-to-right layered layout by BFS depth from the first scene.
export function layoutScenes(scenes) {
  if (!scenes.length) return scenes;
  const byId = Object.fromEntries(scenes.map(s => [s.id, s]));
  const depth = { [scenes[0].id]: 0 }; const q = [scenes[0].id];
  while (q.length) { const id = q.shift(); for (const c of byId[id].choices) if (byId[c.to] && depth[c.to] === undefined) { depth[c.to] = depth[id] + 1; q.push(c.to); } }
  // Push scenes right along forward edges (BFS order breaks cycles) so a
  // scene always sits after every scene that leads into it.
  const order = Object.keys(depth); const rank = Object.fromEntries(order.map((id, i) => [id, i]));
  for (const id of order) for (const c of byId[id].choices) if (rank[c.to] > rank[id] && depth[c.to] <= depth[id]) depth[c.to] = depth[id] + 1;
  let maxD = Math.max(0, ...Object.values(depth));
  scenes.forEach(s => { if (depth[s.id] === undefined) depth[s.id] = ++maxD; });
  const cols = {}; scenes.forEach(s => (cols[depth[s.id]] = cols[depth[s.id]] || []).push(s));
  const tallest = Math.max(...Object.values(cols).map(c => c.length));
  Object.entries(cols).forEach(([d, list]) => list.forEach((s, i) => { s.x = Number(d) * 200; s.y = Math.round((i + (tallest - list.length) / 2) * 74); }));
  return scenes;
}

// ---------- assistant (chat + agentic edits) ----------
export function compactGame(game) {
  return {
    title: game.title, logline: game.logline,
    characters: game.characters.map(c => ({ name: c.name, role: c.role, desc: c.desc })),
    backgrounds: game.backgrounds.map(b => b.name), music: game.music.map(m => m.name),
    scenes: game.scenes.map(s => ({ id: s.id, title: s.title, bg: s.bg, music: s.music, transition: s.transition, chars: s.chars, lines: s.lines, choices: s.choices })),
    assets3d: (game.assets3d || []).map(a => a.name),
  };
}

const ACTIONS_DOC = `Actions you may return (only when the user wants the game changed):
{"type":"update_scene","id":"s2", ...any of "title","bg","music","transition","chars","lines","choices" — full replacement values}
{"type":"add_scene","id":"new id like s9","title":...,"bg":...,"music":...,"chars":[...],"lines":[...],"choices":[...],"from":"existing scene id to link from (optional)","choiceText":"text of that link (optional)"}
{"type":"delete_scene","id":"s4"}
{"type":"add_character","name":...,"role":...,"desc":...,"color":"#rrggbb"}
{"type":"update_character","name":existing name,"desc":...,"role":...}
{"type":"add_background","name":...,"desc":...}
{"type":"add_music","name":"name.mp3","mood":...}
{"type":"set_game","title":...,"logline":...}`;

export async function assistant({ game, selectedId, history, text, allowEdits }) {
  const system = `You are Forge Assistant, the game-design copilot inside the Game Forge editor, powered by Meta AI.
You help the user plan, write, balance and build their game: story structure, characters, dialogue, pacing, puzzle and gameplay ideas, art direction, and you can edit the project directly.
Current project (JSON): ${JSON.stringify(compactGame(game))}
Currently selected scene id: ${selectedId}
Respond with ONLY a JSON object: {"reply": "your answer to the user, plain text, concise and friendly", "actions": [ ... ]}
${allowEdits ? ACTIONS_DOC + '\nKeep names consistent with existing assets. Scene links ("to") must point to existing or newly added scene ids. If the user only asks a question, return "actions": [].' : 'Editing is switched off: always return "actions": [] and just advise.'}`;
  const msgs = [{ role: 'system', content: system }];
  history.slice(-10).forEach(m => msgs.push({ role: m.me ? 'user' : 'assistant', content: m.me ? m.text : JSON.stringify({ reply: m.text, actions: [] }) }));
  msgs.push({ role: 'user', content: text });
  const raw = await llama(msgs, { temperature: 0.6, maxTokens: 4000 });
  try {
    const j = parseJSON(raw);
    return { reply: String(j.reply || 'Done.'), actions: Array.isArray(j.actions) ? j.actions : [] };
  } catch (e) {
    return { reply: raw.trim(), actions: [] };
  }
}

export function applyActions(game, actions) {
  const g = JSON.parse(JSON.stringify(game)); const done = [];
  const scene = id => g.scenes.find(s => s.id === id);
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  for (const a of actions) {
    try {
      if (a.type === 'update_scene' && scene(a.id)) { Object.assign(scene(a.id), pick(a, ['title', 'bg', 'music', 'transition', 'chars', 'lines', 'choices'])); done.push('Edited ' + scene(a.id).title); }
      else if (a.type === 'add_scene') {
        let id = String(a.id || ''); if (!id || scene(id)) id = 's' + (g.scenes.length + 1) + '_' + Math.floor(Math.random() * 1000);
        const from = scene(a.from);
        g.scenes.push({ id, title: a.title || 'New scene', bg: a.bg || (from || g.scenes[0] || {}).bg, music: a.music || (from || {}).music || '', transition: a.transition || 'Fade', chars: a.chars || [], lines: a.lines || [], choices: a.choices || [], x: from ? from.x + 200 : 0, y: from ? from.y + 80 : 0 });
        if (from) from.choices.push({ text: a.choiceText || 'Continue', to: id });
        done.push('Added scene ' + (a.title || id));
      }
      else if (a.type === 'delete_scene' && scene(a.id) && g.scenes.length > 1) { g.scenes = g.scenes.filter(s => s.id !== a.id); g.scenes.forEach(s => s.choices = s.choices.filter(c => c.to !== a.id)); done.push('Deleted scene ' + a.id); }
      else if (a.type === 'add_character' && a.name && !g.characters.some(c => c.name === a.name)) { g.characters.push(pick(a, ['name', 'role', 'desc', 'color'])); done.push('New character ' + a.name); }
      else if (a.type === 'update_character') { const c = g.characters.find(c => c.name === a.name); if (c) { Object.assign(c, pick(a, ['role', 'desc', 'color'])); if (a.desc) { delete c.svg; } done.push('Updated ' + a.name); } }
      else if (a.type === 'add_background' && a.name && !g.backgrounds.some(b => b.name === a.name)) { g.backgrounds.push(pick(a, ['name', 'desc'])); done.push('New background ' + a.name); }
      else if (a.type === 'add_music' && a.name && !g.music.some(m => m.name === a.name)) { g.music.push(pick(a, ['name', 'mood'])); done.push('New track ' + a.name); }
      else if (a.type === 'set_game') { Object.assign(g, pick(a, ['title', 'logline'])); done.push('Updated game info'); }
    } catch (e) { /* skip bad action */ }
  }
  const fixed = normalizeGame(g);
  fixed.scenes.forEach(s => { const old = g.scenes.find(x => x.id === s.id); if (old && typeof old.x === 'number') { s.x = old.x; s.y = old.y; } });
  return { game: fixed, done };
}

// ---------- scene writer ----------
export async function writeScene(game, scene, instruction) {
  const system = `You are Forge, a visual-novel writer powered by Meta AI. Rewrite one scene of the game.
Project: ${JSON.stringify(compactGame(game))}
Return ONLY JSON: {"title": string, "lines": [{"who": name or "Narrator", "text": string}], "chars": [{"name","expr","pos":"L|C|R"}], "choiceTexts": [string, one per existing choice, same order]}
Use only existing character names. 3-7 lines.`;
  const j = await llamaJSON(system, `Scene to rewrite: ${JSON.stringify(scene)}\nInstruction: ${instruction || 'Write strong, in-character dialogue for this scene that fits the story so far.'}`, { temperature: 0.8, maxTokens: 2000 });
  return j;
}

// ---------- 2D art (Meta AI writes SVG) ----------
export async function paintBackground(name, desc, style) {
  const system = `You are an illustrator who paints with SVG code. Return ONLY one <svg> element, no prose.
Requirements: xmlns="http://www.w3.org/2000/svg", viewBox="0 0 1600 900", preserveAspectRatio="xMidYMid slice". Fill the entire canvas (start with a full-size background rect).
Use linearGradient/radialGradient, layered silhouettes, lighting and atmospheric depth. 25-70 shapes. No text, no <image>, no external references, no scripts, no CSS animations.`;
  const raw = await llama([{ role: 'system', content: system }, { role: 'user', content: `Paint a visual-novel background: "${name}". ${desc || ''}\nArt style: ${style || 'painterly, cinematic lighting'}.` }], { temperature: 0.7, maxTokens: 6000 });
  const svg = window.ForgePlayer.sanitizeSvg(raw);
  if (!svg) throw new Error('Meta AI did not return an SVG.');
  return svg;
}

export async function paintCharacter(name, desc, style) {
  const system = `You are a character artist who draws with SVG code. Return ONLY one <svg> element, no prose.
Requirements: xmlns="http://www.w3.org/2000/svg", viewBox="0 0 400 800". TRANSPARENT background (no full-canvas rect). One character, standing, facing the viewer, head near the top (y 80-300), body reaching the bottom edge (y 800), centered on x=200.
Clear face (eyes, brows, mouth), hair, distinctive clothing, simple shading with gradients. 25-60 shapes. No text, no <image>, no scripts.`;
  const raw = await llama([{ role: 'system', content: system }, { role: 'user', content: `Draw the visual-novel character "${name}". ${desc || ''}\nArt style: ${style || 'clean anime-inspired flat shading'}.` }], { temperature: 0.7, maxTokens: 6000 });
  const svg = window.ForgePlayer.sanitizeSvg(raw);
  if (!svg) throw new Error('Meta AI did not return an SVG.');
  return svg;
}

// ---------- music (Meta AI composes a note sequence) ----------
export async function composeMusic(name, mood) {
  const system = `You are a game composer. Compose a short loopable chiptune melody. Return ONLY JSON:
{"bpm": 60-160, "wave": "sine|triangle|square|sawtooth", "notes": [["E4", 1], ["G4", 0.5], ["rest", 1], ...], "bass": ["A2","F2","C3","G2"]}
Notes are scientific pitch (C3-C6) with durations in beats; 24-48 notes; total length a multiple of 4 beats; "bass" is one root note per bar.`;
  const j = await llamaJSON(system, `Track "${name}". Mood: ${mood || name}.`, { temperature: 0.9, maxTokens: 1500 });
  const notes = (j.notes || []).filter(n => Array.isArray(n) && n.length >= 1).map(n => [String(n[0]), Number(n[1]) || 1]).slice(0, 96);
  if (!notes.length) throw new Error('Meta AI returned no notes.');
  return { bpm: Number(j.bpm) || 90, wave: j.wave || 'triangle', notes, bass: Array.isArray(j.bass) ? j.bass.map(String).slice(0, 16) : [] };
}

// ---------- 3D from an image (Meta SAM 3D Body / Objects, via ../sam3d-service) ----------
async function sam3dCall(payload) {
  const r = await fetch('/api/sam3d', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, serviceUrl: settings.sam3dUrl || undefined, token: settings.sam3dToken || undefined }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'HTTP ' + r.status); }
  return r;
}
export async function sam3dHealth() { return (await sam3dCall({ action: 'health' })).json(); }

// kind: 'body' (SAM 3D Body — people) or 'objects' (SAM 3D Objects — anything)
export async function sam3d({ image, mask, textured, seed, kind }) {
  const r = await sam3dCall({ action: 'reconstruct', kind, image, mask: mask || undefined, textured: !!textured, seed });
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  let pose = {}; try { pose = JSON.parse(r.headers.get('x-pose') || '{}'); } catch (e) { /* optional */ }
  return { glb: 'data:model/gltf-binary;base64,' + btoa(bin), pose, seconds: r.headers.get('x-seconds') };
}

// ---------- 3D (Meta AI builds a model from primitives) ----------
export async function model3d({ name, cat, prompt, style, budget }) {
  const system = `You are a 3D modeling assistant powered by Meta AI. Build a game-ready ${style || 'low-poly stylized'} model out of primitives.
Return ONLY JSON: {"parts": [{"shape": "box|cylinder|cone|sphere|torus|capsule", "size": [...], "position": [x, y, z], "rotation": [rx, ry, rz], "color": "#rrggbb", "label": "short part name"}]}
size meaning: box [width, height, depth]; cylinder [radiusTop, radiusBottom, height]; cone [radius, height]; sphere [radius]; torus [radius, tube]; capsule [radius, length].
position is the CENTER of the part in meters. Y is up, ground is y=0, the model stands on the ground centered at x=0,z=0. rotation is in degrees.
Real-world scale (a human is ~1.75 tall, a house ~6 tall). Use ${Math.max(6, Math.round(budget / 2))}-${budget} parts. Parts should touch/overlap so the model is one solid object. Use a cohesive palette.`;
  const j = await llamaJSON(system, `Model: ${name} (${cat}). ${prompt || ''}`, { temperature: 0.5, maxTokens: 5000 });
  const parts = (j.parts || []).filter(p => p && p.shape && Array.isArray(p.position)).slice(0, 120);
  if (!parts.length) throw new Error('Meta AI returned no parts.');
  return parts;
}
