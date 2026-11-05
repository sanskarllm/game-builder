// Community: people publish visual novels, play each other's, and like or
// dislike them. Likes and dislikes build each viewer's taste profile, which
// orders the "For you" list. No dependencies: novels are single .html files in
// data/community and everything else is one JSON file.
//
// Uploaded novels are untrusted code. The Community page runs them in an iframe
// with the sandbox attribute and no allow-same-origin: they get a throwaway
// origin, with no access to this site's storage, so never an API key. Their
// page also starts with a Content-Security-Policy, so they cannot send data
// anywhere. /community/play/:id sends the same rules as headers, so opening
// that address directly is just as locked down.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.resolve(process.env.COMMUNITY_DIR || path.join(__dirname, 'data', 'community'));
const DB = path.join(DIR, 'db.json');
const NOVELS = path.join(DIR, 'novels');
const MAX_HTML = 50 * 1024 * 1024;
const MAX_COVER = 400 * 1024;
const MAX_NOVELS = 1000;
const MODES = ['2D', '3D'];

const RULES = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  'font-src data: https://fonts.gstatic.com https://cdn.jsdelivr.net',
  'img-src data: blob:',
  'media-src data: blob:',
  'connect-src data: blob: https://cdn.jsdelivr.net',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const PLAY_CSP = 'sandbox allow-scripts allow-pointer-lock; ' + RULES;
const META = `<meta http-equiv="Content-Security-Policy" content="${RULES}">`;
// The rules go first in the document, ahead of anything the author wrote.
const guarded = html => html.replace(/^\s*(<!doctype[^>]*>)?/i, m => m + META);

let db = null;
function load() {
  if (db) return db;
  fs.mkdirSync(NOVELS, { recursive: true });
  try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) { db = {}; }
  db.novels = Array.isArray(db.novels) ? db.novels : [];
  db.reactions = db.reactions && typeof db.reactions === 'object' ? db.reactions : {};
  return db;
}
// Writes one at a time, through a temp file, so a crash cannot corrupt db.json.
let writing = Promise.resolve();
function save() {
  const text = JSON.stringify(db);
  writing = writing.then(async () => {
    const tmp = DB + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, text);
    await fs.promises.rename(tmp, DB);
  }).catch(e => console.error('Community save failed:', e.message));
  return writing;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map(t => clean(t, 24).toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 8);
}
// A viewer is a random id kept in their browser. Only its hash is stored, so
// reading db.json does not let anyone act as them. It is not a login.
function viewerOf(req) {
  const id = String(req.headers['x-forge-viewer'] || '');
  return /^[a-f0-9]{32,64}$/.test(id) ? crypto.createHash('sha256').update(id).digest('hex').slice(0, 32) : null;
}

function tally(id) {
  const votes = Object.values(db.reactions[id] || {});
  return { likes: votes.filter(v => v > 0).length, dislikes: votes.filter(v => v < 0).length };
}
const add = (map, key, by) => { map[key] = (map[key] || 0) + by; };

// What this viewer likes and dislikes, learned from their reactions.
function profileOf(viewer) {
  const tags = {}, modes = {}, authors = {};
  let liked = 0, disliked = 0;
  if (viewer) for (const n of db.novels) {
    const v = (db.reactions[n.id] || {})[viewer];
    if (!v) continue;
    v > 0 ? liked++ : disliked++;
    n.tags.forEach(t => add(tags, t, v));
    add(modes, n.mode, v);
    if (n.author) add(authors, n.author, v);
  }
  const ranked = (map, sign) => Object.entries(map).filter(([, w]) => w * sign > 0).sort((a, b) => (b[1] - a[1]) * sign).map(([name, weight]) => ({ name, weight }));
  return {
    liked, disliked, tagWeights: tags, modeWeights: modes, authorWeights: authors,
    likes: ranked(tags, 1).slice(0, 8), dislikes: ranked(tags, -1).slice(0, 8),
    favouriteAuthors: ranked(authors, 1).slice(0, 4), favouriteMode: ranked(modes, 1)[0]?.name || null,
  };
}

// How well a novel fits a profile, and the reason shown on its card.
function fit(novel, profile) {
  let score = 0, best = null;
  for (const t of novel.tags) {
    const w = profile.tagWeights[t] || 0;
    score += w;
    if (w > 0 && (!best || w > best.w)) best = { w, why: 'Because you like ' + t };
  }
  score /= Math.sqrt(novel.tags.length || 1);
  score += (profile.modeWeights[novel.mode] || 0) * 0.5;
  const a = profile.authorWeights[novel.author] || 0;
  score += a * 0.75;
  if (a > 0 && !best) best = { w: a, why: 'More from ' + novel.author };
  if (profile.tagWeights && novel.tags.some(t => (profile.tagWeights[t] || 0) < 0) && score <= 0) best = null;
  const { likes, dislikes } = tally(novel.id);
  return { score, popularity: (likes - dislikes) / (likes + dislikes + 1), why: best ? best.why : null };
}

function publicNovel(n, viewer, profile) {
  const { likes, dislikes } = tally(n.id);
  const f = fit(n, profile);
  return {
    id: n.id, title: n.title, author: n.author, description: n.description, tags: n.tags, mode: n.mode, cover: n.cover,
    createdAt: n.createdAt, plays: n.plays, size: n.size, likes, dislikes,
    mine: !!viewer && n.owner === viewer, reaction: viewer ? (db.reactions[n.id] || {})[viewer] || 0 : 0,
    score: f.score, why: f.why,
  };
}

function list(viewer) {
  const profile = profileOf(viewer);
  const novels = db.novels.map(n => publicNovel(n, viewer, profile));
  const { tagWeights, modeWeights, authorWeights, ...taste } = profile;
  return { novels, taste };
}

function publish(body, viewer) {
  if (!viewer) return [400, { error: 'This browser has no viewer id. Reload the page and try again.' }];
  if (db.novels.length >= MAX_NOVELS) return [507, { error: 'The community library is full.' }];
  const title = clean(body.title, 80), html = typeof body.html === 'string' ? body.html : '';
  if (!title) return [400, { error: 'Give your novel a title.' }];
  if (!/<!doctype html|<html[\s>]/i.test(html.slice(0, 4096))) return [400, { error: 'That is not an HTML novel.' }];
  if (Buffer.byteLength(html) > MAX_HTML) return [413, { error: 'That novel is over the 50 MB limit.' }];
  const cover = typeof body.cover === 'string' && body.cover.length <= MAX_COVER && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(body.cover) ? body.cover : '';
  const id = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(NOVELS, id + '.html'), html);
  const novel = {
    id, title, author: clean(body.author, 40) || 'Anonymous', description: clean(body.description, 500), tags: cleanTags(body.tags),
    mode: MODES.includes(body.mode) ? body.mode : '2D', cover, owner: viewer, createdAt: Date.now(), plays: 0, size: Buffer.byteLength(html),
  };
  db.novels.unshift(novel);
  db.reactions[id] = {};
  return [201, publicNovel(novel, viewer, profileOf(viewer))];
}

async function sendPlay(res, id) {
  const novel = db.novels.find(n => n.id === id);
  if (!novel) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  let html;
  try { html = await fs.promises.readFile(path.join(NOVELS, id + '.html'), 'utf8'); }
  catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PLAY_CSP,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  });
  res.end(guarded(html));
}

// Returns true when it answered the request.
async function handle(req, res, send, readBody) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  load();
  if (parts[0] === 'community' && parts[1] === 'play' && /^[a-f0-9]{16}$/.test(parts[2] || '') && req.method === 'GET') { await sendPlay(res, parts[2]); return true; }
  if (parts[0] !== 'api' || parts[1] !== 'community') return false;
  const viewer = viewerOf(req), resource = parts[2], id = parts[3], action = parts[4];
  const json = async limit => { try { return JSON.parse(await readBody(req, limit)); } catch (e) { send(res, /large/i.test(e.message) ? 413 : 400, { error: /large/i.test(e.message) ? 'That novel is over the 50 MB limit.' : 'Invalid request.' }); return null; } };

  if (resource === 'novels' && !id && req.method === 'GET') { send(res, 200, list(viewer)); return true; }
  if (resource === 'novels' && !id && req.method === 'POST') {
    const body = await json(MAX_HTML * 1.4 + MAX_COVER); if (!body) return true;
    const [status, data] = publish(body, viewer);
    if (status < 300) await save();
    send(res, status, data); return true;
  }
  const novel = db.novels.find(n => n.id === id);
  if (resource === 'novels' && id && !novel) { send(res, 404, { error: 'That novel is gone.' }); return true; }
  if (resource === 'novels' && !action && req.method === 'DELETE') {
    if (!viewer || novel.owner !== viewer) { send(res, 403, { error: 'Only the person who posted a novel can remove it.' }); return true; }
    db.novels = db.novels.filter(n => n !== novel);
    delete db.reactions[id];
    fs.rm(path.join(NOVELS, id + '.html'), { force: true }, () => {});
    await save();
    send(res, 200, { ok: true }); return true;
  }
  if (resource === 'novels' && action === 'react' && req.method === 'POST') {
    if (!viewer) { send(res, 400, { error: 'This browser has no viewer id.' }); return true; }
    const body = await json(1024); if (!body) return true;
    const value = [1, -1, 0].includes(body.value) ? body.value : null;
    if (value === null) { send(res, 400, { error: 'A reaction is 1, -1 or 0.' }); return true; }
    if (value) db.reactions[id][viewer] = value; else delete db.reactions[id][viewer];
    await save();
    send(res, 200, list(viewer)); return true;
  }
  if (resource === 'novels' && action === 'play' && req.method === 'POST') {
    novel.plays++;
    await save();
    send(res, 200, { plays: novel.plays }); return true;
  }
  send(res, 404, { error: 'Not found' });
  return true;
}

module.exports = { handle };
