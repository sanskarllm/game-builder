// Full Game: Meta AI (Muse Wonder by default) writes a complete, playable
// browser game as one HTML file. The game can use this project's assets
// through window.FORGE: 3D models (.glb), 2D art, music and story.
import { llama, codeModel } from './ai.js';

export const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const IMPORTMAP = `<script type="importmap">{"imports":{"three":"${THREE_URL}build/three.module.js","three/addons/":"${THREE_URL}examples/jsm/"}}</script>`;

export const GENRES = ['3D adventure', '3D platformer', 'Top-down action', 'Side-scrolling platformer', 'Racing', 'Puzzle', 'Cooking / management', 'Tower defense', 'Survival', 'Endless runner', 'Visual novel with mini-games'];

// ---------- the prompt ----------
function systemPrompt(view) {
  return `You are Forge Coder, a senior game developer powered by Meta AI. You write complete, polished, bug-free browser games.
Reply with ONE complete HTML file and nothing else: start with <!DOCTYPE html> and end with </html>. No markdown fences, no explanations.

Technical rules:
- Everything lives in this one file: inline <style> and <script type="module">. No other files; no images, fonts or sounds to download.
- ${view === '2D'
    ? '2D with the Canvas 2D API, no libraries.'
    : '3D with three.js 0.160: import * as THREE from "three"; addons from "three/addons/…" (for example "three/addons/loaders/GLTFLoader.js"). An import map for these is added for you: do not write your own import map and do not load three.js any other way.'}
- The canvas fills the window and handles resize and devicePixelRatio. Use requestAnimationFrame with delta time (clamp big jumps).
- A title screen with the game's name, a one-line goal and the controls; a key press or click starts the game.
- Real gameplay: a clear goal, rising challenge, score and HUD, win and lose conditions, and a victory / game-over screen with restart (R). Pause with P or Escape.
- Keyboard (WASD / arrows + Space) and mouse controls; add simple on-screen touch buttons when 'ontouchstart' in window.
- Sound effects with the Web Audio API, creating the AudioContext on the first user input.
- Never use alert, prompt, confirm, localStorage, cookies or network requests. Guard risky code so one error cannot freeze the game.
- About 600–1500 lines of clean, commented code. Make it look good: a cohesive colour palette, ${view === '2D' ? 'readable sprites drawn with canvas shapes' : 'lighting and shadows'}, juicy feedback (particles, screen shake, easing).

This project's assets are ready in window.FORGE before your script runs:
- FORGE.models: [{name, cat, height}] 3D models (cat is Building, Human or Prop). await FORGE.loadModel(name) returns a new THREE.Group copy, in metres, Y up, standing on y = 0. Use them for the player, characters, buildings and props where they fit, and build everything else from primitives.
- FORGE.image(name) returns an image URL for a 2D character or background (use with new Image() or THREE.TextureLoader).
- FORGE.playMusic(name) / FORGE.stopMusic() play the project's soundtrack (call after the first user input). FORGE.music lists the track names.
- FORGE.story: {title, logline, characters: [{name, role, desc}]} for names and flavour text.
If an asset is missing or fails to load, fall back to primitives: a missing asset must never stop the game.`;
}

// What the model is told about the project (names only, no file data).
export function manifest(game, useAssets) {
  if (!useAssets) return 'Do not use FORGE assets for this game; build everything yourself.';
  const models = (game.assets3d || []).filter(a => a.glb || (a.parts || []).length);
  const lines = [
    `Story: "${game.title}"${game.logline ? ' — ' + game.logline : ''}`,
    'Characters: ' + ((game.characters || []).map(c => `${c.name} (${c.role || 'character'}: ${String(c.desc || '').slice(0, 90)})`).join('; ') || 'none'),
    '3D models: ' + (models.map(a => `"${a.name}" (${a.cat}${a.source === 'sam3d' ? ', scanned body mesh' : ''})`).join(', ') || 'none'),
    'Backgrounds (2D images): ' + ((game.backgrounds || []).map(b => `"${b.name}"`).join(', ') || 'none'),
    'Music: ' + ((game.music || []).map(m => `"${m.name}" (${m.mood || ''})`).join(', ') || 'none'),
  ];
  return lines.join('\n');
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

// Writes (or rewrites) the game. Long replies that get cut off are continued
// up to two times. onStage(text) reports progress.
export async function codeGame({ brief, genre, view, game, useAssets, current, change, error, onStage }) {
  const model = codeModel();
  const user = current
    ? `Here is the current game:\n\n${current}\n\n${error ? 'It shows this error while running:\n' + error + '\n\nFix the cause' : 'Change request: ' + change}\n\nKeep everything else that works. Reply with the complete updated HTML file.`
    : `Make this game.\nGenre: ${genre}. View: ${view}.\nGame idea: ${brief}\n\nProject assets:\n${manifest(game, useAssets)}`;
  const messages = [{ role: 'system', content: systemPrompt(view) }, { role: 'user', content: user }];
  onStage && onStage(`${model} is writing the game…`);
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
  if (!complete(out)) throw new Error(model + ' ran out of room before finishing the game. Try a smaller idea, or a 2D game.');
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
export async function forgeData(game, FP, exportGLB, useAssets) {
  const data = { title: game.title, story: { title: game.title, logline: game.logline || '', characters: (game.characters || []).map(c => ({ name: c.name, role: c.role, desc: c.desc })) }, models: [], images: {}, music: [] };
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
