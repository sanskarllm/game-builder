// 3D Novel: Meta AI (Muse Wonder by default) makes an interactive 3D story
// game as one HTML file: a world the player explores, where clicking on
// people, buildings and objects is how the story moves on. It has its own
// story; the 2D novel can be shared as inspiration. The project's 3D models
// (SAM 3D Body people included) are there for it to use.
import { llama, codeModel } from './ai.js';

export const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const IMPORTMAP = `<script type="importmap">{"imports":{"three":"${THREE_URL}build/three.module.js","three/addons/":"${THREE_URL}examples/jsm/"}}</script>`;

// ---------- what Muse Wonder is told ----------
// Two parts. STYLE_PROMPT is Game Forge's creative brief (the sandbox idea);
// in "My own prompt" the author writes their own in its place. TECH_PROMPT is
// the technical part (what it can use, how the file runs) and is always added
// out of sight, so the game works whatever the author writes.
export const STYLE_PROMPT = `You are making an interactive 3D story game for the browser, for Game Forge: a sandbox-style 3D world the player explores. The player moves the story on only by doing things in the world: clicking a person to talk to them, clicking the pan to cook, clicking a door to go to another room, picking up or using an object. What they choose to do is how they choose. The dialogue box is only for reading what people say: it has no choice buttons or menus. The story, the world, how it looks and plays, and how it is coded are up to you.`;

export const TECH_PROMPT = `What you can use (all optional):
- FORGE.models: [{ name, cat, height }] the author's 3D models (cat is Human, Building or Prop). await FORGE.loadModel(name) gives a new THREE.Group copy, in metres, standing on y = 0. Human models are scanned SAM 3D Body meshes (posed, untextured, facing +Z), good starting points for people that you can change however you like. FORGE.dressBody(group, { skin, hair, top, bottom, shoes, coat }) colours one by body region, if that helps.
- FORGE.story: the author's 2D visual novel, when they share it, as inspiration. Your 3D story does not have to follow it. Shape: { title, logline, start, characters: [{ name, role, desc, color, model }], locations: [{ name, desc }], scenes: [{ id, title, location, music, chars, lines: [{ who, text }], choices: [{ text, to }] }] }, or null.
- FORGE.image(name): the 2D art for a character or location, as a URL. FORGE.music lists soundtrack names; FORGE.playMusic(name) and FORGE.stopMusic() play them.

How it runs: reply with one complete HTML file, from <!DOCTYPE html> to </html>, and nothing else. It runs in a sandboxed iframe with an import map for three.js 0.160 ("three" and "three/addons/…") already added. There is no network, storage, cookies or alert/prompt/confirm in that sandbox.`;

export const DEFAULT_PROMPT = STYLE_PROMPT + '\n\n' + TECH_PROMPT;
// The full system prompt: the author's own creative prompt, or Game Forge's,
// followed by the technical part.
export const systemPrompt = own => ((own && own.trim()) ? own.trim() + '\n\n' + TECH_PROMPT : DEFAULT_PROMPT);

// The author's request plus a summary of what is available.
export function brief(game, { idea, useStory, useAssets, refs } = {}) {
  const models = useAssets === false ? [] : (game.assets3d || []).filter(a => a.glb || (a.parts || []).length);
  return [
    idea ? 'The author wants: ' + idea : `The author left the idea to you. The project is called "${game.title}".`,
    refs && refs.length ? `Attached: ${refs.length} reference image${refs.length > 1 ? 's' : ''} from the author, showing the kind of look they have in mind.` : '',
    'Their 3D models:\n' + (models.map(a => `- "${a.name}" (${a.cat}${a.source === 'sam3d' ? (a.kind === 'body' ? ', SAM 3D Body person' : ', SAM 3D Objects scan') : ', built from shapes'})`).join('\n') || '- none'),
    useStory ? `Their 2D novel is shared in FORGE.story: "${game.title}"${game.logline ? ': ' + game.logline : ''} (${(game.scenes || []).length} scenes; characters: ${(game.characters || []).map(c => c.name).join(', ') || 'none'}).` : 'No 2D novel is shared (FORGE.story is null).',
  ].filter(Boolean).join('\n\n');
}

// Each 2D character's 3D body (for FORGE.story when it is shared): the one
// chosen with model3d, else a Human model whose name starts with the name.
export function castOf(game) {
  const humans = (game.assets3d || []).filter(a => a.cat === 'Human' && (a.glb || (a.parts || []).length));
  return (game.characters || []).map(c => {
    const pick = c.model3d === '' ? null : humans.find(a => a.name === c.model3d) || humans.find(a => a.name.toLowerCase().startsWith(String(c.name).toLowerCase()));
    return { name: c.name, role: c.role, desc: c.desc, color: c.color, model: pick ? pick.name : null };
  });
}
export function extractHtml(text) {
  let t = String(text || '').trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.search(/<!doctype html|<html[\s>]/i);
  if (a > 0) t = t.slice(a);
  const b = t.toLowerCase().lastIndexOf('</html>');
  if (b >= 0) t = t.slice(0, b + 7);
  return t;
}
const complete = t => /<\/html>\s*$/i.test(t);

// Writes (or rewrites) the 3D novel. Long replies that get cut off are
// continued up to two times. onStage(text) reports progress.
// prompt: the author's own creative prompt ("My own prompt"); the technical
// part is added to it. Without one, Game Forge's prompt is used.
// refs: reference image data URLs, sent to the model with the request.
export async function codeGame({ idea, useStory, useAssets, refs, prompt, game, current, change, error, onStage }) {
  const model = codeModel();
  const facts = brief(game, { idea, useStory, useAssets, refs });
  const user = current
    ? `Here is the current game:\n\n${current}\n\n${error ? 'It shows this error while running:\n' + error + '\n\nFix the cause.' : 'The author asks: ' + change}\n\nReply with the complete updated HTML file.\n\nFor reference:\n${facts}`
    : facts;
  const content = refs && refs.length ? [{ type: 'text', text: user }, ...refs.map(url => ({ type: 'image_url', image_url: { url } }))] : user;
  const messages = [{ role: 'system', content: systemPrompt(prompt) }, { role: 'user', content }];
  onStage && onStage(`${model} is building the 3D novel…`);
  let r = await llama(messages, { model, maxTokens: 24000, temperature: 0.6, effort: 'medium', full: true });
  let out = extractHtml(r.text);
  for (let i = 0; i < 2 && !complete(out); i++) {
    onStage && onStage(`${model} is finishing the code (part ${i + 2})…`);
    messages.push({ role: 'assistant', content: out }, { role: 'user', content: 'Your reply was cut off. Continue exactly where you stopped. Output only the rest of the file, no repetition, no fences.' });
    r = await llama(messages, { model, maxTokens: 24000, temperature: 0.4, effort: 'low', full: true });
    out += String(r.text || '').replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '');
    out = extractHtml(out);
  }
  if (!/<script/i.test(out)) throw new Error(model + ' did not return a game (no code in the reply).');
  if (!complete(out)) throw new Error(model + ' ran out of room before finishing. Try again.');
  return { html: out, model };
}

// ---------- music (same tiny sequencer as the story player) ----------
// Kept self-contained so it can be copied into exported games as text.
function forgeSynth(ctx, dest, seq, st, until) {
  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const freq = n => { const m = String(n).match(/^([A-G][#b]?)(-?\d)$/); return m ? 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12) : 0; };
  const beat = 60 / Math.max(40, Math.min(200, seq.bpm || 90));
  const wave = ['sine', 'square', 'triangle', 'sawtooth'].includes(seq.wave) ? seq.wave : 'triangle';
  const tone = (f, start, dur, type, vol) => {
    if (!f) return; const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.02); g.gain.exponentialRampToValueAtTime(0.001, start + dur * 0.95);
    o.connect(g); g.connect(dest); o.start(start); o.stop(start + dur);
  };
  while (st.t < until && seq.notes && seq.notes.length) {
    const [n, beats] = seq.notes[st.idx % seq.notes.length]; const dur = beat * (Number(beats) || 1);
    if (n !== 'rest') tone(freq(n), st.t, dur, wave, 0.9);
    if (seq.bass && seq.bass.length && st.inBar === 0) tone(freq(seq.bass[st.bar % seq.bass.length]), st.t, beat * 4, 'sine', 0.7);
    st.inBar += Number(beats) || 1; if (st.inBar >= 4) { st.inBar = 0; st.bar++; }
    st.t += dur; st.idx++;
  }
  return st;
}
export { forgeSynth };
export const trackSeq = (t, FP) => (t.notes && t.notes.length ? { bpm: t.bpm || 90, wave: t.wave || 'triangle', notes: t.notes, bass: t.bass || [] } : FP.proceduralTrack(t));

// ---------- assets handed to the game ----------
// exportGLB(asset) → Blob. Every 3D model goes in as a .glb data URL.
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const PALETTE = ['#9184d9', '#d0618a', '#5aa6a0', '#d8a657', '#7aa2f7', '#c678dd'];
export async function forgeData(game, FP, exportGLB, useAssets, useStory) {
  const scenes = (game.scenes || []).map(s => ({ id: s.id, title: s.title, location: s.bg, music: s.music || '', transition: s.transition || 'Fade',
    chars: (s.chars || []).map(c => ({ name: c.name, expr: c.expr || 'neutral', pos: c.pos || 'C' })), lines: (s.lines || []).map(l => ({ who: l.who, text: l.text })), choices: (s.choices || []).map(c => ({ text: c.text, to: c.to })) }));
  const story = { title: game.title, logline: game.logline || '', start: scenes[0] ? scenes[0].id : null,
    characters: castOf(game).map(c => ({ ...c, color: c.color || PALETTE[[...String(c.name)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length], model: useAssets ? c.model : null })),
    locations: (game.backgrounds || []).map(b => ({ name: b.name, desc: b.desc || b.name })), scenes };
  const data = { title: game.title, story: useStory ? story : null, models: [], images: {}, music: [] };
  if (!useAssets) return data;
  for (const a of game.assets3d || []) {
    if (a.busy || !(a.glb || (a.parts || []).length)) continue;
    try {
      const sam = a.source === 'sam3d';
      data.models.push({ name: a.name, cat: a.cat, height: sam ? a.height || { Building: 6, Human: 1.75, Prop: 0.6 }[a.cat] || 1 : null, fix: sam ? a.fix || [0, 0, 0] : [0, 0, 0],
        url: sam ? a.glb : await blobToDataUrl(await exportGLB(a)) });
    } catch (e) { /* skip a model that cannot be exported */ }
  }
  for (const c of game.characters || []) data.images[c.name] = FP.charUrl(game, c.name);
  for (const b of game.backgrounds || []) data.images[b.name] = FP.bgUrl(game, b.name);
  data.music = (game.music || []).map(t => (t.src ? { name: t.name, src: t.src } : { name: t.name, seq: trackSeq(t, FP) }));
  return data;
}

// The FORGE runtime, inlined before the game's own code.
function runtime() {
  const F = window.FORGE; const cache = {};
  const find = (list, name) => list.find(x => x.name === name) || list.find(x => String(x.name).toLowerCase() === String(name).toLowerCase());
  F.loadModel = async function (name) {
    const m = find(F.models, name); if (!m) throw new Error('No 3D model named "' + name + '" in this project.');
    if (!cache[m.name]) cache[m.name] = (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(m.url);
      const inner = gltf.scene, D = Math.PI / 180, f = m.fix || [0, 0, 0];
      inner.rotation.set(f[0] * D, f[1] * D, f[2] * D);
      const g = new THREE.Group(); g.name = m.name; g.add(inner); g.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(g);
      if (m.height) { const s = box.getSize(new THREE.Vector3()); inner.scale.setScalar(m.height / Math.max(s.y, 1e-6)); g.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(g); }
      const c = box.getCenter(new THREE.Vector3());
      inner.position.set(inner.position.x - c.x, inner.position.y - box.min.y, inner.position.z - c.z);
      g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      return g;
    })();
    return (await cache[m.name]).clone(true);
  };
  // Dress a SAM 3D Body mesh as a character: vertex colours by body region,
  // so the real body shape stays visible. Call right after loadModel, before
  // moving or rotating it (the body faces +Z).
  F.dressBody = function (obj, o) {
    o = o || {};
    const hex = (c, d) => { const s = String(c || d).replace('#', ''); const n = parseInt(s.length === 3 ? s.replace(/./g, ch => ch + ch) : s, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
    const C = { skin: hex(o.skin, '#d9a989'), hair: hex(o.hair, '#3b2a20'), top: hex(o.top, '#5b6ee1'), bottom: hex(o.bottom, '#34374a'), shoes: hex(o.shoes, '#22232b') };
    const coatTo = o.coat ? 0.3 : 0.5;
    obj.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity, sx = 0, sz = 0, n = 0;
    const meshes = []; obj.traverse(m => { if (m.isMesh && m.geometry && m.geometry.attributes.position) meshes.push(m); });
    const world = (m, i, out) => { const p = m.geometry.attributes.position, e = m.matrixWorld.elements, x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      out[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[2] = e[2] * x + e[6] * y + e[10] * z + e[14]; return out; };
    const v = [0, 0, 0];
    for (const m of meshes) for (let i = 0; i < m.geometry.attributes.position.count; i++) { world(m, i, v); minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]); sx += v[0]; sz += v[2]; n++; }
    if (!n) return obj;
    const H = Math.max(maxY - minY, 1e-6), cx = sx / n, cz = sz / n;
    for (const m of meshes) {
      const count = m.geometry.attributes.position.count, col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        world(m, i, v); const t = (v[1] - minY) / H, r = Math.hypot(v[0] - cx, v[2] - cz) / H;
        let c = C.shoes;
        if (t >= 0.94) c = C.hair;
        else if (t >= 0.87) c = v[2] > cz ? C.skin : C.hair;
        else if (t >= 0.82) c = C.skin;
        else if (r > 0.3 && t > 0.45) c = C.skin; // hands at the end of outstretched arms
        else if (t >= coatTo) c = C.top;
        else if (t >= 0.06) c = C.bottom;
        col.set(c, i * 3);
      }
      m.geometry = m.geometry.clone(); m.geometry.setAttribute('color', new m.geometry.attributes.position.constructor(col, 3));
      m.material = m.material.clone(); m.material.vertexColors = true; if ('color' in m.material) m.material.color.setRGB(1, 1, 1);
      if ('roughness' in m.material) m.material.roughness = 0.75; if ('metalness' in m.material) m.material.metalness = 0;
      m.geometry.computeVertexNormals && m.geometry.computeVertexNormals();
    }
    return obj;
  };
  F.image = name => F.images[name] || F.images[Object.keys(F.images).find(k => k.toLowerCase() === String(name).toLowerCase())] || null;
  let ctx, timer, master, audio;
  F.stopMusic = () => { clearInterval(timer); timer = null; if (master) { try { master.disconnect(); } catch (e) { /* gone */ } master = null; } if (audio) { audio.pause(); audio = null; } };
  F.playMusic = (name, volume) => {
    F.stopMusic(); const t = find(F.tracks, name || (F.tracks[0] && F.tracks[0].name)); if (!t) return;
    if (t.src) { audio = new Audio(t.src); audio.loop = true; audio.volume = volume == null ? 0.5 : volume; audio.play().catch(() => {}); return; }
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    if (ctx.state === 'suspended') ctx.resume();
    master = ctx.createGain(); master.gain.value = 0.12 * (volume == null ? 1 : volume * 2); master.connect(ctx.destination);
    const st = { t: ctx.currentTime + 0.05, idx: 0, bar: 0, inBar: 0 };
    const tick = () => F._synth(ctx, master, t.seq, st, ctx.currentTime + 0.6);
    tick(); timer = setInterval(tick, 200);
  };
  F.tracks = F.music; F.music = F.tracks.map(t => t.name);
}
const errorHook = `window.addEventListener('error',function(e){try{parent.postMessage({forgeError:(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')},'*')}catch(x){}});window.addEventListener('unhandledrejection',function(e){try{parent.postMessage({forgeError:'Unhandled: '+((e.reason&&(e.reason.stack||e.reason.message))||e.reason)},'*')}catch(x){}});`;

// The game's HTML + import map + FORGE data and runtime → one runnable page.
export function assemble(html, data) {
  const body = String(html).replace(/<script[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const head = `${IMPORTMAP}<script>${errorHook}window.FORGE=${json};window.FORGE._synth=${forgeSynth.toString()};(${runtime.toString()})();<\/script>`;
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, m => m + head);
  if (/<html[^>]*>/i.test(body)) return body.replace(/<html[^>]*>/i, m => m + '<head>' + head + '</head>');
  return '<!DOCTYPE html><html><head>' + head + '</head><body>' + body + '</body></html>';
}
