// Asset pack: every asset in the project in standard formats, zipped, ready
// for Blender, Unity, Godot or Unreal. No libraries: a small "stored" zip writer
// and an OfflineAudioContext render for music.
import { forgeSynth, trackSeq } from './coder.js';

// ---------- zip (store, no compression; GLB/PNG are already compressed) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const enc = new TextEncoder();
export function zip(files) {
  const parts = [], central = []; let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, 0, true);
    head.setUint16(10, time, true); head.setUint16(12, date, true); head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true);
    parts.push(head.buffer, name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, time, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(cen.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// ---------- helpers ----------
const fileName = s => String(s || 'asset').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'asset';
function dataUrlBytes(url) {
  const m = String(url).match(/^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s); if (!m) return null;
  const b64 = /;base64/i.test(m[2]);
  const bytes = b64 ? Uint8Array.from(atob(m[3]), c => c.charCodeAt(0)) : enc.encode(decodeURIComponent(m[3]));
  return { bytes, mime: (m[1] || 'application/octet-stream').toLowerCase() };
}
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
function toPngBytes(url, w, h) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); const s = Math.min(w / img.width, h / img.height) || 1; c.width = Math.round(img.width * s) || w; c.height = Math.round(img.height * s) || h; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : res(null), 'image/png'); };
    img.onerror = () => res(null); img.src = url;
  });
}

// Renders a composed track to a 16-bit WAV (two loops, at most 60 s).
async function renderWav(seq) {
  const beat = 60 / Math.max(40, Math.min(200, seq.bpm || 90));
  const loop = (seq.notes || []).reduce((s, n) => s + beat * (Number(n[1]) || 1), 0) || 8;
  const seconds = Math.min(60, Math.max(4, loop * 2)), rate = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination);
  forgeSynth(ctx, master, seq, { t: 0.02, idx: 0, bar: 0, inBar: 0 }, seconds - beat * 4);
  const pcm = (await ctx.startRendering()).getChannelData(0);
  const v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Uint8Array(v.buffer);
}

const README = (game, counts) => `${game.title} — asset pack from Game Forge (made with Meta AI)

models/       ${counts.models} 3D models as .glb (glTF 2.0 binary). Units are metres, Y is up,
              each model stands on the ground (y = 0) centred on the origin.
characters/   ${counts.characters} character images (.svg vector art and .png, or your uploads)
backgrounds/  ${counts.backgrounds} background images (.svg and .png)
music/        ${counts.music} tracks as .wav (composed by Meta AI) or your uploaded audio
project/      the Game Forge project (.gameforge.json) — open it in Game Forge with Open
games/        playable novels: the 2D novel${counts.code ? ' and the 3D novel built by Meta AI' : ''} (.html, open in a browser)

Using the 3D models
- Blender: File > Import > glTF 2.0 (.glb/.gltf).
- Godot 4: copy the .glb files into your project folder; they import automatically.
- Unity: install the glTFast package (Package Manager > Add package by name: com.unity.cloud.gltfast),
  then drag the .glb files into Assets.
- Unreal Engine 5: drag the .glb files into the Content Browser (Interchange importer).
  Unreal works in centimetres; the importer converts metres for you.
SAM 3D Body models are posed, untextured body meshes: a base to dress up or a stand-in.
`;

// exportGLB(asset) → Blob; storyHtml / codeHtml → strings (or null).
export async function assetPack(game, FP, { exportGLB, storyHtml, codeHtml, project, onStage }) {
  const files = [], counts = { models: 0, characters: 0, backgrounds: 0, music: 0, code: !!codeHtml };
  const used = new Set(); const unique = n => { let k = n, i = 2; while (used.has(k.toLowerCase())) k = n.replace(/(\.[^.]+)$/, ` ${i++}$1`); used.add(k.toLowerCase()); return k; };
  const add = (name, data) => files.push({ name: unique(name), data });

  for (const a of game.assets3d || []) {
    if (a.busy || !(a.glb || (a.parts || []).length)) continue;
    onStage && onStage('Exporting ' + a.name + '…');
    try { add(`models/${fileName(a.name)}.glb`, new Uint8Array(await (await exportGLB(a)).arrayBuffer())); counts.models++; } catch (e) { /* skip */ }
  }
  for (const [dir, list, url, w, h] of [['characters', game.characters || [], n => FP.charUrl(game, n), 1024, 2048], ['backgrounds', game.backgrounds || [], n => FP.bgUrl(game, n), 1920, 1080]]) {
    for (const x of list) {
      onStage && onStage('Exporting ' + x.name + '…');
      const u = url(x.name), d = dataUrlBytes(u);
      if (d && d.mime !== 'image/svg+xml') add(`${dir}/${fileName(x.name)}.${EXT[d.mime] || 'img'}`, d.bytes);
      else { if (d) add(`${dir}/${fileName(x.name)}.svg`, d.bytes); const png = await toPngBytes(u, w, h); if (png) add(`${dir}/${fileName(x.name)}.png`, png); }
      counts[dir]++;
    }
  }
  for (const t of game.music || []) {
    onStage && onStage('Rendering ' + t.name + '…');
    const base = fileName(String(t.name).replace(/\.[a-z0-9]+$/i, ''));
    try {
      const d = t.src && dataUrlBytes(t.src);
      if (d) add(`music/${base}.${EXT[d.mime] || 'audio'}`, d.bytes);
      else add(`music/${base}.wav`, await renderWav(trackSeq(t, FP)));
      counts.music++;
    } catch (e) { /* skip */ }
  }
  const slug = fileName(game.title).toLowerCase().replace(/\s+/g, '_');
  add(`project/${slug}.gameforge.json`, project);
  if (storyHtml) add(`games/${slug}-2d-novel.html`, storyHtml);
  if (codeHtml) add(`games/${slug}-3d-novel.html`, codeHtml);
  add('README.txt', README(game, counts));
  return { blob: zip(files), counts };
}
