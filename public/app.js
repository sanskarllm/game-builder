// Game Forge — editor UI (Preact + htm, no build step).
import { html, render, useState, useEffect, useRef, useMemo } from 'htm/preact';
import * as AI from './ai.js';
import * as Coder from './coder.js';
import { SAMPLE_GAME, SAMPLE_3D } from './sample.js';

const FP = window.ForgePlayer;
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 8);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = s => String(s || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'game';
const nextSceneId = scenes => 's' + (Math.max(0, ...scenes.map(s => parseInt(String(s.id).replace(/\D/g, ''), 10) || 0)) + 1);
const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

// SAM 3D meshes are megabytes each — too big for localStorage — so they are
// kept in IndexedDB and the autosaved project only stores their glbId.
const blobs = (() => {
  let db;
  const open = () => db || (db = new Promise((res, rej) => { const r = indexedDB.open('gameforge', 1); r.onupgradeneeded = () => r.result.createObjectStore('glb'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('glb', mode); const q = fn(t.objectStore('glb')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const saved = new Set();
  return {
    get: k => tx('readonly', s => s.get(k)).catch(() => null),
    put: (k, v) => { if (saved.has(k)) return; saved.add(k); tx('readwrite', s => s.put(v, k)).catch(() => saved.delete(k)); },
  };
})();
function persist(game) {
  const assets3d = (game.assets3d || []).map(a => { if (!a.glb) return a; blobs.put(a.glbId, a.glb); const { glb, ...rest } = a; return rest; });
  return store.set('gf.project', { ...game, assets3d });
}
// Draw any image URL (SVG included) onto a transparent canvas → PNG data URL.
function toPng(url, w = 512, h = 1024) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); const s = Math.min(w / img.width, h / img.height) || 1; c.width = Math.round(img.width * s) || w; c.height = Math.round(img.height * s) || h; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); };
    img.onerror = () => rej(new Error('Could not read the image.')); img.src = url;
  });
}

function initialGame() {
  const g = store.get('gf.project', null);
  if (g && Array.isArray(g.scenes) && g.scenes.length) {
    if (!g.assets3d) g.assets3d = clone(SAMPLE_3D);
    [g.characters, g.backgrounds, g.music, g.assets3d].forEach(list => (list || []).forEach(x => delete x.busy));
    return g;
  }
  return { ...clone(SAMPLE_GAME), assets3d: clone(SAMPLE_3D) };
}

// An empty project: one scene, one backdrop, nothing else.
function blankGame() {
  return {
    title: 'Untitled Game', logline: '', characters: [], music: [], assets3d: [],
    backgrounds: [{ name: 'Backdrop', desc: 'Simple evening backdrop' }],
    scenes: [{ id: 's1', title: 'Scene 1', x: 0, y: 60, bg: 'Backdrop', music: '', transition: 'Fade', chars: [],
      lines: [{ who: 'Narrator', text: 'Your story starts here. Write it in the Edit panel, or ask Forge Assistant.' }], choices: [] }],
  };
}

const TABS = {
  build: [['characters', 'Characters', 'ph-user'], ['backgrounds', 'Backgrounds', 'ph-image'], ['music', 'Music', 'ph-music-notes']],
  '3d': [['Building', 'Buildings', 'ph-house'], ['Human', 'Humans', 'ph-person'], ['Prop', 'Props', 'ph-lamp']],
};
const MODES = [
  ['build', '2D Novel', 'ph-book-open-text', 'Write the story · 2D scenes'],
  ['3d', '3D Assets', 'ph-cube', 'Houses, people, props'],
  ['code', '3D Novel', 'ph-cube-focus', 'Explore and click through a 3D story'],
  ['play', 'Play & Polish', 'ph-play-circle', 'Playtest with Forge Assistant'],
];
const ICON3D = { Building: 'ph-house', Human: 'ph-person', Prop: 'ph-lamp' };
const SAM_LABEL = { body: 'SAM 3D Body', objects: 'SAM 3D Objects' };
const samLabel = a => SAM_LABEL[a.kind || 'objects'];

// ======================================================================
function App() {
  const [game, setGame] = useState(initialGame);
  const [mode, setMode] = useState('build');
  const [tab, setTab] = useState('characters');
  const [sel, setSel] = useState(() => (initialGame().scenes[0] || {}).id);
  const [sel3d, setSel3d] = useState('Fisherman House');
  const [right, setRight] = useState('edit');
  const [settings, setSettings] = useState(() => store.get('gf.settings', { provider: 'muse', baseUrl: AI.PROVIDERS[0].baseUrl, model: AI.PROVIDERS[0].model, apiKey: '' }));
  const [server, setServer] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [messages, setMessages] = useState([{ me: false, text: 'Hi! I am Forge Assistant, running on Meta AI. Ask me to brainstorm, review your story, or change the game directly — e.g. "add a twist where the mentor is secretly working with the villain".' }]);
  const [dialog, setDialog] = useState(null); // 'new' | {create: type} | 'play'
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState(null);
  const [building, setBuilding] = useState(null);
  const [style3d, setStyle3d] = useState('Low-poly stylized');
  const undoStack = useRef([]);
  const gameRef = useRef(game); gameRef.current = game;
  const [undoCount, setUndoCount] = useState(0);

  useEffect(() => { AI.setLlamaSettings(settings); store.set('gf.settings', settings); }, [settings]);
  useEffect(() => { fetch('/api/status').then(r => r.json()).then(setServer).catch(() => setServer({ offline: true })); }, []);
  const saveWarned = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { if (!persist(game) && !saveWarned.current) { saveWarned.current = true; notify('Project is too large to autosave in the browser — click Save to keep it in a file.', true); } }, 400);
    return () => clearTimeout(t);
  }, [game]);
  useEffect(() => { if (!game.scenes.some(s => s.id === sel) && game.scenes[0]) setSel(game.scenes[0].id); }, [game, sel]);
  useEffect(() => { if (mode !== 'play') FP.music.stop(); }, [mode]);
  useEffect(() => {
    for (const a of game.assets3d) if (a.glbId && !a.glb) blobs.get(a.glbId).then(glb => glb && setGame(g => ({ ...g, assets3d: g.assets3d.map(x => x.glbId === a.glbId ? { ...x, glb } : x) })));
  }, []);

  function notify(text, err) { setToast({ text, err }); clearTimeout(notify.t); notify.t = setTimeout(() => setToast(null), err ? 6000 : 2600); }
  function snapshot() { undoStack.current.push(JSON.stringify(game)); if (undoStack.current.length > 40) undoStack.current.shift(); setUndoCount(undoStack.current.length); }
  // update(fn, true) records an undo step first.
  function update(fn, undo) {
    setGame(prev => {
      if (undo) { undoStack.current.push(JSON.stringify(prev)); if (undoStack.current.length > 40) undoStack.current.shift(); setUndoCount(undoStack.current.length); }
      return fn(clone(prev));
    });
  }
  function undo() { const s = undoStack.current.pop(); if (s) { setGame(JSON.parse(s)); setUndoCount(undoStack.current.length); notify('Undone'); } }
  const updScene = (fn, u) => update(g => { const s = g.scenes.find(x => x.id === sel); if (s) fn(s, g); return g; }, u);

  const aiReady = settings.provider === 'ollama' || !!settings.apiKey || !!(server && server.hasServerKey && server.baseUrl === settings.baseUrl.replace(/\/+$/, ''));
  function ensureAI() {
    if (aiReady) return true;
    setRight('settings'); notify('Add your Meta AI API key in the Meta AI tab first (or put MODEL_API_KEY in .env).', true); return false;
  }

  async function runJob(name, fn) {
    const id = uid(); setJobs(j => [{ id, name, status: 'running' }, ...j].slice(0, 12));
    try { const r = await fn(); setJobs(j => j.map(x => x.id === id ? { ...x, status: 'done' } : x)); return r; }
    catch (e) { setJobs(j => j.map(x => x.id === id ? { ...x, status: 'error', err: e.message } : x)); notify(name + ' failed: ' + e.message, true); throw e; }
  }

  // ---- AI actions ----
  const mark = (list, name, busy) => update(g => { const x = g[list].find(x => x.name === name); if (x) { if (busy) x.busy = true; else delete x.busy; } return g; });
  async function paintBg(name, desc) {
    if (!ensureAI()) return;
    const b = gameRef.current.backgrounds.find(x => x.name === name); desc = desc != null ? desc : b && b.desc;
    mark('backgrounds', name, true);
    try {
      const svg = await runJob('Paint background · ' + name, () => AI.paintBackground(name, desc));
      update(g => { const x = g.backgrounds.find(x => x.name === name); if (x) { x.svg = svg; delete x.img; delete x.busy; } return g; }, true);
    } catch (e) { mark('backgrounds', name, false); }
  }
  async function paintChar(name, desc) {
    if (!ensureAI()) return;
    const c = gameRef.current.characters.find(x => x.name === name); desc = desc != null ? desc : c && c.desc;
    mark('characters', name, true);
    try {
      const svg = await runJob('Draw character · ' + name, () => AI.paintCharacter(name, desc));
      update(g => { const x = g.characters.find(x => x.name === name); if (x) { x.svg = svg; delete x.img; delete x.busy; } return g; }, true);
    } catch (e) { mark('characters', name, false); }
  }
  async function compose(name, mood) {
    if (!ensureAI()) return;
    const m = gameRef.current.music.find(x => x.name === name); mood = mood != null ? mood : m && m.mood;
    mark('music', name, true);
    try {
      const seq = await runJob('Compose · ' + name, () => AI.composeMusic(name, mood));
      update(g => { const x = g.music.find(x => x.name === name); if (x) { Object.assign(x, seq); delete x.src; delete x.busy; } return g; }, true);
      FP.music.stop(); FP.music.play({ music: [{ name, ...seq }] }, name);
    } catch (e) { mark('music', name, false); }
  }
  async function make3d(asset) {
    if (!ensureAI()) return;
    update(g => { const a = g.assets3d.find(x => x.name === asset.name); if (a) a.busy = true; else g.assets3d.unshift({ ...asset, parts: [], busy: true }); return g; });
    setSel3d(asset.name);
    try {
      const parts = await runJob('Model 3D · ' + asset.name, () => AI.model3d({ ...asset, style: style3d, budget: asset.budget || 24 }));
      update(g => { const a = g.assets3d.find(x => x.name === asset.name); if (a) { a.parts = parts; a.prompt = asset.prompt; a.style = style3d; delete a.busy; } return g; }, true);
    } catch (e) { mark('assets3d', asset.name, false); }
  }
  // Image → 3D mesh with Meta's SAM 3D Body (people) or SAM 3D Objects
  // (anything), served by ./sam3d-service.
  const sam3dReady = !!(settings.sam3dUrl || (server && server.sam3dUrl));
  // stay: keep the current view (the 3D Novel cast list scans from there).
  async function makeFromImage({ name, cat, image, mask, textured, kind = 'body', stay, forChar }) {
    if (!sam3dReady) { setRight('settings'); notify('Add your SAM 3D service URL in the Meta AI tab first.', true); return; }
    if (!stay) { setMode('3d'); setTab(cat); setRight('edit'); }
    if (forChar) update(g => { const c = g.characters.find(x => x.name === forChar); if (c) c.model3d = name; return g; });
    update(g => { g.assets3d = g.assets3d.filter(x => x.name !== name); g.assets3d.unshift({ name, cat, prompt: 'Reconstructed from an image', parts: [], source: 'sam3d', kind, busy: true }); return g; });
    setSel3d(name);
    try {
      const r = await runJob(SAM_LABEL[kind] + ' · ' + name, () => AI.sam3d({ image, mask, textured, kind }));
      update(g => { const a = g.assets3d.find(x => x.name === name); if (a) { a.glb = r.glb; a.glbId = 'glb_' + uid() + uid(); a.pose = r.pose; delete a.busy; } return g; }, true);
      notify(SAM_LABEL[kind] + ' built ' + name + (r.seconds ? ' in ' + r.seconds + ' s' : ''));
    } catch (e) { mark('assets3d', name, false); }
  }
  async function buildGame(opts) {
    if (!ensureAI()) return;
    setDialog(null); setBuilding('Meta AI is writing your game…'); setMode('build');
    try {
      const ng = await runJob('Write game · ' + opts.idea.slice(0, 40), () => AI.buildGame(opts.idea, opts));
      ng.assets3d = game.assets3d; if (game.code) ng.code = game.code;
      snapshot(); setGame(ng); setSel(ng.scenes[0].id); setRight('edit');
      notify(`“${ng.title}” — ${ng.scenes.length} scenes written by Meta AI`);
      if (opts.paint) {
        for (const b of ng.backgrounds) {
          setBuilding('Painting ' + b.name + '…');
          try { const svg = await runJob('Paint background · ' + b.name, () => AI.paintBackground(b.name, b.desc)); update(g => { const x = g.backgrounds.find(x => x.name === b.name); if (x) x.svg = svg; return g; }); } catch (e) { /* keep placeholder */ }
        }
        for (const c of ng.characters) {
          setBuilding('Drawing ' + c.name + '…');
          try { const svg = await runJob('Draw character · ' + c.name, () => AI.paintCharacter(c.name, c.desc)); update(g => { const x = g.characters.find(x => x.name === c.name); if (x) x.svg = svg; return g; }); } catch (e) { /* keep placeholder */ }
        }
      }
    } catch (e) { /* toast already shown */ }
    setBuilding(null);
  }

  // ---- export ----
  async function storyPage(g) {
    const js = await (await fetch('player.js')).text();
    const data = JSON.stringify({ ...g, assets3d: undefined, code: undefined }).replace(/</g, '\\u003c');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${g.title.replace(/</g, '')}</title><style>html,body{margin:0;height:100%;background:#05060c;display:grid;place-items:center}#game{width:min(100vw,177.78vh);aspect-ratio:16/9}</style></head><body><div id="game"></div><script>${js}<\/script><script>ForgePlayer.boot(document.getElementById('game'),${data});<\/script></body></html>`;
  }
  async function exportGame() {
    setMenu(false);
    download(slug(game.title) + '.html', new Blob([await storyPage(game)], { type: 'text/html' }));
    notify('Saved the 2D novel: ' + slug(game.title) + '.html');
  }
  // The coded game + this project's assets, as one page (played in the
  // 3D Novel view and saved as a standalone .html).
  async function fullGamePage(g) {
    const V = await import('./viewer3d.js');
    const data = await Coder.forgeData(g, FP, a => V.exportGLB(a), g.code.useAssets !== false, !!g.code.useStory);
    return Coder.assemble(g.code.html, data);
  }
  async function exportFullGame() {
    setMenu(false);
    const g = gameRef.current;
    if (!g.code || !g.code.html) { setMode('code'); setRight('edit'); return notify('No 3D novel yet: open 3D Novel and build one with Meta AI.', true); }
    try { download(slug(g.title) + '-3d.html', new Blob([await fullGamePage(g)], { type: 'text/html' })); notify('Saved the 3D novel: ' + slug(g.title) + '-3d.html'); }
    catch (e) { notify('Could not save the 3D novel: ' + e.message, true); }
  }
  // Every asset in standard formats (.glb, .svg/.png, .wav), zipped for 3D software.
  async function exportPack() {
    setMenu(false);
    const g = gameRef.current;
    try {
      const [V, Pack] = await Promise.all([import('./viewer3d.js'), import('./pack.js')]);
      const { blob, counts } = await runJob('Asset pack', async () => Pack.assetPack(g, FP, {
        exportGLB: a => V.exportGLB(a), storyHtml: await storyPage(g), codeHtml: g.code && g.code.html ? await fullGamePage(g) : null,
        project: JSON.stringify(g, null, 1), onStage: s => setBuilding('Asset pack · ' + s),
      }));
      download(slug(g.title) + '-assets.zip', blob);
      notify(`Saved ${slug(g.title)}-assets.zip · ${counts.models} 3D models, ${counts.characters + counts.backgrounds} images, ${counts.music} tracks`);
    } catch (e) { /* toast shown */ }
    setBuilding(null);
  }
  // ---- 3D Novel: Meta AI (Muse Wonder) builds the story as a 3D visual novel ----
  const [coding, setCoding] = useState(null); // progress text while Meta AI writes
  async function codeGame(opts) {
    if (!ensureAI() || coding) return;
    const g = gameRef.current, cur = g.code || {};
    const pick = (k, d) => (opts[k] != null ? opts[k] : cur[k] != null ? cur[k] : d);
    const spec = { idea: pick('idea', ''), useStory: pick('useStory', false), useAssets: pick('useAssets', true), refs: pick('refs', []), promptMode: pick('promptMode', 'forge'), customPrompt: pick('customPrompt', '') };
    const revise = !!(opts.change || opts.error) && !!cur.html;
    setCoding('Starting…'); setMode('code');
    try {
      const r = await runJob('3D novel · ' + (opts.error ? 'fix error' : revise ? 'change' : (spec.idea || g.title).slice(0, 36)), () => Coder.codeGame({ ...spec, prompt: spec.promptMode === 'own' ? spec.customPrompt : null, game: g, current: revise ? cur.html : null, change: opts.change, error: opts.error, onStage: setCoding }));
      update(x => { x.code = { ...spec, kind: 'novel3d', html: r.html, model: r.model, at: Date.now(), changes: revise ? [...(cur.changes || []), opts.error ? 'Fixed: ' + opts.error.slice(0, 80) : opts.change].slice(-12) : [] }; return x; }, true);
      notify((revise ? '3D novel updated by ' : '3D novel built by ') + r.model + ' — Undo goes back');
    } catch (e) { /* toast shown */ }
    setCoding(null);
  }
  // ---- project file: Save (Ctrl+S), Save as (Ctrl+Shift+S), Open (Ctrl+O) ----
  // In Chrome/Edge the first save asks where to put the file and later saves
  // write straight to it. Other browsers save a copy to Downloads each time.
  const canWriteFiles = 'showSaveFilePicker' in window;
  const fileHandle = useRef(null);
  const savedGame = useRef(null);
  const [saveInfo, setSaveInfo] = useState(null); // { name, at }
  const dirty = savedGame.current !== game;
  const PROJECT_TYPES = [{ description: 'Game Forge project', accept: { 'application/json': ['.json'] } }];
  function markSaved(name, g) { savedGame.current = g; setSaveInfo({ name, at: Date.now() }); }
  // Returns true once the file is written (false if cancelled or failed).
  async function saveProject(as) {
    setMenu(false);
    const g = gameRef.current, data = JSON.stringify(g, null, 1), name = slug(g.title) + '.gameforge.json';
    if (!canWriteFiles) { download(name, new Blob([data], { type: 'application/json' })); markSaved(name, g); notify('Saved ' + name + ' to your Downloads'); return true; }
    try {
      const h = (!as && fileHandle.current) || await window.showSaveFilePicker({ suggestedName: name, types: PROJECT_TYPES });
      const w = await h.createWritable(); await w.write(data); await w.close();
      fileHandle.current = h; markSaved(h.name, g); notify('Saved ' + h.name);
      return true;
    } catch (e) { if (e.name !== 'AbortError') notify('Could not save: ' + e.message, true); return false; }
  }
  function parseProject(text) {
    let raw, g; try { raw = JSON.parse(text); g = AI.normalizeGame(raw); } catch (e) { throw new Error('That file is not a Game Forge project.'); }
    if (!g.scenes.length) throw new Error('That file is not a Game Forge project.');
    if (!raw.assets3d) g.assets3d = clone(SAMPLE_3D); // older projects had no 3D library
    if (raw.code && typeof raw.code.html === 'string') g.code = raw.code; // 3D Novel code
    return g;
  }
  // ---- New project: a blank game. Asks to save first if there is unsaved work.
  const hasUnsavedWork = dirty && !!(saveInfo || game.scenes.some(s => s.lines.length));
  function startNewProject() {
    const g = blankGame();
    snapshot(); // Undo brings the previous project back
    setGame(g); setSel(g.scenes[0].id); setMode('build'); setTab('characters'); setRight('edit');
    fileHandle.current = null; savedGame.current = g; setSaveInfo(null); setDialog(null); // untouched blank = nothing to lose
    notify('New project — name it in the top bar. Undo brings back the previous one.');
  }
  function newProject() { setMenu(false); if (hasUnsavedWork) setDialog('newproj'); else startNewProject(); }
  function loadProject(g, handle, name) { snapshot(); setGame(g); setSel(g.scenes[0].id); fileHandle.current = handle; markSaved(name, g); notify('Opened ' + name); }
  async function openProject() {
    setMenu(false);
    if (!('showOpenFilePicker' in window)) return importRef.current.click();
    try { const [h] = await window.showOpenFilePicker({ types: PROJECT_TYPES }); loadProject(parseProject(await (await h.getFile()).text()), h, h.name); }
    catch (e) { if (e.name !== 'AbortError') notify(e.message, true); }
  }
  const importRef = useRef();
  async function importProject(e) {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { loadProject(parseProject(await f.text()), null, f.name); } catch (err) { notify(err.message, true); }
  }
  const keys = useRef(); keys.current = { saveProject, openProject };
  useEffect(() => {
    const k = e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); keys.current.saveProject(e.shiftKey); }
      else if (key === 'o') { e.preventDefault(); keys.current.openProject(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const saveLabel = !saveInfo ? 'Not saved to a file yet' : dirty ? 'Unsaved changes' : 'Saved ' + new Date(saveInfo.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const cur = game.scenes.find(s => s.id === sel) || game.scenes[0];
  const ctx = { game, setGame, update, updScene, snapshot, cur, sel, setSel, mode, setMode, tab, setTab, right, setRight, settings, setSettings, server, jobs, messages, setMessages, setDialog, notify, aiReady, ensureAI, runJob, paintBg, paintChar, compose, make3d, makeFromImage, sam3dReady, sel3d, setSel3d, style3d, setStyle3d, undo, undoCount, building, coding, codeGame, fullGamePage, exportFullGame };
  const prov = AI.PROVIDERS.find(p => p.id === settings.provider) || AI.PROVIDERS[0];
  const busyJobs = jobs.filter(j => j.status === 'running').length;

  return html`<div class="app">
    <header class="header">
      <div class="brand"><i class="ph ph-sparkle" style="color:var(--color-accent);font-size:18px"></i>Game Forge</div>
      <div class="vsep"></div>
      <input class="title-input" value=${game.title} onFocus=${snapshot} onInput=${e => update(g => { g.title = e.target.value; return g; })} title="Game title" />
      <span class="tag tag-neutral">${MODES.find(m => m[0] === mode)[1]}</span>
      <span class=${'save-state' + (saveInfo && !dirty ? ' clean' : '')} title=${saveInfo ? saveInfo.name : 'Your work also autosaves in this browser'}>${saveLabel}</span>
      <div style="flex:1"></div>
      <button class="status" onClick=${() => setRight('settings')} title="Meta AI connection">
        <span class=${'dot ' + (busyJobs ? 'busy' : aiReady ? 'on' : '')}></span>
        ${busyJobs ? `Meta AI working · ${busyJobs}` : aiReady ? `Meta AI · ${settings.model.replace(/^meta-llama\//, '').split('-').slice(0, 3).join('-')}` : 'Meta AI · add API key'}
      </button>
      <button class="btn btn-secondary btn-icon" title="Undo" disabled=${!undoCount} onClick=${undo}><i class="ph ph-arrow-u-up-left"></i></button>
      <button class="btn btn-solid" onClick=${() => setDialog('new')}><i class="ph ph-magic-wand"></i>New game with Meta AI</button>
      <button class="btn btn-secondary" onClick=${() => setDialog('play')}><i class="ph ph-play"></i>Play build</button>
      <button class="btn btn-secondary" onClick=${newProject} title="Start a new, empty project"><i class="ph ph-file-plus"></i>New project</button>
      <div class="split" style="position:relative">
        <button class="btn btn-secondary" onClick=${() => saveProject(false)} title=${'Save project (Ctrl+S)' + (saveInfo ? ' · ' + saveInfo.name : '')}><i class="ph ph-floppy-disk"></i>Save</button>
        <button class="btn btn-secondary split-caret" title="More save options" aria-label="More save options" onClick=${() => setMenu(!menu)}><i class="ph ph-caret-down"></i></button>
        ${menu && html`<div class="menu" onMouseLeave=${() => setMenu(false)}>
          <button onClick=${() => saveProject(false)}><i class="ph ph-floppy-disk"></i>Save project <span class="kbd">Ctrl+S</span></button>
          <button onClick=${() => saveProject(true)}><i class="ph ph-copy"></i>Save project as… <span class="kbd">Ctrl+Shift+S</span></button>
          <button onClick=${exportGame}><i class="ph ph-globe"></i>Save 2D novel (.html)</button>
          <button onClick=${exportFullGame} disabled=${!(game.code && game.code.html)} title=${game.code && game.code.html ? 'The 3D novel Meta AI built' : 'Build one in 3D Novel first'}><i class="ph ph-cube-focus"></i>Save 3D novel (.html)</button>
          <button onClick=${exportPack} title="Every asset as .glb, .svg/.png and .wav for Blender, Unity, Godot or Unreal"><i class="ph ph-package"></i>Export asset pack (.zip)</button>
          <button onClick=${() => { setMenu(false); if (confirm('Replace the current project with the sample game?')) { snapshot(); setGame({ ...clone(SAMPLE_GAME), assets3d: clone(SAMPLE_3D) }); setSel('s1'); } }}><i class="ph ph-arrow-counter-clockwise"></i>Reset to sample game</button>
        </div>`}
      </div>
      <button class="btn btn-primary" onClick=${openProject} title="Open a saved project (Ctrl+O)"><i class="ph ph-folder-open"></i>Open</button>
      <input type="file" accept=".json,application/json" ref=${importRef} onChange=${importProject} style="display:none" />
    </header>
    <div class="cols">
      <${Sidebar} ...${ctx} />
      <${Main} ...${ctx} />
      <${RightPanel} ...${ctx} prov=${prov} />
    </div>
    ${dialog === 'new' && html`<${NewGameDialog} onClose=${() => setDialog(null)} onBuild=${buildGame} aiReady=${aiReady} goSettings=${() => { setDialog(null); setRight('settings'); }} />`}
    ${dialog && dialog.create && html`<${CreateDialog} ...${ctx} type=${dialog.create} fromImage=${dialog.fromImage} only=${dialog.only} onClose=${() => setDialog(null)} />`}
    ${dialog === 'newproj' && html`<div class="backdrop" onClick=${() => setDialog(null)}><div class="dialog" style="width:420px" onClick=${e => e.stopPropagation()}>
      <div class="row"><i class="ph ph-file-plus" style="color:var(--color-accent);font-size:18px"></i><span class="dialog-title">Start a new project?</span></div>
      <span style="font-size:13px;color:var(--color-neutral-300)">“${game.title}” has unsaved changes. Save it first?</span>
      <div class="dialog-actions">
        <button class="btn btn-secondary" onClick=${() => setDialog(null)}>Cancel</button>
        <button class="btn btn-secondary" onClick=${startNewProject}>Don’t save</button>
        <button class="btn btn-solid" onClick=${async () => { if (await saveProject(false)) startNewProject(); }}><i class="ph ph-floppy-disk"></i>Save and continue</button>
      </div>
    </div></div>`}
    ${dialog === 'play' && html`<${PlayerOverlay} game=${game} onClose=${() => { FP.music.stop(); setDialog(null); }} />`}
    ${toast && html`<div class=${'toast' + (toast.err ? ' err' : '')}>${toast.text}</div>`}
  </div>`;
}

// ======================================================================
function Sidebar(p) {
  const { game, mode, setMode, tab, setTab, update, updScene, cur, setDialog, paintBg, paintChar, compose, makeFromImage, sel3d, setSel3d, setRight, notify } = p;
  const is3d = mode === '3d' || mode === 'code'; // 3D Novel shows the 3D library its cast and sets use
  const tabs = TABS[is3d ? '3d' : 'build'];
  const activeTab = tabs.some(t => t[0] === tab) ? tab : tabs[0][0];
  const fileRef = useRef();
  const searchRef = useRef();
  const [query, setQuery] = useState('');
  // Press "/" anywhere outside a text field to jump to the search box.
  useEffect(() => {
    const k = e => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); searchRef.current && searchRef.current.focus(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  // Search matches every word of the query against an asset's name and its
  // description / role / mood / prompt, case-insensitively.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = fields => !words.length || words.every(w => fields.filter(Boolean).join(' ').toLowerCase().includes(w));
  const SEARCH = {
    characters: () => game.characters.map(c => [c.name, c.role, c.desc]),
    backgrounds: () => game.backgrounds.map(b => [b.name, b.desc]),
    music: () => game.music.map(m => [m.name, m.mood]),
  };
  ['Building', 'Human', 'Prop'].forEach(cat => { SEARCH[cat] = () => game.assets3d.filter(a => a.cat === cat).map(a => [a.name, a.prompt, a.cat, a.source === 'sam3d' ? samLabel(a) : 'primitives']); });
  const elsewhere = words.length ? tabs.filter(([id]) => id !== activeTab).map(([id, label]) => [id, label, SEARCH[id]().filter(matches).length]).filter(t => t[2]) : [];

  let items = [];
  if (is3d) items = game.assets3d.filter(a => a.cat === activeTab).map(a => ({
    key: a.name, name: a.name, text: [a.name, a.prompt, a.cat, a.source === 'sam3d' ? samLabel(a) : 'primitives'], meta: a.source === 'sam3d' ? (a.busy ? samLabel(a) + ' is reconstructing…' : samLabel(a) + ' mesh') : a.busy ? 'Meta AI is modeling…' : ((a.parts || []).length + ' parts' + (a.style ? ' · ' + a.style : '')), icon: ICON3D[a.cat], busy: a.busy, on: a.name === sel3d,
    onClick: () => { setSel3d(a.name); setRight('edit'); },
    del: () => update(g => { g.assets3d = g.assets3d.filter(x => x.name !== a.name); return g; }, true),
  }));
  else if (activeTab === 'characters') items = game.characters.map(c => ({
    key: c.name, name: c.name, text: [c.name, c.role, c.desc], meta: c.busy ? 'Meta AI is drawing…' : (c.role || '') + (c.svg ? ' · AI art' : c.img ? ' · uploaded' : ' · placeholder'), img: FP.charUrl(game, c.name), contain: true, busy: c.busy,
    on: cur && cur.chars.some(x => x.name === c.name),
    onClick: () => updScene(s => { if (!s.chars.some(x => x.name === c.name)) { const used = s.chars.map(x => x.pos); s.chars.push({ name: c.name, expr: 'neutral', pos: ['C', 'L', 'R'].find(q => !used.includes(q)) || 'C' }); } }, true),
    paint: () => paintChar(c.name), paintTitle: 'Draw with Meta AI',
    lift: () => toPng(FP.charUrl(game, c.name)).then(image => makeFromImage({ name: c.name + ' 3D', cat: 'Human', image, kind: 'body' })).catch(e => notify(e.message, true)),
    del: () => update(g => { g.characters = g.characters.filter(x => x.name !== c.name); g.scenes.forEach(s => s.chars = s.chars.filter(x => x.name !== c.name)); return g; }, true),
  }));
  else if (activeTab === 'backgrounds') items = game.backgrounds.map(b => ({
    key: b.name, name: b.name, text: [b.name, b.desc], meta: b.busy ? 'Meta AI is painting…' : (b.svg ? 'AI art' : b.img ? 'Uploaded' : 'Placeholder') + ' · ' + game.scenes.filter(s => s.bg === b.name).length + ' scenes', img: FP.bgUrl(game, b.name), busy: b.busy,
    on: cur && cur.bg === b.name,
    onClick: () => updScene(s => { s.bg = b.name; }, true),
    paint: () => paintBg(b.name), paintTitle: 'Paint with Meta AI',
    del: () => update(g => { g.backgrounds = g.backgrounds.filter(x => x.name !== b.name); return g; }, true),
  }));
  else items = game.music.map(m => ({
    key: m.name, name: m.name, text: [m.name, m.mood], meta: m.busy ? 'Meta AI is composing…' : (m.src ? 'Uploaded audio' : m.notes ? 'Composed by Meta AI · ' + m.bpm + ' bpm' : 'Sketch · ' + (m.mood || '')), icon: 'ph-music-note', busy: m.busy,
    on: cur && cur.music === m.name,
    onClick: () => updScene(s => { s.music = m.name; }, true),
    paint: () => compose(m.name), paintTitle: 'Compose with Meta AI',
    play: () => { if (FP.music.current === m.name) FP.music.stop(); else { FP.music.stop(); FP.music.play(game, m.name); } },
    del: () => update(g => { g.music = g.music.filter(x => x.name !== m.name); return g; }, true),
  }));
  const total = items.length;
  items = items.filter(a => matches(a.text));

  async function onFiles(e) {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      const data = await readFile(f); const name = f.name.replace(/\.[^.]+$/, '');
      update(g => {
        if (activeTab === 'characters') g.characters.unshift({ name, role: 'Minor', desc: name, img: data });
        if (activeTab === 'backgrounds') g.backgrounds.unshift({ name, desc: name, img: data });
        if (activeTab === 'music') g.music.unshift({ name: f.name, mood: 'uploaded', src: data });
        return g;
      }, true);
    }
    if (files.length) notify(files.length + ' file(s) added to the library');
  }
  const genLabel = { characters: 'Create character', backgrounds: 'Create background', music: 'Compose track', Building: 'Model a building', Human: 'Model a person', Prop: 'Model a prop' }[activeTab];

  return html`<aside class="side">
    <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:2px">
      <div class="kicker" style="padding:4px 8px 8px">Mode</div>
      ${MODES.map(([id, label, icon, desc]) => html`<button class=${'mode-btn' + (mode === id ? ' on' : '')} onClick=${() => { setMode(id); if (id === 'play') setRight('ai'); else setRight('edit'); }}>
        <i class=${'ph ' + icon}></i><span style="display:flex;flex-direction:column;gap:1px"><span style="font-size:13px;font-weight:500">${label}</span><span style="font-size:11px;color:var(--color-neutral-400)">${desc}</span></span></button>`)}
    </div>
    <div class="rule" style="margin:0 var(--space-4)"></div>
    <div style="padding:var(--space-4) var(--space-4) 0;display:flex;flex-direction:column;gap:8px">
      <div class="row" style="justify-content:space-between;padding:4px 8px 0">
        <span class="kicker">${is3d ? '3D library' : 'Images & audio'}</span>
        <span class="row" style="gap:4px"><span style="font-size:11px" class="muted">${words.length ? items.length + ' of ' + total : total + ' items'}</span>
          ${!is3d && html`<button class="btn btn-secondary btn-icon" style="width:26px;height:26px" title="Upload your own files" onClick=${() => fileRef.current.click()}><i class="ph ph-upload-simple"></i></button>
          <input type="file" multiple accept=${activeTab === 'music' ? 'audio/*' : 'image/*'} ref=${fileRef} onChange=${onFiles} style="display:none" />`}
        </span>
      </div>
      <div class="tabs">${tabs.map(([id, label]) => html`<button class=${activeTab === id ? 'on' : ''} onClick=${() => setTab(id)}>${label}</button>`)}</div>
      <label class="search">
        <i class="ph ph-magnifying-glass"></i>
        <input ref=${searchRef} type="search" placeholder=${'Search ' + tabs.find(t => t[0] === activeTab)[1].toLowerCase() + '…  ( / )'} value=${query} aria-label="Search assets"
          onInput=${e => setQuery(e.target.value)} onKeyDown=${e => { if (e.key === 'Escape') { setQuery(''); e.target.blur(); } }} />
        ${query && html`<button class="search-clear" title="Clear search" onClick=${() => { setQuery(''); searchRef.current.focus(); }}><i class="ph ph-x"></i></button>`}
      </label>
    </div>
    <div style="flex:1;overflow:auto;padding:var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:3px">
      ${words.length > 0 && !items.length && html`<div class="search-empty">No ${tabs.find(t => t[0] === activeTab)[1].toLowerCase()} match “${query.trim()}”.</div>`}
      ${elsewhere.length > 0 && html`<div class="search-elsewhere">Also in: ${elsewhere.map(([id, label, n]) => html`<button class="chip" onClick=${() => setTab(id)}>${label} · ${n}</button>`)}</div>`}
      ${items.map(a => html`<div key=${a.key} class=${'asset' + (a.on ? ' on' : '')} role="button" tabindex="0" onClick=${a.onClick} title=${is3d ? 'Select' : activeTab === 'characters' ? 'Add to scene' : 'Use in scene'}>
        <span class="thumb">${a.img ? html`<img class=${a.contain ? 'contain' : ''} src=${a.img} alt="" />` : html`<i class=${'ph ' + a.icon} style="font-size:17px"></i>`}</span>
        <span style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
          <span class="asset-name">${a.name}</span><span class="asset-meta">${a.meta}</span>
          ${a.busy && html`<span class="bar indet"><span></span></span>`}
        </span>
        <span class="row-act" onClick=${e => e.stopPropagation()}>
          ${a.play && html`<button class="btn btn-secondary btn-icon" title="Preview" onClick=${a.play}><i class="ph ph-play"></i></button>`}
          ${a.lift && html`<button class="btn btn-secondary btn-icon" title="Make 3D with SAM 3D Body" disabled=${a.busy} onClick=${a.lift}><i class="ph ph-cube"></i></button>`}
          ${a.paint && html`<button class="btn btn-secondary btn-icon" title=${a.paintTitle} disabled=${a.busy} onClick=${a.paint}><i class="ph ph-magic-wand"></i></button>`}
          <button class="btn btn-secondary btn-icon" title="Delete" onClick=${a.del}><i class="ph ph-trash"></i></button>
        </span>
      </div>`)}
    </div>
    <div style="padding:var(--space-4);border-top:1px solid var(--color-divider)">
      <button class="btn btn-primary" style="width:100%" onClick=${() => setDialog({ create: activeTab })}><i class="ph ph-magic-wand"></i>${genLabel} with Meta AI</button>
      ${is3d && html`<button class="btn btn-secondary" style="width:100%;margin-top:6px" onClick=${() => setDialog({ create: activeTab, fromImage: true, only: activeTab === 'Human' ? 'body' : 'objects' })}><i class="ph ph-image"></i>From image · ${activeTab === 'Human' ? 'SAM 3D Body' : 'SAM 3D Objects'}</button>`}
    </div>
  </aside>`;
}

// ======================================================================
function Main(p) {
  const { game, mode, cur, building } = p;
  const isPlay = mode === 'play';
  if (mode === '3d') return html`<main class="main" style="grid-template-rows:minmax(0,1fr);overflow:auto"><${Asset3DView} ...${p} /></main>`;
  if (mode === 'code') return html`<main class="main" style="grid-template-rows:minmax(0,1fr);overflow:auto"><${CodeView} ...${p} /></main>`;
  const maxW = isPlay ? 'calc((100vh - 50px - 150px - 90px) * 16 / 9)' : 'calc(52vh * 16 / 9)';
  return html`<main class=${'main' + (isPlay ? ' play' : '')}>
    <section style="min-width:0;min-height:0;padding:var(--space-6) var(--space-6) var(--space-4);display:flex;flex-direction:column;gap:var(--space-3)">
      <div class="row" style="gap:var(--space-3)">
        <span class="kicker accent">${isPlay ? 'Playtest' : 'Scene preview'}</span>
        <span style="font-size:15px;font-weight:500">${cur ? cur.title : ''}</span>
        <div style="flex:1"></div>
        <span style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0" class="muted">Click the dialogue box to advance · ${cur ? cur.transition : ''}</span>
      </div>
      <div style=${'position:relative;width:100%;max-width:' + maxW}>
        <div class="preview"><${Preview} game=${game} sel=${cur && cur.id} setSel=${p.setSel} music=${isPlay} tags=${!isPlay} /></div>
        ${building && html`<div class="busy-veil" style="border-radius:var(--radius-md)"><div class="stack" style="align-items:center;gap:10px"><i class="ph ph-sparkle spin" style="font-size:26px;color:var(--color-accent)"></i>${building}<span class="muted" style="font-size:11px">Powered by Meta AI</span></div></div>`}
      </div>
    </section>
    <${SceneChart} ...${p} />
  </main>`;
}

function Preview({ game, sel, setSel, music, tags }) {
  const ref = useRef(); const line = useRef({ id: null, n: 0 });
  useEffect(() => {
    if (line.current.id !== sel) line.current = { id: sel, n: 0 };
    const ctl = FP.mount(ref.current, game, { scene: sel, line: line.current.n, music, showTags: tags, onLine: n => { line.current.n = n; }, onScene: id => { line.current = { id, n: 0 }; setSel(id); } });
    return () => ctl.destroy();
  }, [game, sel, music]);
  return html`<div ref=${ref} style="position:absolute;inset:0"></div>`;
}

function SceneChart({ game, update, sel, setSel, setRight, snapshot }) {
  const [drag, setDrag] = useState(null);
  const scenes = game.scenes;
  const byId = Object.fromEntries(scenes.map(s => [s.id, s]));
  const pos = id => (drag && drag.id === id ? { x: drag.x, y: drag.y } : byId[id]);
  const reach = useMemo(() => { const r = new Set(); const q = scenes[0] ? [scenes[0].id] : []; while (q.length) { const id = q.shift(); if (r.has(id) || !byId[id]) continue; r.add(id); byId[id].choices.forEach(c => q.push(c.to)); } return r; }, [game]);
  const W = Math.max(600, ...scenes.map(s => pos(s.id).x)) + 190, H = Math.max(160, ...scenes.map(s => pos(s.id).y)) + 70;
  const endings = scenes.filter(s => !s.choices.length).length, lost = scenes.length - reach.size;

  function down(e, s) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: s.id, sx: e.clientX, sy: e.clientY, ox: s.x, oy: s.y, x: s.x, y: s.y, moved: false });
  }
  function move(e) { if (!drag) return; const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; setDrag({ ...drag, x: Math.max(0, Math.round((drag.ox + dx) / 6) * 6), y: Math.max(0, Math.round((drag.oy + dy) / 6) * 6), moved: drag.moved || Math.abs(dx) + Math.abs(dy) > 4 }); }
  function up() {
    if (!drag) return;
    if (drag.moved) update(g => { const s = g.scenes.find(x => x.id === drag.id); s.x = drag.x; s.y = drag.y; return g; }, true);
    else { setSel(drag.id); setRight(r => (r === 'settings' ? 'edit' : r)); }
    setDrag(null);
  }
  function addBranch() {
    update(g => {
      const from = g.scenes.find(s => s.id === sel) || g.scenes[0]; const id = nextSceneId(g.scenes);
      g.scenes.push({ id, title: 'New scene', x: from.x + 200, y: Math.max(...g.scenes.map(s => s.y)) + 74, bg: from.bg, music: from.music, transition: 'Fade', chars: [], lines: [], choices: [] });
      from.choices.push({ text: 'Continue', to: id }); setTimeout(() => setSel(id)); return g;
    }, true);
    setRight('edit');
  }

  return html`<section class="chart">
    <div class="chart-head">
      <i class="ph ph-tree-structure" style="color:var(--color-accent)"></i>
      <span style="font-size:13px;font-weight:500">Scene chart</span>
      <span style="font-size:11px" class="muted">${scenes.length} scenes · ${endings} endings${lost ? html` · <span style="color:var(--color-danger)">${lost} unreachable</span>` : ''} · drag to arrange</span>
      <div style="flex:1"></div>
      <button class="btn btn-ghost" onClick=${() => update(g => { AI.layoutScenes(g.scenes); return g; }, true)}><i class="ph ph-magic-wand"></i>Tidy</button>
      <button class="btn btn-ghost" onClick=${addBranch}><i class="ph ph-plus"></i>Branch from selected</button>
    </div>
    <div class="chart-body">
      <div style=${`position:relative;width:${W}px;height:${H}px;margin:16px`} onPointerMove=${move} onPointerUp=${up}>
        <svg width=${W} height=${H} style="position:absolute;inset:0;pointer-events:none;overflow:visible">
          <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="context-stroke" /></marker></defs>
          ${scenes.flatMap(s => s.choices.map((c, i) => {
            const t = byId[c.to]; if (!t) return null; const a = pos(s.id), b = pos(t.id);
            const x1 = a.x + 156, y1 = a.y + 25, x2 = b.x, y2 = b.y + 25; const hot = s.id === sel || t.id === sel;
            const back = x2 < x1; const mx = back ? 60 : Math.max(30, (x2 - x1) / 2);
            const d = back ? `M${x1} ${y1} C${x1 + mx} ${y1 - 70}, ${x2 - mx} ${y2 - 70}, ${x2} ${y2}` : `M${x1} ${y1} C${x1 + mx} ${y1}, ${x2 - mx} ${y2}, ${x2} ${y2}`;
            return html`<path key=${s.id + i} d=${d} fill="none" stroke=${hot ? 'var(--color-accent)' : 'var(--color-neutral-600)'} stroke-width=${hot ? 1.6 : 1} stroke-dasharray=${back ? '4 4' : ''} marker-end="url(#arr)" />`;
          }))}
        </svg>
        ${scenes.map((s, i) => { const q = pos(s.id); return html`<button key=${s.id} class=${'node' + (s.id === sel ? ' on' : '') + (i === 0 ? ' start' : '')} style=${`left:${q.x}px;top:${q.y}px;${reach.has(s.id) ? '' : 'border-style:dashed;opacity:.7'}`} onPointerDown=${e => down(e, s)}>
          <span class="node-t"><span class="mono muted" style="font-size:10px">${String(i + 1).padStart(2, '0')}</span>${s.title}</span>
          <span class="node-s">${s.choices.length ? s.bg : 'Ending · ' + s.bg}</span>
        </button>`; })}
      </div>
    </div>
  </section>`;
}

// ======================================================================
function Asset3DView(p) {
  const { game, sel3d, style3d } = p;
  const canvas = useRef(); const viewer = useRef(null);
  const [ready, setReady] = useState(false); const [err, setErr] = useState(null); const [tris, setTris] = useState(0);
  const asset = game.assets3d.find(a => a.name === sel3d) || game.assets3d[0];
  useEffect(() => {
    let dead = false;
    import('./viewer3d.js').then(m => m.createViewer(canvas.current)).then(v => { if (dead) return v.destroy(); viewer.current = v; setReady(true); }).catch(e => setErr('3D viewer could not load three.js: ' + e.message));
    return () => { dead = true; if (viewer.current) viewer.current.destroy(); viewer.current = null; };
  }, []);
  useEffect(() => {
    if (!ready || !asset || (asset.source === 'sam3d' && !asset.glb)) return;
    viewer.current.show(asset, asset.style || style3d).then(setTris).catch(e => setErr('Could not show this model: ' + e.message));
  }, [ready, asset, style3d]);
  const sam = asset && asset.source === 'sam3d';
  window.__gfViewer = viewer;
  return html`<div class="view3d">
  <section style="min-width:0;display:flex;flex-direction:column;gap:var(--space-3)">
    <div class="row" style="gap:var(--space-3)">
      <span class="kicker accent">Asset preview</span><span style="font-size:15px;font-weight:500">${asset ? asset.name : 'No assets'}</span>
      <div style="flex:1"></div><span style="font-size:11px" class="muted">Drag to orbit · scroll to zoom</span>
    </div>
    <div class="viewer3d">
      <canvas ref=${canvas}></canvas>
      ${err && html`<div class="busy-veil">${err}</div>`}
      ${asset && asset.busy && html`<div class="busy-veil"><div class="stack" style="align-items:center"><i class="ph ph-cube spin" style="font-size:26px;color:var(--color-accent)"></i>${sam ? samLabel(asset) + ' is reconstructing ' + asset.name + '…' : 'Meta AI is modeling ' + asset.name + '…'}</div></div>`}
      ${asset && html`<div class="overlay-tags"><span class="tag tag-neutral">${asset.cat}</span>${sam ? html`<span class="tag tag-meta">${samLabel(asset)}</span>` : html`<span class="tag tag-neutral">${(asset.parts || []).length} parts</span>`}<span class="tag tag-neutral">${tris.toLocaleString()} tris</span>${!sam && html`<span class="tag tag-accent">${asset.style || style3d}</span>`}</div>`}
      <div style="position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:4px">
        <button class="btn btn-secondary btn-icon" title="Reset view" onClick=${() => viewer.current && viewer.current.reset()}><i class="ph ph-arrows-out-cardinal"></i></button>
        <button class="btn btn-secondary btn-icon" title="Auto-rotate" onClick=${() => viewer.current && viewer.current.toggleSpin()}><i class="ph ph-arrow-clockwise"></i></button>
        <button class="btn btn-secondary btn-icon" title="Wireframe" onClick=${() => viewer.current && viewer.current.toggleWire()}><i class="ph ph-cube-transparent"></i></button>
      </div>
    </div>
    <div class="card" style="font-size:12px;color:var(--color-neutral-300)"><i class="ph ph-info" style="color:var(--color-accent)"></i> Two Meta AI ways to make 3D: <b>Describe</b> it and Muse Spark builds it from 3D primitives, or start <b>From an image</b> and Meta's SAM 3D Body (people) or SAM 3D Objects (anything) reconstructs a mesh. Export any model as .glb for Unity, Godot, Unreal or Blender.</div>
  </section>
  <${SamEngines} setRight=${p.setRight} setDialog=${p.setDialog} notify=${p.notify} />
  </div>`;
}

// Side panel in 3D Assets: one-click Start / Stop for Meta's SAM 3D models on this PC.
const ENGINE_INFO = {
  body: { use: 'Characters', icon: 'ph-person', cat: 'Human', what: 'Turns a photo or drawing of a person into a 3D body.' },
  objects: { use: 'Buildings & props', icon: 'ph-house-line', cat: 'Building', what: 'Turns a picture of any object into a textured 3D mesh.' },
};
const ENGINE_STATE = {
  ready: ['Running', 'tag-accent'], starting: ['Starting…', 'tag-meta'], stopped: ['Stopped', 'tag-neutral'],
  error: ['Error', 'tag-danger'], other: ['Port busy', 'tag-danger'], missing: ['Not installed', 'tag-neutral'],
};
function SamEngines({ setRight, setDialog, notify }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState({});
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('gf.samAuto') === '1'; } catch (e) { return false; } });
  const autoDone = useRef(false);
  const refresh = () => AI.samEngines().then(l => { setList(l); setErr(''); return l; }).catch(e => { setErr(e.message); return null; });
  useEffect(() => {
    let t, dead = false;
    const tick = async () => { const l = await refresh(); if (dead) return; t = setTimeout(tick, l && l.some(e => e.state === 'starting') ? 1500 : 5000); };
    tick();
    return () => { dead = true; clearTimeout(t); };
  }, []);
  async function act(kind, action, quiet) {
    setBusy(b => ({ ...b, [kind]: action }));
    try {
      const s = await AI.samEngine(kind, action);
      if (!quiet) notify(action === 'stop' ? SAM_LABEL[kind] + ' stopped' : s.state === 'ready' ? SAM_LABEL[kind] + ' is already running' : 'Starting ' + SAM_LABEL[kind] + '. Loading it onto the GPU takes a little while.');
    } catch (e) { if (!quiet) notify(e.message, true); }
    await refresh();
    setBusy(b => ({ ...b, [kind]: null }));
  }
  // "Start automatically": start every installed model that is stopped when 3D Assets opens.
  useEffect(() => {
    if (!auto || !list || autoDone.current) return;
    autoDone.current = true;
    list.filter(e => e.installed && e.state === 'stopped').forEach(e => act(e.kind, 'start', true));
  }, [auto, list]);
  function toggleAuto(on) { setAuto(on); autoDone.current = false; try { localStorage.setItem('gf.samAuto', on ? '1' : '0'); } catch (e) { /* not saved */ } }
  const startAll = () => list.filter(e => e.installed && ['stopped', 'error'].includes(e.state)).forEach(e => act(e.kind, 'start'));
  const canStartAll = list && list.some(e => e.installed && ['stopped', 'error'].includes(e.state));

  return html`<aside class="engines">
    <div class="row"><i class="ph ph-cpu" style="color:var(--color-meta)"></i><span style="font-size:14px;font-weight:500;flex:1">SAM 3D on this PC</span><span class="tag tag-meta">Meta AI</span></div>
    <span class="muted" style="font-size:12px">Start Meta's image → 3D models here. They keep running until you stop them or close Game Forge.</span>
    ${err && html`<div class="msg err" style="max-width:100%">${err}</div>`}
    ${!list && !err && html`<span class="muted" style="font-size:12px"><i class="ph ph-spinner spin"></i> Checking…</span>`}
    ${list && list.map(e => {
      const info = ENGINE_INFO[e.kind];
      const st = !e.installed && e.state === 'stopped' ? 'missing' : e.state;
      const [label, tag] = ENGINE_STATE[st] || ENGINE_STATE.stopped;
      const b = busy[e.kind];
      return html`<div class=${'engine' + (st === 'ready' ? ' on' : '')} key=${e.kind}>
        <div class="row" style="gap:8px">
          <i class=${'ph ' + info.icon} style="font-size:20px;color:var(--color-accent)"></i>
          <span class="stack" style="gap:0;flex:1;min-width:0"><span style="font-size:13px;font-weight:500">${e.label}</span><span class="muted" style="font-size:11px">${info.use}</span></span>
          <span class=${'tag ' + tag}>${label}</span>
        </div>
        <span style="font-size:12px;color:var(--color-neutral-300)">${
          st === 'ready' ? html`Ready on ${e.gpu || 'your GPU'}${e.vram ? ' · ' + e.vram + ' GB VRAM' : ''}${e.managed ? '' : ' · started outside Game Forge'}.`
          : st === 'starting' ? html`Loading the model onto the GPU${e.seconds ? ' · ' + e.seconds + ' s' : ''}. This usually takes under a minute.`
          : st === 'missing' ? e.missing
          : st === 'error' ? e.error || 'It stopped with an error.'
          : st === 'other' ? 'Another program is using port ' + e.port + '.'
          : info.what}</span>
        ${st === 'starting' && html`<span class="bar indet"><span></span></span>`}
        ${['starting', 'error'].includes(st) && e.log.length > 0 && html`<span class="mono muted engine-log" title=${e.log.join('\n')}>${e.log[e.log.length - 1]}</span>`}
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${['stopped', 'error'].includes(st) && html`<button class="btn btn-primary" disabled=${!!b} onClick=${() => act(e.kind, 'start')}><i class=${'ph ' + (b ? 'ph-spinner spin' : 'ph-play')}></i>${st === 'error' ? 'Try again' : 'Start'}</button>`}
          ${e.managed && ['ready', 'starting'].includes(st) && html`<button class="btn btn-secondary" disabled=${!!b} onClick=${() => act(e.kind, 'stop')}><i class=${'ph ' + (b ? 'ph-spinner spin' : 'ph-stop')}></i>Stop</button>`}
          ${st === 'ready' && html`<button class="btn btn-secondary" onClick=${() => setDialog({ create: info.cat, fromImage: true, only: e.kind })}><i class="ph ph-image"></i>From image</button>`}
          ${st === 'missing' && e.kind === 'objects' && html`<button class="btn btn-secondary" onClick=${() => setRight('settings')}><i class="ph ph-cloud"></i>Use a cloud GPU</button>`}
        </div>
      </div>`;
    })}
    ${list && html`<button class="btn btn-solid" disabled=${!canStartAll} onClick=${startAll}><i class="ph ph-lightning"></i>Start all installed</button>`}
    <label class="check" style="font-size:12px;color:var(--color-neutral-300)"><input type="checkbox" checked=${auto} onChange=${ev => toggleAuto(ev.target.checked)} />Start them automatically when I open 3D Assets</label>
  </aside>`;
}

// ======================================================================
// 3D Novel: an interactive 3D story game Meta AI built — the player explores
// and clicks on people, buildings and objects to move the story on. It runs in
// a sandboxed frame (no same-origin), so generated code can never read your
// API key or project.
function CodeView(p) {
  const { game, coding, codeGame, fullGamePage, exportFullGame, aiReady } = p;
  const code = game.code && game.code.html ? game.code : null;
  const frame = useRef();
  const [page, setPage] = useState(null);
  const [err, setErr] = useState(null);
  const [run, setRun] = useState(0);
  const [showCode, setShowCode] = useState(false);
  useEffect(() => {
    let dead = false; setErr(null); setPage(null);
    if (code) fullGamePage(game).then(h => { if (!dead) setPage(h); }).catch(e => !dead && setErr('Could not prepare the 3D novel: ' + e.message));
    return () => { dead = true; };
  }, [code && code.at, run]);
  useEffect(() => {
    const on = e => { if (frame.current && e.source === frame.current.contentWindow && e.data && e.data.forgeError) setErr(x => x || String(e.data.forgeError).slice(0, 600)); };
    window.addEventListener('message', on); return () => window.removeEventListener('message', on);
  }, []);
  const lines = code ? code.html.split('\n').length : 0;
  return html`<section style="min-width:0;padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-3);min-height:0">
    <div class="row" style="gap:var(--space-3);flex-wrap:wrap">
      <span class="kicker accent">3D novel</span><span style="font-size:15px;font-weight:500">${game.title}</span>
      ${code && html`<span class="tag tag-meta"><i class="ph ph-sparkle"></i>${code.model}</span><span class="tag tag-neutral">${lines.toLocaleString()} lines of code</span>`}
      <div style="flex:1"></div>
      ${code && html`
        <button class="btn btn-secondary" onClick=${() => setRun(r => r + 1)} title="Start again from the beginning"><i class="ph ph-arrow-clockwise"></i>Restart</button>
        <button class="btn btn-secondary" onClick=${() => frame.current && frame.current.requestFullscreen && frame.current.requestFullscreen()}><i class="ph ph-corners-out"></i>Full screen</button>
        <button class="btn btn-secondary" onClick=${() => setShowCode(!showCode)}><i class="ph ph-code"></i>${showCode ? 'Hide code' : 'Code'}</button>
        <button class="btn btn-primary" onClick=${exportFullGame}><i class="ph ph-download-simple"></i>Save 3D novel (.html)</button>`}
    </div>
    <div class="gameframe">
      ${page && html`<iframe key=${run + ':' + code.at} ref=${frame} srcdoc=${page} sandbox="allow-scripts allow-pointer-lock" allow="fullscreen; autoplay; gamepad" title="3D novel" onLoad=${() => { try { frame.current.focus(); } catch (e) { /* fine */ } }}></iframe>`}
      ${!code && !coding && html`<div class="busy-veil" style="background:transparent"><div class="stack" style="align-items:center;gap:10px;max-width:480px;text-align:center">
        <i class="ph ph-cube-focus" style="font-size:34px;color:var(--color-accent)"></i>
        <span style="font-size:15px;font-weight:500">An interactive 3D story you click through</span>
        <span class="muted" style="font-size:12px">Muse Wonder builds a 3D world to explore, sandbox style. The dialogue box only shows what people say; you move the story on by doing things: click a person to talk, the pan to cook, a door to change room. Describe your idea on the right; your 3D models, including SAM 3D Body people, are there for it to use.</span>
        ${!aiReady && html`<span style="font-size:12px;color:var(--color-danger)">Add your Meta AI key in the Meta AI tab first.</span>`}
      </div></div>`}
      ${code && !page && !err && !coding && html`<div class="busy-veil"><i class="ph ph-spinner spin"></i> Loading the 3D novel…</div>`}
      ${coding && html`<div class="busy-veil"><div class="stack" style="align-items:center;gap:10px"><i class="ph ph-cube-focus spin" style="font-size:26px;color:var(--color-accent)"></i>${coding}<span class="muted" style="font-size:11px">This takes a few minutes · Powered by Meta AI</span></div></div>`}
    </div>
    ${err && html`<div class="note" style="border-color:var(--color-danger)"><i class="ph ph-warning" style="color:var(--color-danger)"></i><span style="flex:1;font-size:12px">The 3D novel hit an error: <span class="mono">${err}</span></span>
      <button class="btn btn-solid" disabled=${!!coding} onClick=${() => codeGame({ error: err })}><i class="ph ph-wrench"></i>Fix with Meta AI</button></div>`}
    ${showCode && code && html`<textarea class="input mono codebox" readonly value=${code.html}></textarea>`}
    <span class="muted" style="font-size:11px">Click inside to play. It runs sandboxed: it cannot see Game Forge, your key or your files.</span>
  </section>`;
}

// Optional starting points for the idea box: clicking one adds its text, which
// the author can edit. Nothing is sent unless they pick one.
const NOVEL_STARTERS = [
  ['Isometric room diorama', 'Show each location as an isometric cut-away room, like a dollhouse seen from above at an angle: the floor and two back walls, with no ceiling or front walls, so the whole room is visible at once. Fill it with detailed furniture and props (shelves, posters, lamps, plants, beds, sofas, desks, tables). The characters stand and sit in the room. The player clicks people to talk and clicks objects to use them (the stove to cook, a door to leave, a drawer to search), and those actions move the story on to the next room or scene.'],
  ['Cozy café or shop', 'Set it in an isometric cut-away café or shop with a counter, a stove and pans, tables and chairs, shelves of goods, hanging lights, plants and framed pictures, in warm evening light. Customers and staff each have a story; click them to hear it, and serve, cook or fetch things by clicking the counter, the pan or the shelves to move it on.'],
  ['Investigation room', 'Set it in an isometric cut-away room full of clues: an evidence board with notes and string, lockers, a desk, a bed, a sofa and scattered belongings. Click objects to search them and collect clues, click people to question them; what you find and where you take it decides how the story ends.'],
  ['Rooms to explore', 'Make several isometric cut-away rooms joined by doors. Click a door to move to the next room. Each room has people to talk to and objects to use, and using the right things in the right rooms moves the story on.'],
];
function EditCode(p) {
  const { game, coding, codeGame, settings, setSettings, prov, setDialog } = p;
  const code = game.code || {};
  const has = !!code.html;
  const [idea, setIdea] = useState(code.idea || '');
  const [useAssets, setUseAssets] = useState(code.useAssets !== false);
  const [useStory, setUseStory] = useState(!!code.useStory);
  const [refs, setRefs] = useState(code.refs || []);
  const [promptMode, setPromptMode] = useState(code.promptMode || 'forge');
  // Only the author's own words: the technical part is added out of sight.
  // (A prompt saved before the split, with the technical part in it, starts empty.)
  const [customPrompt, setCustomPrompt] = useState(code.customPrompt && !code.customPrompt.includes('FORGE.loadModel') ? code.customPrompt : '');
  const [showPrompt, setShowPrompt] = useState(false);
  const [change, setChange] = useState('');
  // Reference images: scaled to 1024 px JPEG so they stay small in the project.
  async function addRefs(e) {
    const files = [...e.target.files].slice(0, 4 - refs.length); e.target.value = '';
    const out = [];
    for (const f of files) {
      const url = await readFile(f);
      out.push(await new Promise(res => { const im = new Image(); im.onload = () => { const s = Math.min(1, 1024 / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.85)); }; im.onerror = () => res(null); im.src = url; }));
    }
    setRefs(r => [...r, ...out.filter(Boolean)].slice(0, 4));
  }
  const [fresh, setFresh] = useState(!has);
  useEffect(() => { if (!has) setFresh(true); }, [has]);
  const model = AI.codeModel();
  const models = game.assets3d.filter(a => a.glb || (a.parts || []).length);
  const people = models.filter(a => a.cat === 'Human');
  return html`
    <div class="stack" style="gap:4px">
      <div class="row"><span class="kicker accent" style="flex:1">3D novel</span><span class="tag tag-meta"><i class="ph ph-sparkle"></i>${model}</span></div>
      <span style="font-size:12px;color:var(--color-neutral-300)">A sandbox-style 3D world: the dialogue box only shows what people say, and you move the story on by clicking things (a person to talk, the pan to cook, a door to change room). Its story is its own.</span>
    </div>
    ${has && html`<div class="stack" style="gap:6px">
      <span class="label">Change it</span>
      <textarea class="input" style="min-height:64px" value=${change} onInput=${e => setChange(e.target.value)}></textarea>
      <button class="btn btn-solid" disabled=${!!coding || !change.trim()} onClick=${() => { codeGame({ change: change.trim() }); setChange(''); }}><i class=${'ph ' + (coding ? 'ph-spinner spin' : 'ph-magic-wand')}></i>${coding ? 'Meta AI is working…' : 'Apply with Meta AI'}</button>
      ${(code.changes || []).length > 0 && html`<span class="muted" style="font-size:11px">Changes so far: ${code.changes.join(' · ')}</span>`}
    </div>
    <div class="rule"></div>
    <button class="btn btn-ghost" style="align-self:flex-start;font-size:12px" onClick=${() => setFresh(!fresh)}><i class=${'ph ' + (fresh ? 'ph-caret-down' : 'ph-caret-right')}></i>Build a new one</button>`}
    ${fresh && html`<div class="stack" style="gap:10px">
      <div class="stack" style="gap:6px">
        <span class="label">Prompt</span>
        <div class="seg" style="align-self:flex-start">
          <button class=${'seg-opt' + (promptMode === 'forge' ? ' on' : '')} onClick=${() => setPromptMode('forge')}>Game Forge's + my idea</button>
          <button class=${'seg-opt' + (promptMode === 'own' ? ' on' : '')} onClick=${() => setPromptMode('own')}>My own prompt</button>
        </div>
        ${promptMode === 'forge' ? html`
          <span class="muted" style="font-size:11px">Game Forge's prompt describes a sandbox-style 3D story; your idea goes with it.</span>
          <button class="btn btn-ghost" style="align-self:flex-start;font-size:12px" onClick=${() => setShowPrompt(!showPrompt)}><i class=${'ph ' + (showPrompt ? 'ph-caret-down' : 'ph-caret-right')}></i>${showPrompt ? 'Hide' : 'See'} Game Forge's prompt</button>
          ${showPrompt && html`<textarea class="input mono" readonly style="min-height:200px;font-size:11px" value=${Coder.STYLE_PROMPT}></textarea>`}` : html`
          <span class="muted" style="font-size:11px">Write your own prompt: the kind of game, story and look you want. Game Forge adds the technical details itself (your 3D models, how to load them, how the file runs), so you don't need to.</span>
          <textarea class="input mono" style="min-height:220px;font-size:11px" value=${customPrompt} onInput=${e => setCustomPrompt(e.target.value)}></textarea>
          <div class="row" style="gap:6px"><button class="btn btn-ghost" style="font-size:12px" onClick=${() => setCustomPrompt(Coder.STYLE_PROMPT)}><i class="ph ph-arrow-counter-clockwise"></i>Start from Game Forge's</button><button class="btn btn-ghost" style="font-size:12px" onClick=${() => setCustomPrompt('')}><i class="ph ph-eraser"></i>Clear</button></div>`}
      </div>
      <div class="field"><label>Your idea (optional: leave it empty and Muse Wonder decides)</label><textarea class="input" style="min-height:96px" value=${idea} onInput=${e => setIdea(e.target.value)}></textarea></div>
      <div class="stack" style="gap:4px">
        <span class="muted" style="font-size:11px">Optional starting points: click one to add it to your idea, then edit it.</span>
        <div class="chips">${NOVEL_STARTERS.map(([label, text]) => html`<button class="chip" title=${text} onClick=${() => setIdea(v => (v.trim() ? v.trim() + '\n\n' : '') + text)}>${label}</button>`)}</div>
      </div>
      <div class="stack" style="gap:6px">
        <span class="label">Reference images · the look you have in mind (optional, up to 4)</span>
        ${refs.length > 0 && html`<div class="row" style="gap:6px;flex-wrap:wrap">${refs.map((u, i) => html`<span key=${i} style="position:relative;display:inline-block">
          <img src=${u} alt=${'Reference ' + (i + 1)} style="width:72px;height:54px;object-fit:cover;border-radius:6px;border:1px solid var(--color-divider)" />
          <button class="btn btn-secondary btn-icon" title="Remove" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;min-height:20px" onClick=${() => setRefs(r => r.filter((_, j) => j !== i))}><i class="ph ph-x" style="font-size:10px"></i></button></span>`)}</div>`}
        ${refs.length < 4 && html`<input class="input" type="file" accept="image/*" multiple onChange=${addRefs} />`}
      </div>
      <label class="check" style="font-size:12px"><input type="checkbox" checked=${useAssets} onChange=${e => setUseAssets(e.target.checked)} />Let it use my 3D models (${models.length}${people.length ? ', ' + people.length + ' people' : ''})</label>
      ${useAssets && html`<div class="stack" style="gap:4px;padding-left:24px">
        ${models.length > 0 && html`<span class="muted" style="font-size:11px">${models.map(a => a.name).join(', ')}</span>`}
        <button class="btn btn-ghost" style="align-self:flex-start;font-size:12px" onClick=${() => setDialog({ create: 'Human', fromImage: true, only: 'body' })}><i class="ph ph-person-arms-spread"></i>Add a person from an image (SAM 3D Body)</button>
      </div>`}
      <label class="check" style="font-size:12px"><input type="checkbox" checked=${useStory} onChange=${e => setUseStory(e.target.checked)} />Share my 2D novel as inspiration (“${game.title}”, ${game.scenes.length} scenes)</label>
      <div class="field"><label>Model</label><input class="input mono" list="codemodels" style="font-size:12px" placeholder=${(prov && prov.codeModel) || settings.model} value=${settings.codeModel || ''} onInput=${e => setSettings({ ...settings, codeModel: e.target.value.trim() })} />
        <datalist id="codemodels">${[...new Set([...((prov && prov.models) || []), ...(settings.knownModels || [])])].map(m => html`<option value=${m}></option>`)}</datalist></div>
      <button class="btn btn-primary" disabled=${!!coding || (promptMode === 'own' && !customPrompt.trim())} onClick=${() => codeGame({ idea: idea.trim(), useAssets, useStory, refs, promptMode, customPrompt })}><i class=${'ph ' + (coding ? 'ph-spinner spin' : 'ph-cube-focus')}></i>${coding ? 'Meta AI is working…' : has ? 'Build a new 3D novel' : 'Build with Meta AI'}</button>
      ${has && html`<span class="muted" style="font-size:11px">This replaces the current one. Undo brings it back.</span>`}
    </div>`}
    <div class="note"><i class="ph ph-info" style="color:var(--color-meta)"></i><span style="flex:1;font-size:12px">Building takes a few minutes. Want the assets in Blender, Unity, Godot or Unreal instead? Use <b>Save → Export asset pack (.zip)</b>.</span></div>`;
}

// ======================================================================
function RightPanel(p) {
  const { right, setRight, mode } = p;
  const tabs = [['edit', 'Edit', 'ph-sliders-horizontal'], ['ai', 'Assistant', 'ph-sparkle'], ['settings', 'Meta AI', 'ph-plugs']];
  return html`<aside class="right">
    <div class="rtabs">${tabs.map(([id, label, icon]) => html`<button class=${right === id ? 'on' : ''} onClick=${() => setRight(id)}><i class=${'ph ' + icon}></i>${label}</button>`)}</div>
    <div class="rbody">
      ${right === 'edit' && (mode === '3d' ? html`<${Edit3D} ...${p} />` : mode === 'code' ? html`<${EditCode} ...${p} />` : html`<${EditScene} ...${p} />`)}
      ${right === 'ai' && html`<${Assistant} ...${p} />`}
      ${right === 'settings' && html`<${Settings} ...${p} />`}
    </div>
  </aside>`;
}

function EditScene(p) {
  const { game, cur, updScene, update, snapshot, setSel, paintBg, ensureAI, runJob, notify } = p;
  const [instr, setInstr] = useState('');
  const [writing, setWriting] = useState(false);
  if (!cur) return html`<div class="muted">No scene selected.</div>`;
  const others = game.scenes.filter(s => s.id !== cur.id);
  const isStart = game.scenes[0] && game.scenes[0].id === cur.id;
  const notOnStage = game.characters.filter(c => !cur.chars.some(x => x.name === c.name));

  async function write() {
    if (!ensureAI()) return; setWriting(true);
    try {
      const j = await runJob('Write scene · ' + cur.title, () => AI.writeScene(game, cur, instr));
      updScene(s => {
        if (j.title) s.title = String(j.title);
        if (Array.isArray(j.lines) && j.lines.length) s.lines = j.lines.map(l => ({ who: String(l.who || 'Narrator'), text: String(l.text || '') })).filter(l => l.text);
        if (Array.isArray(j.chars) && j.chars.length) s.chars = j.chars.filter(c => game.characters.some(x => x.name === c.name)).slice(0, 3).map(c => ({ name: c.name, expr: c.expr || 'neutral', pos: ['L', 'C', 'R'].includes(c.pos) ? c.pos : 'C' }));
        if (Array.isArray(j.choiceTexts)) s.choices.forEach((c, i) => { if (j.choiceTexts[i]) c.text = String(j.choiceTexts[i]); });
      }, true);
      setInstr(''); notify('Scene rewritten by Meta AI');
    } catch (e) { /* toast shown */ }
    setWriting(false);
  }

  return html`
    <div class="field"><label>Scene title</label><input class="input" value=${cur.title} onFocus=${snapshot} onInput=${e => updScene(s => { s.title = e.target.value; })} /></div>
    <div class="stack" style="gap:6px">
      <div class="row"><span class="label" style="flex:1">Write with Meta AI</span><span class="tag tag-meta"><i class="ph ph-sparkle"></i>Meta AI</span></div>
      <textarea class="input" style="min-height:56px" placeholder="Optional direction, e.g. “make the mentor suspicious and drop a hint about the secret”" value=${instr} onInput=${e => setInstr(e.target.value)}></textarea>
      <button class="btn btn-primary" disabled=${writing} onClick=${write}>${writing ? html`<i class="ph ph-spinner spin"></i>Writing…` : html`<i class="ph ph-pen-nib"></i>Write this scene`}</button>
    </div>
    <div class="rule"></div>
    <div class="stack">
      <div class="row"><span class="label" style="flex:1">Background</span><button class="btn btn-ghost" style="font-size:12px" onClick=${() => paintBg(cur.bg)}><i class="ph ph-paint-brush"></i>Paint with Meta AI</button></div>
      <select class="input" value=${cur.bg} onChange=${e => updScene(s => { s.bg = e.target.value; }, true)}>${game.backgrounds.map(b => html`<option value=${b.name} selected=${b.name === cur.bg}>${b.name}</option>`)}</select>
    </div>
    <div class="stack">
      <span class="label">Characters on stage</span>
      ${cur.chars.map((c, i) => html`<div class="card row" key=${c.name}>
        <span style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-size:13px">${c.name}</span>
          <input class="input" style="min-height:24px;padding:2px 6px;font-size:11px" value=${c.expr} title="Expression" onFocus=${snapshot} onInput=${e => updScene(s => { s.chars[i].expr = e.target.value; })} /></span>
        <div class="seg">${['L', 'C', 'R'].map(q => html`<button class=${'seg-opt' + (q === c.pos ? ' on' : '')} onClick=${() => updScene(s => { s.chars[i].pos = q; }, true)}>${q}</button>`)}</div>
        <button class="btn btn-ghost btn-icon" style="width:26px;height:26px;color:var(--color-neutral-400)" title="Remove" onClick=${() => updScene(s => { s.chars.splice(i, 1); }, true)}><i class="ph ph-x"></i></button>
      </div>`)}
      ${notOnStage.length > 0 && html`<select class="input" value="" onChange=${e => { const n = e.target.value; if (n) updScene(s => { s.chars.push({ name: n, expr: 'neutral', pos: 'C' }); }, true); e.target.value = ''; }}>
        <option value="">+ Add character…</option>${notOnStage.map(c => html`<option value=${c.name}>${c.name}</option>`)}</select>`}
    </div>
    <div class="stack">
      <span class="label">Music</span>
      <div class="row">
        <select class="input" value=${cur.music} onChange=${e => updScene(s => { s.music = e.target.value; }, true)}><option value="">— silence —</option>${game.music.map(m => html`<option value=${m.name} selected=${m.name === cur.music}>${m.name}</option>`)}</select>
        <button class="btn btn-primary btn-icon" style="border-radius:50%;flex:none" title="Preview track" onClick=${() => { if (FP.music.current) FP.music.stop(); else FP.music.play(game, cur.music); }}><i class="ph ph-play"></i></button>
      </div>
    </div>
    <${DialogueEditor} key=${cur.id + JSON.stringify(cur.lines)} scene=${cur} onCommit=${lines => updScene(s => { s.lines = lines; }, true)} />
    <div class="stack">
      <span class="label">Choices → next scene</span>
      ${cur.choices.map((c, i) => html`<div style="display:grid;grid-template-columns:minmax(0,1fr) 112px 26px;gap:6px" key=${i}>
        <input class="input" style="min-height:32px;font-size:12px" value=${c.text} onFocus=${snapshot} onInput=${e => updScene(s => { s.choices[i].text = e.target.value; })} />
        <select class="input" style="min-height:32px;font-size:12px" value=${c.to} onChange=${e => updScene(s => { s.choices[i].to = e.target.value; }, true)}>${others.map(o => html`<option value=${o.id} selected=${o.id === c.to}>${o.title}</option>`)}</select>
        <button class="btn btn-ghost btn-icon" style="width:26px;height:32px;color:var(--color-neutral-400)" onClick=${() => updScene(s => { s.choices.splice(i, 1); }, true)}><i class="ph ph-x"></i></button>
      </div>`)}
      ${!cur.choices.length && html`<span class="tag tag-accent" style="align-self:flex-start">Ending scene</span>`}
      <button class="btn btn-ghost" style="align-self:flex-start;font-size:12px" disabled=${!others.length} onClick=${() => updScene(s => { s.choices.push({ text: 'New choice', to: others[0].id }); }, true)}><i class="ph ph-plus"></i>Add choice</button>
    </div>
    <div class="field"><label>Transition in</label>
      <select class="input" value=${cur.transition} onChange=${e => updScene(s => { s.transition = e.target.value; }, true)}>${['Fade', 'Cut', 'Dissolve', 'Slide left'].map(t => html`<option value=${t} selected=${t === cur.transition}>${t}</option>`)}</select></div>
    <div class="row">
      ${!isStart && html`<button class="btn btn-secondary" style="font-size:12px" onClick=${() => update(g => { const i = g.scenes.findIndex(s => s.id === cur.id); g.scenes.unshift(g.scenes.splice(i, 1)[0]); return g; }, true)}><i class="ph ph-flag"></i>Make start scene</button>`}
      <div style="flex:1"></div>
      <button class="btn btn-ghost btn-danger" style="font-size:12px" disabled=${game.scenes.length < 2} onClick=${() => { update(g => { g.scenes = g.scenes.filter(s => s.id !== cur.id); g.scenes.forEach(s => { s.choices = s.choices.filter(c => c.to !== cur.id); }); return g; }, true); setSel(others[0].id); }}><i class="ph ph-trash"></i>Delete scene</button>
    </div>`;
}

function DialogueEditor({ scene, onCommit }) {
  const toText = s => s.lines.map(l => l.who + ': ' + l.text).join('\n');
  const [text, setText] = useState(() => toText(scene));
  const commit = () => {
    const lines = text.split('\n').filter(r => r.trim()).map(r => { const k = r.indexOf(':'); return k > 0 && k < 40 ? { who: r.slice(0, k).trim(), text: r.slice(k + 1).trim() } : { who: 'Narrator', text: r.trim() }; });
    if (JSON.stringify(lines) !== JSON.stringify(scene.lines)) onCommit(lines);
  };
  return html`<div class="field"><label>Dialogue · one line per row, “Speaker: text” · applies when you click away</label>
    <textarea class="input" style="min-height:130px;font-size:13px" value=${text} onInput=${e => setText(e.target.value)} onBlur=${commit}></textarea></div>`;
}

function Edit3D(p) {
  const { game, sel3d, update, snapshot, make3d, style3d, setStyle3d, notify } = p;
  const asset = game.assets3d.find(a => a.name === sel3d) || game.assets3d[0];
  const [prompt, setPrompt] = useState(asset ? asset.prompt : '');
  const [budget, setBudget] = useState(24);
  useEffect(() => setPrompt(asset ? asset.prompt || '' : ''), [sel3d]);
  if (!asset) return html`<div class="muted">No 3D assets yet — use the button on the left.</div>`;
  async function glb() {
    const v = window.__gfViewer && window.__gfViewer.current; if (!v) return notify('3D viewer is not ready yet.', true);
    download(slug(asset.name) + '.glb', await v.exportGLB(asset, asset.style || style3d)); notify('Exported ' + slug(asset.name) + '.glb');
  }
  if (asset.source === 'sam3d') {
    const set = fn => update(g => { const a = g.assets3d.find(x => x.name === asset.name); if (a) fn(a); return g; }, true);
    const fix = asset.fix || [0, 0, 0];
    const turn = i => set(a => { const f = [...fix]; f[i] = (f[i] + 90) % 360; a.fix = f; });
    const height = asset.height || { Building: 6, Human: 1.75, Prop: 0.6 }[asset.cat] || 1;
    return html`
      <div class="stack" style="gap:2px"><span class="kicker accent">${asset.cat}</span><span style="font-size:17px;font-weight:500">${asset.name}</span></div>
      <div class="note"><i class="ph ph-cube" style="color:var(--color-meta)"></i><span style="flex:1">Reconstructed from an image by Meta's ${samLabel(asset)}.${asset.kind === 'body' ? ' It is an untextured, posed body mesh — a base to dress up in Blender or use as a stand-in.' : ''}${asset.busy ? ' Working…' : ''}</span></div>
      <div class="field"><label>Height in the game world (metres)</label><input class="input" type="number" min="0.05" step="0.05" value=${height} onFocus=${snapshot} onChange=${e => set(a => { a.height = Math.max(0.05, +e.target.value || height); })} /></div>
      <div class="stack" style="gap:6px"><span class="label">Fix orientation (if the model lies down or faces away)</span>
        <div class="row"><button class="btn btn-secondary" onClick=${() => turn(0)}><i class="ph ph-arrow-clockwise"></i>Tilt 90° (X)</button><button class="btn btn-secondary" onClick=${() => turn(1)}>Turn 90° (Y)</button><button class="btn btn-secondary" onClick=${() => turn(2)}>Roll 90° (Z)</button></div>
        <span class="muted" style="font-size:11px">Rotation ${fix.join('° / ')}° · the model always stands on the ground.</span></div>
      <div class="rule"></div>
      <div class="row">
        <button class="btn btn-primary" disabled=${!asset.glb} onClick=${glb}><i class="ph ph-download-simple"></i>Export .glb</button>
        <button class="btn btn-secondary" onClick=${() => p.setDialog({ create: asset.cat, fromImage: true, only: asset.kind === 'body' ? 'body' : 'objects' })}><i class="ph ph-image"></i>New from image</button>
      </div>`;
  }
  return html`
    <div class="stack" style="gap:2px"><span class="kicker accent">${asset.cat}</span><span style="font-size:17px;font-weight:500">${asset.name}</span></div>
    <div class="field"><label>Prompt for Meta AI</label><textarea class="input" value=${prompt} onInput=${e => setPrompt(e.target.value)}></textarea></div>
    <div class="field"><label>Style</label><select class="input" value=${style3d} onChange=${e => setStyle3d(e.target.value)}>${['Low-poly stylized', 'Toon shaded', 'Realistic PBR', 'Smooth clay'].map(s => html`<option value=${s} selected=${s === style3d}>${s}</option>`)}</select></div>
    <div class="field"><label>Detail · up to ${budget} parts</label><input type="range" min="8" max="60" value=${budget} onInput=${e => setBudget(+e.target.value)} style="width:100%;accent-color:var(--color-accent)" /></div>
    <button class="btn btn-solid" disabled=${asset.busy} onClick=${() => make3d({ name: asset.name, cat: asset.cat, prompt, budget })}><i class="ph ph-cube"></i>${asset.parts.length ? 'Regenerate' : 'Generate'} with Meta AI</button>
    <div class="rule"></div>
    <div class="stack">
      <span class="label">Parts</span>
      <div class="chips">${(asset.parts || []).slice(0, 40).map(pt => html`<span class="tag tag-neutral" style="gap:6px"><span style=${'width:8px;height:8px;border-radius:2px;background:' + pt.color}></span>${pt.label || pt.shape}</span>`)}</div>
    </div>
    <div class="row">
      <button class="btn btn-primary" onClick=${glb}><i class="ph ph-download-simple"></i>Export .glb</button>
      <button class="btn btn-secondary" onClick=${() => update(g => { g.assets3d.unshift({ ...clone(asset), name: asset.name + ' copy ' + uid().slice(0, 3) }); return g; }, true)}><i class="ph ph-copy"></i>Duplicate</button>
    </div>`;
}

// ======================================================================
const SUGGEST = ['Review my story structure', 'Add a plot twist', 'Make this scene funnier', 'Add a new secret ending', 'Suggest a mini-game for this scene', 'Give the antagonist a motive'];
function Assistant(p) {
  const { game, cur, messages, setMessages, update, ensureAI, jobs, undo, notify } = p;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [allow, setAllow] = useState(true);
  const end = useRef();
  useEffect(() => { end.current && end.current.scrollIntoView({ block: 'end' }); }, [messages, busy]);

  async function send(text) {
    text = (text || draft).trim(); if (!text || busy || !ensureAI()) return;
    setDraft(''); const history = messages.filter(m => !m.err);
    setMessages(m => [...m, { me: true, text }]); setBusy(true);
    try {
      const r = await AI.assistant({ game, selectedId: cur && cur.id, history, text, allowEdits: allow });
      let done = [];
      if (allow && r.actions.length) { const res = AI.applyActions(game, r.actions); done = res.done; if (done.length) update(g => AI.applyActions(g, r.actions).game, true); }
      setMessages(m => [...m, { me: false, text: r.reply, done }]);
      if (done.length) notify('Meta AI applied ' + done.length + ' change(s) — Undo is in the header');
    } catch (e) { setMessages(m => [...m, { me: false, err: true, text: e.message }]); }
    setBusy(false);
  }

  return html`
    <div class="stack" style="gap:4px">
      <div class="row"><span class="kicker accent" style="flex:1">Forge Assistant</span><span class="tag tag-meta"><i class="ph ph-sparkle"></i>Meta AI</span></div>
      <label class="check" style="font-size:12px;color:var(--color-neutral-300)"><input type="checkbox" checked=${allow} onChange=${e => setAllow(e.target.checked)} />Let the assistant edit the project (selected: ${cur ? cur.title : '—'})</label>
    </div>
    <div class="stack" style="gap:10px">
      ${messages.map((m, i) => html`<div key=${i} class=${'msg ' + (m.err ? 'err' : m.me ? 'me' : 'ai')}>${m.text}
        ${m.done && m.done.length > 0 && html`<div class="applied">${m.done.map(d => html`<span class="tag tag-accent"><i class="ph ph-check"></i>${d}</span>`)}<button class="chip" onClick=${undo}>Undo</button></div>`}</div>`)}
      ${busy && html`<div class="msg ai muted"><i class="ph ph-sparkle spin"></i> Meta AI is thinking…</div>`}
      <div ref=${end}></div>
    </div>
    <div class="chips">${SUGGEST.map(s => html`<button class="chip" onClick=${() => send(s)}>${s}</button>`)}</div>
    <div class="stack" style="gap:6px">
      <textarea class="input" style="min-height:70px" placeholder="Ask Meta AI anything about your game, or tell it what to change…  (Enter to send)" value=${draft} onInput=${e => setDraft(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
      <button class="btn btn-solid" disabled=${busy || !draft.trim()} onClick=${() => send()}><i class="ph ph-paper-plane-tilt"></i>Send</button>
    </div>
    ${jobs.length > 0 && html`<div class="stack">
      <span class="label">Generation queue</span>
      ${jobs.map(j => html`<div class="stack" style="gap:4px" key=${j.id} title=${j.err || ''}>
        <div class="row" style="font-size:12px;justify-content:space-between"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${j.name}</span>
          <span class="muted" style=${j.status === 'error' ? 'color:var(--color-danger)' : ''}>${j.status === 'running' ? 'working' : j.status === 'done' ? 'done' : 'failed'}</span></div>
        <span class=${'bar' + (j.status === 'running' ? ' indet' : '')}><span style=${'width:100%;' + (j.status === 'error' ? 'background:var(--color-danger)' : '')}></span></span>
      </div>`)}
    </div>`}`;
}

function Settings({ settings, setSettings, server, aiReady, prov, notify }) {
  const [test, setTest] = useState(null);
  const [showKey, setShowKey] = useState(false);
  function choose(id) { const pv = AI.PROVIDERS.find(x => x.id === id); setSettings({ ...settings, provider: id, baseUrl: pv.baseUrl, model: pv.model, codeModel: '', knownModels: [] }); setTest(null); }
  async function run() {
    setTest({ busy: true }); const t = Date.now();
    try { const r = await AI.llama([{ role: 'user', content: 'Reply with exactly: Game Forge is connected to Meta AI.' }], { maxTokens: 40, temperature: 0 }); setTest({ ok: true, text: r.trim(), ms: Date.now() - t }); }
    catch (e) { setTest({ ok: false, text: e.message }); }
  }
  const serverKeyHere = server && server.hasServerKey && server.baseUrl === settings.baseUrl.replace(/\/+$/, '');
  const [listing, setListing] = useState(null);
  const known = [...new Set([...(prov.models || []), ...(settings.knownModels || [])])];
  async function listAll() {
    setListing({ busy: true });
    try { const models = await AI.listModels(); setSettings({ ...settings, knownModels: models }); setListing({ ok: true, text: models.length ? models.length + ' models on your account: ' + models.join(', ') : 'Your account lists no models.' }); }
    catch (e) { setListing({ ok: false, text: e.message }); }
  }
  return html`
    <div class="stack" style="gap:10px">
      <div class="row"><i class="ph ph-sparkle" style="color:var(--color-meta)"></i><span style="font-size:14px;font-weight:500;flex:1">Meta AI connection</span><span class=${'tag ' + (aiReady ? 'tag-accent' : 'tag-neutral')}>${aiReady ? 'Ready' : 'Needs key'}</span></div>
      <span style="font-size:12px;color:var(--color-neutral-300)">Every AI feature in Game Forge — game writing, dialogue, the assistant, 2D art, music and 3D models — runs on Meta AI models: Muse Spark by default, or Meta Llama.</span>
      <div class="field"><label>Provider</label><select class="input" value=${settings.provider} onChange=${e => choose(e.target.value)}>${AI.PROVIDERS.map(x => html`<option value=${x.id} selected=${x.id === settings.provider}>${x.label}</option>`)}</select></div>
      <div class="field"><label>Model · story, art, music, 3D and the assistant</label><input class="input mono" list="models" style="font-size:12px" value=${settings.model} onInput=${e => setSettings({ ...settings, model: e.target.value })} />
        <datalist id="models">${known.map(m => html`<option value=${m}></option>`)}</datalist></div>
      <div class="field"><label>Model · 3D Novel code${prov.codeModel ? ' (Muse Wonder writes the best code)' : ''}</label><input class="input mono" list="models" style="font-size:12px" placeholder=${prov.codeModel || settings.model} value=${settings.codeModel || ''} onInput=${e => setSettings({ ...settings, codeModel: e.target.value.trim() })} /></div>
      <button class="btn btn-secondary" disabled=${listing && listing.busy} onClick=${listAll}><i class=${'ph ' + (listing && listing.busy ? 'ph-spinner spin' : 'ph-list-magnifying-glass')}></i>List the models my key can use</button>
      ${listing && !listing.busy && html`<div class=${'msg ' + (listing.ok ? 'ai' : 'err')} style="max-width:100%;font-size:12px">${listing.text}</div>`}
      <div class="field"><label>Endpoint (OpenAI-compatible)</label><input class="input mono" style="font-size:12px" value=${settings.baseUrl} onInput=${e => setSettings({ ...settings, baseUrl: e.target.value })} /></div>
      ${prov.needsKey && html`<div class="field"><label>API key ${serverKeyHere ? '· optional, server key is set' : ''}</label>
        <div class="row"><input class="input mono" type=${showKey ? 'text' : 'password'} style="font-size:12px" placeholder=${serverKeyHere ? 'Using MODEL_API_KEY from .env' : prov.keyHint || 'Paste your API key'} value=${settings.apiKey} onInput=${e => setSettings({ ...settings, apiKey: e.target.value.trim() })} />
        <button class="btn btn-secondary btn-icon" style="flex:none;height:34px;width:34px" onClick=${() => setShowKey(!showKey)} title="Show / hide"><i class=${'ph ' + (showKey ? 'ph-eye-slash' : 'ph-eye')}></i></button></div>
        <span style="font-size:11px" class="muted">Kept in this browser only and sent just to the local Game Forge server, which forwards it to ${settings.baseUrl.replace(/^https?:\/\//, '').split('/')[0]}.</span></div>`}
      <button class="btn btn-solid" disabled=${test && test.busy} onClick=${run}><i class=${'ph ' + (test && test.busy ? 'ph-spinner spin' : 'ph-plug')}></i>Test connection</button>
      ${test && !test.busy && html`<div class=${'msg ' + (test.ok ? 'ai' : 'err')} style="max-width:100%">${test.ok ? html`<i class="ph ph-check-circle" style="color:#4ade80"></i> ${test.text} · ${test.ms} ms` : test.text}</div>`}
    </div>
    <div class="rule"></div>
    <div class="stack" style="font-size:12px;color:var(--color-neutral-300)">
      <span class="label">Getting a Muse Spark key</span>
      <span>1. Sign in at <a href="https://dev.meta.ai/api-keys/" target="_blank" rel="noopener" style="color:var(--color-accent-300)">dev.meta.ai/api-keys</a> and create an API key.</span>
      <span>2. Paste it above, or put <span class="mono">MODEL_API_KEY=…</span> in <span class="mono">game-forge/.env</span> and restart the server.</span>
      <span>One key works for every Muse model on Meta Model API: <span class="mono">muse-spark-1.1</span> and <span class="mono">muse-spark-1.3</span> for everyday writing, and <span class="mono">muse-wonder-1.0</span>, Meta's strongest coding model, for 3D Novel. Muse Wonder Full is not on the API yet. They are reasoning models, so replies can take a little longer.</span>
      <span>The other presets run Meta Llama instead (Meta Llama API, Groq, Together, or Ollama on your own machine).</span>
      ${server && server.offline && html`<span style="color:var(--color-danger)">The local server is not responding — start it with <span class="mono">node server.js</span>.</span>`}
    </div>
    <div class="rule"></div>
    <${Sam3dSettings} settings=${settings} setSettings=${setSettings} server=${server} />`;
}

function Sam3dSettings({ settings, setSettings, server }) {
  const [test, setTest] = useState(null);
  const envUrl = server && server.sam3dUrl;
  async function run() {
    setTest({ busy: true });
    try {
      const h = await AI.sam3dHealth(); const kinds = (h.kinds || []).map(k => SAM_LABEL[k] || k).join(' + ') || 'no models';
      setTest({ ok: true, text: h.mode === 'fake' ? 'Connected — test mode (placeholder cubes, no GPU) · ' + kinds + '.' : 'Connected · ' + kinds + ((h.loaded || []).length ? ' · loaded: ' + h.loaded.join(', ') : ' · models load on the first request') + '.' });
    }
    catch (e) { setTest({ ok: false, text: e.message }); }
  }
  return html`<div class="stack" style="gap:10px">
    <div class="row"><i class="ph ph-cube" style="color:var(--color-meta)"></i><span style="font-size:14px;font-weight:500;flex:1">SAM 3D · image → 3D</span><span class=${'tag ' + (settings.sam3dUrl || envUrl ? 'tag-accent' : 'tag-neutral')}>${settings.sam3dUrl || envUrl ? 'Set' : 'Not set'}</span></div>
    <span style="font-size:12px;color:var(--color-neutral-300)">Meta's <b>SAM 3D Body</b> turns a picture of a person into a 3D body mesh and runs on your own GPU. <b>SAM 3D Objects</b> (any object) needs a 32 GB+ Linux GPU. Both run through <span class="mono">sam3d-service</span> — see its README.</span>
    <div class="field"><label>Service URL ${envUrl && !settings.sam3dUrl ? '· using ' + envUrl : ''}</label><input class="input mono" style="font-size:12px" placeholder=${envUrl || 'http://127.0.0.1:8000'} value=${settings.sam3dUrl || ''} onInput=${e => setSettings({ ...settings, sam3dUrl: e.target.value.trim() })} /></div>
    <div class="field"><label>Service token (SAM3D_TOKEN)</label><input class="input mono" type="password" style="font-size:12px" placeholder="Optional" value=${settings.sam3dToken || ''} onInput=${e => setSettings({ ...settings, sam3dToken: e.target.value.trim() })} /></div>
    <button class="btn btn-primary" disabled=${(test && test.busy) || !(settings.sam3dUrl || envUrl)} onClick=${run}><i class=${'ph ' + (test && test.busy ? 'ph-spinner spin' : 'ph-plug')}></i>Test SAM 3D service</button>
    ${test && !test.busy && html`<div class=${'msg ' + (test.ok ? 'ai' : 'err')} style="max-width:100%">${test.ok ? html`<i class="ph ph-check-circle" style="color:#4ade80"></i> ` : ''}${test.text}</div>`}
  </div>`;
}

// ======================================================================
function NewGameDialog({ onClose, onBuild, aiReady, goSettings }) {
  const [idea, setIdea] = useState('');
  const [genre, setGenre] = useState('Mystery');
  const [tone, setTone] = useState('Atmospheric');
  const [length, setLength] = useState('medium');
  const [paint, setPaint] = useState(true);
  const IDEAS = ['A robot chef must win a cooking contest to save its owner’s diner', 'Two rival witches are forced to share a haunted dorm room', 'A courier in a flooded future city carries a package that talks', 'A detective cat solves a jewel heist at a midnight circus'];
  return html`<div class="backdrop" onClick=${onClose}><div class="dialog" onClick=${e => e.stopPropagation()}>
    <div class="row"><i class="ph ph-magic-wand" style="color:var(--color-accent);font-size:18px"></i><span class="dialog-title">New game with Meta AI</span><div style="flex:1"></div><button class="btn btn-ghost btn-icon" onClick=${onClose}><i class="ph ph-x"></i></button></div>
    <span style="font-size:13px;color:var(--color-neutral-300);margin-top:-8px">Describe your game. Meta AI writes the characters, locations, soundtrack and every branching scene — then you edit anything.</span>
    <div class="field"><label>Game idea</label><textarea class="input" style="min-height:90px" autofocus placeholder="e.g. A young keeper must relight the harbor lighthouse before the fog swallows the fleet…" value=${idea} onInput=${e => setIdea(e.target.value)}></textarea></div>
    <div class="chips">${IDEAS.map(s => html`<button class="chip" onClick=${() => setIdea(s)}>${s}</button>`)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Genre</label><select class="input" value=${genre} onChange=${e => setGenre(e.target.value)}>${['Mystery', 'Fantasy', 'Sci-fi', 'Romance', 'Horror', 'Comedy', 'Adventure', 'Slice of life'].map(g => html`<option value=${g} selected=${g === genre}>${g}</option>`)}</select></div>
      <div class="field"><label>Tone</label><select class="input" value=${tone} onChange=${e => setTone(e.target.value)}>${['Atmospheric', 'Lighthearted', 'Dark', 'Epic', 'Cozy', 'Tense'].map(g => html`<option value=${g} selected=${g === tone}>${g}</option>`)}</select></div>
    </div>
    <div class="row"><span class="label" style="flex:1">Length</span><div class="seg">${[['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']].map(([id, l]) => html`<button class=${'seg-opt' + (length === id ? ' on' : '')} onClick=${() => setLength(id)}>${l}</button>`)}</div></div>
    <label class="check"><input type="checkbox" checked=${paint} onChange=${e => setPaint(e.target.checked)} />Also paint backgrounds and characters with Meta AI (takes longer)</label>
    ${!aiReady && html`<div class="note"><i class="ph ph-key" style="color:var(--color-accent)"></i><span style="flex:1">Connect a Meta AI API key first.</span><button class="btn btn-ghost" onClick=${goSettings}>Add key</button></div>`}
    <div class="dialog-actions"><button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
      <button class="btn btn-solid" disabled=${!idea.trim()} onClick=${() => onBuild({ idea: idea.trim(), genre, tone, length, paint })}><i class="ph ph-sparkle"></i>Build my game</button></div>
  </div></div>`;
}

function CreateDialog(p) {
  const { type, onClose, update, setTab, ensureAI, paintBg, paintChar, compose, make3d, makeFromImage, sam3dReady, setDialog, game, notify } = p;
  const is3d = ['Building', 'Human', 'Prop'].includes(type);
  // only: 'body' | 'objects' — opened for one SAM 3D model (its card, a Humans
  // tab, a scanned asset): image mode only, and only the categories it can make.
  const only = is3d ? p.only : null;
  const [kind, setKind] = useState(only === 'body' ? 'Human' : only === 'objects' && type === 'Human' ? 'Building' : type);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [source, setSource] = useState(p.fromImage || only ? 'image' : 'describe'); // 3D only: 'describe' (Muse) | 'image' (SAM 3D)
  const [img, setImg] = useState(null);     // { url, alpha }
  const [mask, setMask] = useState(null);   // data URL
  const [textured, setTextured] = useState(false);
  // SAM 3D Body only rebuilds people, so the category picks the model.
  const samKind = kind === 'Human' ? 'body' : 'objects';
  async function pickImage(e) {
    const f = e.target.files[0]; if (!f) return;
    const url = await readFile(f);
    // Does the picture already carry a cut-out (any transparent pixel)?
    const alpha = await new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = Math.min(256, im.width); c.height = Math.round(im.height * c.width / im.width); const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height); const d = x.getImageData(0, 0, c.width, c.height).data; let t = false; for (let i = 3; i < d.length; i += 4) if (d[i] < 200) { t = true; break; } res(t); }; im.onerror = () => res(false); im.src = url; });
    setImg({ url, alpha }); if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  }
  const imageMode = is3d && source === 'image';
  const PH = {
    characters: ['e.g. Lia the ferry pilot', 'Young woman, oilskin coat, short red hair, confident grin'],
    backgrounds: ['e.g. Cliff Path at Night', 'Windswept cliff path, moonlight, rain, painterly'],
    music: ['e.g. storm_theme.mp3', 'Slow, minor key, tense, loopable'],
    Building: ['e.g. Watchtower', 'Stone watchtower with a wooden roof and a flag'],
    Human: ['e.g. Blacksmith', 'Burly blacksmith in a leather apron holding a hammer'],
    Prop: ['e.g. Treasure Chest', 'Wooden chest with gold trim and an iron lock'],
  }[kind];
  const kinds = (is3d ? [['Building', 'Building', 'ph-house'], ['Human', 'Human', 'ph-person'], ['Prop', 'Prop', 'ph-lamp']] : [['characters', 'Character', 'ph-user'], ['backgrounds', 'Background', 'ph-image'], ['music', 'Music', 'ph-music-note']])
    .filter(([id]) => only !== 'body' || id === 'Human').filter(([id]) => only !== 'objects' || id !== 'Human');
  function go() {
    if (imageMode) {
      if (!img) return notify('Pick an image first.', true);
      if (samKind === 'objects' && !img.alpha && !mask) return notify('SAM 3D Objects needs a cut-out — add a mask, or use a PNG with a transparent background.', true);
      const nm = name.trim() || 'Scan ' + uid().slice(0, 3);
      setDialog(null);
      return toPng(img.url, 1024, 1024).then(image => makeFromImage({ name: nm, cat: kind, image, mask, textured, kind: samKind }));
    }
    if (!ensureAI()) { setDialog(null); return; }
    let nm = name.trim() || 'Untitled ' + uid().slice(0, 3);
    if (kind === 'music' && !/\.\w+$/.test(nm)) nm = slug(nm) + '.mp3';
    const exists = { characters: game.characters, backgrounds: game.backgrounds, music: game.music }[kind] || game.assets3d;
    if (exists.some(x => x.name === nm)) return notify('An asset named “' + nm + '” already exists.', true);
    setDialog(null); setTab(kind);
    if (is3d) return make3d({ name: nm, cat: kind, prompt: desc, budget: 28 });
    update(g => {
      if (kind === 'characters') g.characters.unshift({ name: nm, role: 'Minor', desc });
      if (kind === 'backgrounds') g.backgrounds.unshift({ name: nm, desc });
      if (kind === 'music') g.music.unshift({ name: nm, mood: desc });
      return g;
    }, true);
    (kind === 'characters' ? paintChar : kind === 'backgrounds' ? paintBg : compose)(nm, desc);
  }
  return html`<div class="backdrop" onClick=${onClose}><div class="dialog" style="width:440px" onClick=${e => e.stopPropagation()}>
    <div class="row"><i class=${'ph ' + (only === 'body' ? 'ph-person' : 'ph-magic-wand')} style="color:var(--color-accent);font-size:18px"></i><span class="dialog-title">${only === 'body' ? 'New character from an image' : only === 'objects' ? 'New building or prop from an image' : is3d ? 'Create 3D asset' : 'Create 2D asset'}</span><div style="flex:1"></div><button class="btn btn-ghost btn-icon" onClick=${onClose}><i class="ph ph-x"></i></button></div>
    ${kinds.length > 1 && html`<div class="seg" style="align-self:flex-start">${kinds.map(([id, l, icon]) => html`<button class=${'seg-opt' + (kind === id ? ' on' : '')} onClick=${() => setKind(id)}><i class=${'ph ' + icon}></i>${l}</button>`)}</div>`}
    ${is3d && !only && html`<div class="tabs"><button class=${source === 'describe' ? 'on' : ''} onClick=${() => setSource('describe')}><i class="ph ph-text-aa"></i>Describe it · Muse Spark</button><button class=${source === 'image' ? 'on' : ''} onClick=${() => setSource('image')}><i class="ph ph-image"></i>From image · SAM 3D</button></div>`}
    <div class="field"><label>Name</label><input class="input" value=${name} placeholder=${PH[0]} onInput=${e => setName(e.target.value)} /></div>
    ${imageMode ? html`
      <div class="row"><span class="label" style="flex:1">Meta model</span>
        <span class="tag tag-meta"><i class=${'ph ' + (samKind === 'body' ? 'ph-person' : 'ph-cube')}></i>${samKind === 'body' ? 'SAM 3D Body · people only' : 'SAM 3D Objects · buildings & props'}</span></div>
      ${!only && html`<span class="muted" style="font-size:11px;margin-top:-6px">${samKind === 'body' ? 'SAM 3D Body only rebuilds people. Pick Building or Prop to use SAM 3D Objects.' : 'People use SAM 3D Body: pick Human for a person.'}</span>`}
      <div class="field"><label>${samKind === 'body' ? 'Photo or drawing of one person' : 'Image of one object'}</label><input class="input" type="file" accept="image/png,image/webp,image/jpeg" onChange=${pickImage} /></div>
      ${img && html`<div class="row" style="align-items:flex-start">
        <img src=${img.url} alt="" style="width:96px;height:96px;object-fit:contain;border-radius:8px;background:repeating-conic-gradient(#3f424d 0 25%,#292b31 0 50%) 0 0/16px 16px" />
        <span class="stack" style="gap:4px;font-size:12px;flex:1">${img.alpha ? html`<span><i class="ph ph-check-circle" style="color:#4ade80"></i> Transparent background found — it will be used as the mask.</span>` : samKind === 'body' ? html`<span class="muted">No cut-out needed for SAM 3D Body — one person filling most of the picture works best.</span>` : html`<span style="color:var(--color-danger)">No transparent background. Add a mask (white = object) or upload a PNG cut-out.</span>`}
          <label class="label">Mask (optional)<input class="input" type="file" accept="image/png" onChange=${async e => { const f = e.target.files[0]; setMask(f ? await readFile(f) : null); }} /></label></span>
      </div>`}
      ${samKind === 'objects' && html`<label class="check"><input type="checkbox" checked=${textured} onChange=${e => setTextured(e.target.checked)} />Bake a texture (sharper, slower) instead of vertex colours</label>`}
      <div class="note"><i class="ph ph-cube" style="color:var(--color-meta)"></i><span style="flex:1">${samKind === 'body' ? 'SAM 3D Body rebuilds the person as a posed 3D body mesh (no clothes or texture). Runs on your own GPU.' : 'SAM 3D Objects reconstructs a full textured mesh. Needs a 32 GB+ Linux GPU service.'}</span></div>` : html`
      <div class="field"><label>${kind === 'music' ? 'Mood' : 'Prompt'}</label><textarea class="input" value=${desc} placeholder=${PH[1]} onInput=${e => setDesc(e.target.value)}></textarea></div>
      <div class="note"><i class="ph ph-sparkle" style="color:var(--color-meta)"></i><span style="flex:1">${kind === 'music' ? 'Meta AI composes a loopable melody that plays in-game.' : is3d ? 'Meta AI builds the model from 3D primitives; export as .glb.' : 'Meta AI paints this as vector art (SVG) — crisp at any size.'}</span></div>`}
    <div class="dialog-actions"><button class="btn btn-secondary" onClick=${onClose}>Cancel</button><button class="btn btn-solid" onClick=${go}><i class="ph ph-sparkle"></i>Create</button></div>
  </div></div>`;
}

function PlayerOverlay({ game, onClose }) {
  const ref = useRef();
  useEffect(() => { FP.boot(ref.current, game); const k = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return html`<div class="player-overlay"><button class="btn btn-secondary player-close" onClick=${onClose}><i class="ph ph-x"></i>Close (Esc)</button><div class="frame" ref=${ref}></div></div>`;
}

render(html`<${App} />`, document.getElementById('root'));
