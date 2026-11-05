// Community: people post visual novels, play each other's, and like or dislike
// them. Likes and dislikes build each account's taste profile, which orders the
// "For you" list. No dependencies: novels are single .html files in
// data/community and everything else is JSON.
//
// Accounts: passwords are stored as scrypt hashes, and sign-in is an HttpOnly
// cookie, so page scripts and novels can never read it. Voting, posting,
// reporting and saving to an account all need one. Reading and playing do not.
//
// Moderation: signed-in people can report a novel. COMMUNITY_HIDE_AT different
// reports hide it until an admin (COMMUNITY_ADMINS) keeps it, removes it or
// bans whoever posted it.
//
// Uploaded novels are untrusted code. The Community page runs them in an iframe
// with the sandbox attribute and no allow-same-origin: they get a throwaway
// origin, with no access to this site's storage or cookies. Their page also
// starts with a Content-Security-Policy, so they cannot send data anywhere.
// /community/play/:id sends the same rules as headers, so opening that address
// directly is just as locked down.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const DIR = path.resolve(process.env.COMMUNITY_DIR || path.join(__dirname, 'data', 'community'));
const DB = path.join(DIR, 'db.json');
const NOVELS = path.join(DIR, 'novels');
const SAVES = path.join(DIR, 'saves');
const MAX_HTML = 50 * 1024 * 1024;
const MAX_COVER = 400 * 1024;
const MAX_SAVE = 600 * 1024;
const MAX_NOVELS = 1000;
const POSTS_PER_DAY = 20;
const SESSION_DAYS = 30;
const MODES = ['2D', '3D'];
const REASONS = ['Sexual content', 'Violence or gore', 'Hate or harassment', 'Spam or scam', 'Copyright', 'Harmful code', 'Other'];
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'gameforge', 'anonymous', 'meta', 'system', 'support'];
const HIDE_AT = () => Math.max(1, Number(process.env.COMMUNITY_HIDE_AT) || 3);
const ADMINS = () => String(process.env.COMMUNITY_ADMINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

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
  fs.mkdirSync(SAVES, { recursive: true });
  try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) { db = {}; }
  db.novels = Array.isArray(db.novels) ? db.novels : [];
  db.reactions = db.reactions && typeof db.reactions === 'object' ? db.reactions : {};
  db.users = Array.isArray(db.users) ? db.users : [];
  db.sessions = db.sessions && typeof db.sessions === 'object' ? db.sessions : {};
  db.novels.forEach(n => { n.reports = Array.isArray(n.reports) ? n.reports : []; });
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

// ---------- accounts ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
async function hashPassword(password, salt) { return (await scrypt(password.normalize('NFKC'), salt, 64)).toString('hex'); }
const FAKE_SALT = crypto.randomBytes(16).toString('hex');

// A small sliding window, so guessing passwords or mass sign-ups get cut off.
const windows = new Map();
function limited(key, max, ms) {
  const now = Date.now(), recent = (windows.get(key) || []).filter(t => now - t < ms);
  windows.set(key, recent);
  return recent.length >= max;
}
const hit = key => { const list = windows.get(key) || []; list.push(Date.now()); windows.set(key, list); };

function readCookie(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)gf_session=([a-f0-9]{64})/);
  return m ? m[1] : null;
}
function userOf(req) {
  const token = readCookie(req); if (!token) return null;
  const s = db.sessions[sha(token)];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.sessions[sha(token)]; return null; }
  const user = db.users.find(u => u.id === s.user);
  return user && !user.banned ? user : null;
}
const isAdmin = user => !!user && ADMINS().includes(user.key);
const publicUser = user => (user ? { name: user.name, admin: isAdmin(user) } : null);
function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (s.expires < now) delete db.sessions[k];
  db.sessions[sha(token)] = { user: user.id, expires: now + SESSION_DAYS * 864e5 };
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
}
function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COMMUNITY_HTTPS === '1';
  return `gf_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function signup(req, res, body, send, local) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (limited('signup:' + ip, 10, 36e5)) return send(res, 429, { error: 'Too many new accounts from here. Try again later.' });
  const name = String(body.name || '').trim(), password = String(body.password || ''), key = name.toLowerCase();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(name)) return send(res, 400, { error: 'Usernames are 3 to 24 letters, numbers, - or _.' });
  if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Passwords need at least 8 characters.' });
  const adminName = ADMINS().includes(key);
  if (adminName ? !local : RESERVED.includes(key)) return send(res, 400, { error: 'That username is not available.' });
  if (db.users.some(u => u.key === key)) return send(res, 409, { error: 'That username is taken.' });
  hit('signup:' + ip);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  if (db.users.some(u => u.key === key)) return send(res, 409, { error: 'That username is taken.' });
  const user = { id: crypto.randomBytes(8).toString('hex'), name, key, salt, hash, createdAt: Date.now() };
  db.users.push(user);
  startSession(req, res, user);
  await save();
  send(res, 201, { user: publicUser(user) });
}
async function login(req, res, body, send) {
  const name = String(body.name || '').trim(), key = name.toLowerCase(), password = String(body.password || '');
  const ip = req.socket.remoteAddress || 'unknown', limitKey = 'login:' + ip + ':' + key;
  if (limited(limitKey, 8, 9e5)) return send(res, 429, { error: 'Too many tries. Wait 15 minutes and try again.' });
  const user = db.users.find(u => u.key === key);
  // Same work whether or not the name exists, so timing does not reveal it.
  const attempt = Buffer.from(await hashPassword(password, user ? user.salt : FAKE_SALT), 'hex');
  const good = !!user && crypto.timingSafeEqual(attempt, Buffer.from(user.hash, 'hex'));
  if (!good) { hit(limitKey); return send(res, 401, { error: 'Wrong username or password.' }); }
  if (user.banned) return send(res, 403, { error: 'This account has been banned.' });
  startSession(req, res, user);
  await save();
  send(res, 200, { user: publicUser(user) });
}

// ---------- taste ----------
function tally(id) {
  const votes = Object.values(db.reactions[id] || {});
  return { likes: votes.filter(v => v > 0).length, dislikes: votes.filter(v => v < 0).length };
}
const add = (map, key, by) => { map[key] = (map[key] || 0) + by; };

// What this person likes and dislikes, learned from their reactions.
function profileOf(user) {
  const tags = {}, modes = {}, authors = {};
  let liked = 0, disliked = 0;
  if (user) for (const n of db.novels) {
    const v = (db.reactions[n.id] || {})[user.id];
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
  return { score, why: best ? best.why : null };
}

function publicNovel(n, user, profile) {
  const { likes, dislikes } = tally(n.id);
  const f = fit(n, profile);
  return {
    id: n.id, title: n.title, author: n.author, description: n.description, tags: n.tags, mode: n.mode, cover: n.cover,
    createdAt: n.createdAt, plays: n.plays, size: n.size, likes, dislikes, hidden: !!n.hidden,
    mine: !!user && n.owner === user.id, reaction: user ? (db.reactions[n.id] || {})[user.id] || 0 : 0,
    reported: !!user && n.reports.some(r => r.user === user.id), score: f.score, why: f.why,
  };
}

function list(user) {
  const profile = profileOf(user), admin = isAdmin(user);
  const novels = db.novels.filter(n => !n.hidden || admin || (user && n.owner === user.id)).map(n => publicNovel(n, user, profile));
  const { tagWeights, modeWeights, authorWeights, ...taste } = profile;
  return { novels, taste, user: publicUser(user), reasons: REASONS, reports: admin ? db.novels.filter(n => n.reports.length).length : 0 };
}

function publish(body, user) {
  if (db.novels.length >= MAX_NOVELS) return [507, { error: 'The community library is full.' }];
  if (limited('post:' + user.id, POSTS_PER_DAY, 864e5)) return [429, { error: 'That is enough posts for one day. Try again tomorrow.' }];
  const title = clean(body.title, 80), html = typeof body.html === 'string' ? body.html : '';
  if (!title) return [400, { error: 'Give your novel a title.' }];
  if (!/<!doctype html|<html[\s>]/i.test(html.slice(0, 4096))) return [400, { error: 'That is not an HTML novel.' }];
  if (Buffer.byteLength(html) > MAX_HTML) return [413, { error: 'That novel is over the 50 MB limit.' }];
  const cover = typeof body.cover === 'string' && body.cover.length <= MAX_COVER && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(body.cover) ? body.cover : '';
  const id = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(NOVELS, id + '.html'), html);
  const novel = {
    id, title, author: user.name, description: clean(body.description, 500), tags: cleanTags(body.tags),
    mode: MODES.includes(body.mode) ? body.mode : '2D', cover, owner: user.id, createdAt: Date.now(), plays: 0, size: Buffer.byteLength(html), reports: [],
  };
  hit('post:' + user.id);
  db.novels.unshift(novel);
  db.reactions[id] = {};
  return [201, publicNovel(novel, user, profileOf(user))];
}

function removeNovel(novel) {
  db.novels = db.novels.filter(n => n !== novel);
  delete db.reactions[novel.id];
  fs.rm(path.join(NOVELS, novel.id + '.html'), { force: true }, () => {});
  fs.readdir(SAVES, (err, files) => { if (!err) files.filter(f => f.endsWith('-' + novel.id + '.json')).forEach(f => fs.rm(path.join(SAVES, f), { force: true }, () => {})); });
}

const saveFile = (user, id) => path.join(SAVES, user.id + '-' + id + '.json');

async function sendPlay(res, id, user) {
  const novel = db.novels.find(n => n.id === id);
  const blocked = novel && novel.hidden && !isAdmin(user) && !(user && novel.owner === user.id);
  let html = null;
  if (novel && !blocked) { try { html = await fs.promises.readFile(path.join(NOVELS, id + '.html'), 'utf8'); } catch (e) { html = null; } }
  if (html === null) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PLAY_CSP,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  });
  res.end(guarded(html));
}

// Returns true when it answered the request.
async function handle(req, res, send, readBody, env) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  load();
  if (parts[0] === 'community' && parts[1] === 'play' && /^[a-f0-9]{16}$/.test(parts[2] || '') && req.method === 'GET') { await sendPlay(res, parts[2], userOf(req)); return true; }
  if (parts[0] !== 'api' || parts[1] !== 'community') return false;
  const user = userOf(req), resource = parts[2], id = parts[3], action = parts[4], method = req.method;
  const json = async limit => {
    try { return JSON.parse(await readBody(req, limit)); }
    catch (e) { send(res, /large/i.test(e.message) ? 413 : 400, { error: /large/i.test(e.message) ? 'That is over the size limit.' : 'Invalid request.' }); return null; }
  };
  const needUser = () => { if (user) return true; send(res, 401, { error: 'Sign in first.', signIn: true }); return false; };

  if (resource === 'signup' && method === 'POST') { const b = await json(4096); if (b) await signup(req, res, b, send, !!(env && env.local)); return true; }
  if (resource === 'login' && method === 'POST') { const b = await json(4096); if (b) await login(req, res, b, send); return true; }
  if (resource === 'logout' && method === 'POST') {
    const token = readCookie(req); if (token) delete db.sessions[sha(token)];
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    await save(); send(res, 200, { ok: true }); return true;
  }

  if (resource === 'novels' && !id && method === 'GET') { send(res, 200, list(user)); return true; }
  if (resource === 'novels' && !id && method === 'POST') {
    if (!needUser()) return true;
    const body = await json(MAX_HTML * 1.4 + MAX_COVER); if (!body) return true;
    const [status, data] = publish(body, user);
    if (status < 300) await save();
    send(res, status, data); return true;
  }

  // Saves for one novel, kept with the account so they follow the player.
  if (resource === 'saves' && /^[a-f0-9]{16}$/.test(id || '')) {
    if (!needUser()) return true;
    if (!db.novels.some(n => n.id === id)) { send(res, 404, { error: 'That novel is gone.' }); return true; }
    if (method === 'GET') {
      let data = {}; try { data = JSON.parse(await fs.promises.readFile(saveFile(user, id), 'utf8')); } catch (e) { /* no save yet */ }
      send(res, 200, { saves: data }); return true;
    }
    if (method === 'PUT') {
      const body = await json(MAX_SAVE); if (!body) return true;
      if (!body.saves || typeof body.saves !== 'object' || Array.isArray(body.saves)) { send(res, 400, { error: 'Invalid save.' }); return true; }
      await fs.promises.writeFile(saveFile(user, id), JSON.stringify(body.saves));
      send(res, 200, { ok: true }); return true;
    }
  }

  if (resource === 'moderation') {
    if (!needUser()) return true;
    if (!isAdmin(user)) { send(res, 403, { error: 'Admins only.' }); return true; }
    if (method === 'GET') {
      const names = Object.fromEntries(db.users.map(u => [u.id, u.name]));
      send(res, 200, { queue: db.novels.filter(n => n.reports.length).map(n => ({ id: n.id, title: n.title, author: n.author, mode: n.mode, hidden: !!n.hidden, reports: n.reports.map(r => ({ by: names[r.user] || 'unknown', reason: r.reason, note: r.note, at: r.at })) })) });
      return true;
    }
    if (method === 'POST') {
      const body = await json(4096); if (!body) return true;
      const novel = db.novels.find(n => n.id === body.novel);
      if (!novel) { send(res, 404, { error: 'That novel is gone.' }); return true; }
      if (body.action === 'keep') { novel.reports = []; novel.hidden = false; }
      else if (body.action === 'remove') removeNovel(novel);
      else if (body.action === 'ban') {
        const owner = db.users.find(u => u.id === novel.owner);
        if (isAdmin(owner)) { send(res, 400, { error: 'Admins cannot be banned here.' }); return true; }
        if (owner) { owner.banned = true; for (const [k, s] of Object.entries(db.sessions)) if (s.user === owner.id) delete db.sessions[k]; }
        db.novels.filter(n => n.owner === novel.owner).forEach(removeNovel);
      } else { send(res, 400, { error: 'Unknown action.' }); return true; }
      await save();
      send(res, 200, list(user)); return true;
    }
  }

  const novel = db.novels.find(n => n.id === id);
  const visible = novel && (!novel.hidden || isAdmin(user) || (user && novel.owner === user.id));
  if (resource === 'novels' && id && !visible) { send(res, 404, { error: 'That novel is gone.' }); return true; }
  if (resource === 'novels' && !action && method === 'DELETE') {
    if (!needUser()) return true;
    if (novel.owner !== user.id && !isAdmin(user)) { send(res, 403, { error: 'Only the person who posted a novel can remove it.' }); return true; }
    removeNovel(novel);
    await save();
    send(res, 200, { ok: true }); return true;
  }
  if (resource === 'novels' && action === 'react' && method === 'POST') {
    if (!needUser()) return true;
    const body = await json(1024); if (!body) return true;
    const value = [1, -1, 0].includes(body.value) ? body.value : null;
    if (value === null) { send(res, 400, { error: 'A reaction is 1, -1 or 0.' }); return true; }
    if (value) db.reactions[id][user.id] = value; else delete db.reactions[id][user.id];
    await save();
    send(res, 200, list(user)); return true;
  }
  if (resource === 'novels' && action === 'report' && method === 'POST') {
    if (!needUser()) return true;
    const body = await json(4096); if (!body) return true;
    if (!REASONS.includes(body.reason)) { send(res, 400, { error: 'Pick a reason.' }); return true; }
    if (novel.owner === user.id) { send(res, 400, { error: 'You cannot report your own novel.' }); return true; }
    if (novel.reports.some(r => r.user === user.id)) { send(res, 409, { error: 'You already reported this novel.' }); return true; }
    novel.reports.push({ user: user.id, reason: body.reason, note: clean(body.note, 500), at: Date.now() });
    if (novel.reports.length >= HIDE_AT()) novel.hidden = true;
    await save();
    send(res, 200, list(user)); return true;
  }
  if (resource === 'novels' && action === 'play' && method === 'POST') {
    novel.plays++;
    await save();
    send(res, 200, { plays: novel.plays }); return true;
  }
  send(res, 404, { error: 'Not found' });
  return true;
}

module.exports = { handle };
