// Game Forge — local server.
// Serves the editor from ./public and proxies AI calls to Meta AI models:
// Muse Spark on Meta Model API by default, or Meta Llama on any
// OpenAI-compatible host.
// No dependencies: run with `node server.js` (Node 18+).

const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));
const community = require('./community');

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_BASE = 'https://api.meta.ai/v1';
const ENV_BASE = (process.env.MODEL_BASE_URL || process.env.LLAMA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const ENV_KEY = process.env.MODEL_API_KEY || process.env.LLAMA_API_KEY || '';
const ENV_MODEL = process.env.MODEL_NAME || process.env.LLAMA_MODEL || 'muse-spark-1.1';
const PUBLIC = path.join(__dirname, 'public');
// Default: the SAM 3D service running on this PC (sam3d-service/server.py).
const ENV_SAM3D_URL = (process.env.SAM3D_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const ENV_SAM3D_TOKEN = process.env.SAM3D_TOKEN || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* no .env — fine */ }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Pull the text out of either response shape: OpenAI-compatible
// (choices[0].message.content, used by Meta Model API) or Meta's native Llama API
// (completion_message.content.text).
function extractText(data) {
  if (data && Array.isArray(data.choices) && data.choices[0]) {
    const c = data.choices[0].message && data.choices[0].message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(p => p.text || '').join('');
  }
  const cm = data && data.completion_message;
  if (cm) {
    if (typeof cm.content === 'string') return cm.content;
    if (cm.content && typeof cm.content.text === 'string') return cm.content.text;
    if (Array.isArray(cm.content)) return cm.content.map(p => p.text || '').join('');
  }
  return '';
}

async function handleChat(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'Invalid JSON body' }); }
  const base = String(body.baseUrl || ENV_BASE).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return send(res, 400, { error: 'Base URL must start with http(s)://' });
  // The server's own key is only ever sent to the server's own configured host.
  const key = body.apiKey || (base === ENV_BASE ? ENV_KEY : '');
  // Reasoning models (Muse Spark) count thinking toward the output budget and
  // take max_completion_tokens + reasoning_effort; Llama hosts take max_tokens.
  const reasoning = !!body.reasoning;
  // Full game code (Muse Wonder) asks for up to 26k tokens; everything else stays small.
  const maxTokens = Math.min(Number(body.maxTokens) || 2048, 26000);
  const payload = {
    model: body.model || ENV_MODEL,
    messages: Array.isArray(body.messages) ? body.messages : [],
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
  };
  if (reasoning) {
    payload.max_completion_tokens = Math.min(maxTokens + 6000, 32000);
    if (body.reasoningEffort) payload.reasoning_effort = body.reasoningEffort;
  } else payload.max_tokens = maxTokens;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;

  const started = Date.now();
  const call = p => fetch(base + '/chat/completions', {
    method: 'POST', headers, body: JSON.stringify(p), signal: AbortSignal.timeout(maxTokens > 8192 ? 900000 : 240000),
  });
  try {
    let r = await call(payload);
    let raw = await r.text();
    // A host that rejects an optional parameter gets one retry with the bare minimum.
    if (r.status === 400 && /max_tokens|max_completion_tokens|reasoning_effort|temperature|unsupported|unrecognized|unknown/i.test(raw)) {
      r = await call({ model: payload.model, messages: payload.messages });
      raw = await r.text();
    }
    let data; try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!r.ok) {
      const msg = (data && (data.error && (data.error.message || data.error) || data.detail || data.message)) || raw.slice(0, 400);
      return send(res, r.status, { error: `Meta AI provider returned ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}` });
    }
    const text = extractText(data);
    if (!text) return send(res, 502, { error: 'Meta AI provider returned no text (the reply may have run out of tokens while reasoning).' });
    const finish = data && data.choices && data.choices[0] && data.choices[0].finish_reason;
    send(res, 200, { text, finish, model: (data && data.model) || payload.model, ms: Date.now() - started, usage: data && data.usage });
  } catch (e) {
    send(res, 502, { error: 'Could not reach ' + base + ' — ' + (e.name === 'TimeoutError' ? 'request timed out' : e.message) });
  }
}

// 2D novel artwork uses Meta's image endpoint independently of the chat model.
const IMAGE_BASE = (process.env.MODEL_IMAGE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const imageType = b => (b[0] === 0xff ? 'image/jpeg' : b[0] === 0x89 ? 'image/png' : 'image/webp');
async function handleImage(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Invalid JSON body' }); }
  if (typeof body?.prompt !== 'string' || !body.prompt.trim()) return send(res, 400, { error: 'An image prompt is required.' });
  const key = body.apiKey || (ENV_BASE === DEFAULT_BASE && ENV_KEY);
  if (!key) return send(res, 401, { error: 'Muse Image needs a Meta Model API key. Select Meta Model API in settings and add your key, or configure the Meta endpoint and MODEL_API_KEY on the server.' });
  try {
    const call = payload => fetch(IMAGE_BASE + '/images/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(180000),
    });
    const bare = { model: 'muse-image-1.0', prompt: body.prompt };
    let response = await call({ ...bare, size: body.size, response_format: 'b64_json', output_format: 'webp' });
    // A rejected optional setting gets one retry with just the model and prompt.
    if (response.status === 400 || response.status === 422) response = await call(bare);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return send(res, response.status, { error: result.error?.message || result.detail || 'Muse Image returned HTTP ' + response.status });
    const item = result.data?.[0];
    if (typeof item?.b64_json === 'string' && item.b64_json) return send(res, 200, { image: 'data:' + imageType(Buffer.from(item.b64_json.slice(0, 32), 'base64')) + ';base64,' + item.b64_json });
    if (typeof item?.url === 'string' && /^https?:/.test(item.url)) {
      const picture = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
      if (!picture.ok) return send(res, 502, { error: 'Could not download the image from Muse Image (HTTP ' + picture.status + ').' });
      const bytes = Buffer.from(await picture.arrayBuffer());
      return send(res, 200, { image: 'data:' + imageType(bytes) + ';base64,' + bytes.toString('base64') });
    }
    send(res, 502, { error: 'Muse Image returned no image.' });
  } catch (error) { send(res, 502, { error: 'Muse Image request failed: ' + error.message }); }
}

// Lists the models this key can use (GET {base}/models), e.g. every Muse model
// on Meta Model API. Body: { baseUrl?, apiKey? }
async function handleModels(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, 400, { error: 'Invalid JSON body' }); }
  const base = String(body.baseUrl || ENV_BASE).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return send(res, 400, { error: 'Base URL must start with http(s)://' });
  const key = body.apiKey || (base === ENV_BASE ? ENV_KEY : '');
  try {
    const r = await fetch(base + '/models', { headers: key ? { Authorization: 'Bearer ' + key } : {}, signal: AbortSignal.timeout(20000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return send(res, r.status, { error: `Model list returned ${r.status}: ${(data.error && (data.error.message || data.error)) || data.detail || ''}` });
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    send(res, 200, { models: list.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).sort() });
  } catch (e) { send(res, 502, { error: 'Could not reach ' + base + ' — ' + e.message }); }
}

// SAM 3D Body / SAM 3D Objects (Meta) — forwards an image to the GPU service
// in ./sam3d-service and streams the .glb back. Body: { action: 'health' |
// 'reconstruct', serviceUrl?, token?, kind?: 'body'|'objects', image: dataURL, mask?, seed?, textured? }
async function handleSam3d(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req, 60 * 1024 * 1024)); } catch (e) { return send(res, 400, { error: 'Invalid request: ' + e.message }); }
  // A model started with the Start buttons in 3D Assets takes the request first.
  const local = ENGINES[body.kind] && ENGINES[body.kind].proc ? engineUrl(ENGINES[body.kind]) : '';
  const base = String(local || body.serviceUrl || ENV_SAM3D_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return send(res, 400, { error: 'Set the SAM 3D Objects service URL in the Meta AI tab (or SAM3D_URL in .env).' });
  const token = local ? ENV_SAM3D_TOKEN : body.token || (base === ENV_SAM3D_URL ? ENV_SAM3D_TOKEN : '');
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  try {
    if (body.action === 'health') {
      const r = await fetch(base + '/health', { headers, signal: AbortSignal.timeout(20000) });
      const data = await r.json().catch(() => ({}));
      return send(res, r.ok ? 200 : r.status, r.ok ? data : { error: data.detail || 'Service answered ' + r.status });
    }
    const toBlob = url => { const m = String(url || '').match(/^data:([^;]+);base64,(.*)$/); return m ? new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }) : null; };
    const image = toBlob(body.image);
    if (!image) return send(res, 400, { error: 'No image was sent.' });
    const form = new FormData();
    form.append('image', image, 'image.png');
    const mask = toBlob(body.mask); if (mask) form.append('mask', mask, 'mask.png');
    if (body.kind) form.append('kind', String(body.kind));
    form.append('seed', String(Number(body.seed) || 42));
    form.append('format', 'glb');
    form.append('textured', body.textured ? '1' : '0');
    const r = await fetch(base + '/reconstruct', { method: 'POST', headers, body: form, signal: AbortSignal.timeout(15 * 60 * 1000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) {
      let msg = buf.toString('utf8').slice(0, 400); try { msg = JSON.parse(msg).detail || msg; } catch (e) {}
      return send(res, r.status, { error: 'SAM 3D Objects: ' + msg });
    }
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store', 'X-Pose': r.headers.get('x-pose') || '{}', 'X-Seconds': r.headers.get('x-seconds') || '' });
    res.end(buf);
  } catch (e) {
    send(res, 502, { error: 'Could not reach the SAM 3D Objects service at ' + base + ' — ' + (e.name === 'TimeoutError' ? 'request timed out' : e.message) });
  }
}

// ---------- Start / stop the SAM 3D services from the app ----------
// The 3D Assets view has Start buttons for SAM 3D Body (characters, port 8000)
// and SAM 3D Objects (buildings & props, port 8001). Each runs
// sam3d-service/server.py as a child process of this server.
const { spawn, execFile } = require('child_process');
const os = require('os');
const SAM_DIR = path.join(__dirname, 'sam3d-service');
const VENV_PY = process.platform === 'win32'
  ? path.join(os.homedir(), 'sam3d', '.venv', 'Scripts', 'python.exe')
  : path.join(os.homedir(), 'sam3d', '.venv', 'bin', 'python');
const ENGINES = {
  body: {
    label: 'SAM 3D Body', port: Number(process.env.SAM3D_BODY_PORT) || 8000,
    python: process.env.SAM3D_BODY_PYTHON || VENV_PY,
    repo: process.env.SAM3D_BODY_REPO || path.join(SAM_DIR, 'sam-3d-body'),
    check: e => fs.existsSync(e.python) && fs.existsSync(path.join(e.repo, 'sam_3d_body')),
    missing: 'SAM 3D Body is not installed yet. Run sam3d-service\\install-body.bat once, then press Start.',
    env: e => ({ SAM3D_BODY_REPO: e.repo, SAM3D_BODY_HF: process.env.SAM3D_BODY_HF || 'facebook/sam-3d-body-dinov3', SAM3D_BODY_FOV: process.env.SAM3D_BODY_FOV || 'moge2' }),
  },
  objects: {
    label: 'SAM 3D Objects', port: Number(process.env.SAM3D_OBJECTS_PORT) || 8001,
    python: process.env.SAM3D_OBJECTS_PYTHON || '',
    repo: process.env.SAM3D_OBJECTS_REPO || '',
    check: e => !!(e.python && e.repo) && fs.existsSync(e.python) && fs.existsSync(path.join(e.repo, 'checkpoints', 'hf', 'pipeline.yaml')),
    missing: 'SAM 3D Objects is not installed on this PC. It needs Linux and a 32 GB+ NVIDIA GPU: run it on a cloud GPU and enter its URL under Meta AI → SAM 3D, or set SAM3D_OBJECTS_REPO and SAM3D_OBJECTS_PYTHON in .env on a machine that has one.',
    env: e => ({ SAM3D_OBJECTS_REPO: e.repo }),
  },
};
for (const e of Object.values(ENGINES)) Object.assign(e, { proc: null, log: [], error: '', startedAt: 0 });

function engineUrl(e) { return 'http://127.0.0.1:' + e.port; }
async function engineHealth(e) {
  try {
    const r = await fetch(engineUrl(e) + '/health', { headers: ENV_SAM3D_TOKEN ? { Authorization: 'Bearer ' + ENV_SAM3D_TOKEN } : {}, signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch (err) { return null; }
}
async function engineStatus(kind) {
  const e = ENGINES[kind];
  const h = await engineHealth(e);
  let state = 'stopped';
  if (h && (h.kinds || []).includes(kind)) state = h.error ? 'error' : (h.loaded || []).includes(kind) || h.mode === 'fake' ? 'ready' : 'starting';
  else if (h) state = 'other';            // something else is answering on that port
  else if (e.proc) state = 'starting';    // process is up, web server not listening yet
  else if (e.error) state = 'error';
  return {
    kind, label: e.label, port: e.port, url: engineUrl(e), installed: e.check(e), missing: e.missing,
    managed: !!e.proc, state, error: (h && h.error) || (state === 'error' ? e.error : ''),
    gpu: h && h.gpu, vram: h && h.vram_used_gb, seconds: e.proc ? Math.round((Date.now() - e.startedAt) / 1000) : 0,
    log: e.log.slice(-8),
  };
}
function killTree(proc, wait) {
  if (!proc) return;
  const args = ['/pid', String(proc.pid), '/T', '/F'];
  if (process.platform !== 'win32') { try { proc.kill('SIGTERM'); } catch (err) { /* already gone */ } return; }
  if (wait) { try { require('child_process').execFileSync('taskkill', args, { stdio: 'ignore' }); } catch (err) { /* already gone */ } }
  else execFile('taskkill', args, () => {});
}
async function startEngine(kind) {
  const e = ENGINES[kind];
  const now = await engineStatus(kind);
  if (['ready', 'starting'].includes(now.state)) return now;
  if (now.state === 'other') throw new Error(`Port ${e.port} is already used by another program. Close it, or set SAM3D_${kind.toUpperCase()}_PORT in .env.`);
  if (!now.installed) throw new Error(e.missing);
  e.log = []; e.error = ''; e.startedAt = Date.now();
  const env = { ...process.env, ...e.env(e), SAM3D_ONLY: kind, SAM3D_PRELOAD: '1', HOST: '127.0.0.1', PORT: String(e.port),
    PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_XET: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' };
  const proc = spawn(e.python, [path.join(SAM_DIR, 'server.py')], { cwd: kind === 'objects' ? e.repo : SAM_DIR, env, windowsHide: true });
  e.proc = proc;
  const keep = buf => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      const t = line.trim(); if (!t) continue;
      e.log.push(t); if (e.log.length > 60) e.log.shift();
      process.stdout.write(`[${e.label}] ${t}\n`);
    }
  };
  proc.stdout.on('data', keep); proc.stderr.on('data', keep);
  proc.on('error', err => { e.error = err.message; e.proc = null; });
  proc.on('exit', code => {
    if (e.proc !== proc) return;
    e.proc = null;
    if (!e.stopping && code) e.error = `${e.label} stopped (exit code ${code}). ` + (e.log.filter(l => /error|failed|exception/i.test(l)).slice(-1)[0] || e.log.slice(-1)[0] || '');
    e.stopping = false;
  });
  return engineStatus(kind);
}
async function handleEngines(req, res) {
  try {
    if (req.method === 'GET') return send(res, 200, { engines: await Promise.all(Object.keys(ENGINES).map(engineStatus)) });
    const body = JSON.parse(await readBody(req) || '{}');
    const e = ENGINES[body.kind];
    if (!e) return send(res, 400, { error: 'Unknown SAM 3D engine: ' + body.kind });
    if (body.action === 'start') return send(res, 200, await startEngine(body.kind));
    if (body.action === 'stop') {
      if (!e.proc) {
        const s = await engineStatus(body.kind);
        return send(res, s.state === 'stopped' ? 200 : 409, s.state === 'stopped' ? s : { error: `${e.label} was started outside Game Forge (for example with start-body.bat). Close that window to stop it.` });
      }
      e.stopping = true; e.error = ''; killTree(e.proc); e.proc = null;
      return send(res, 200, { ...(await engineStatus(body.kind)), state: 'stopped' });
    }
    send(res, 400, { error: 'action must be start or stop' });
  } catch (err) { send(res, 400, { error: err.message }); }
}
// Stop the services we started when Game Forge itself stops.
const stopAll = () => { for (const e of Object.values(ENGINES)) if (e.proc) { e.stopping = true; killTree(e.proc, true); e.proc = null; } };
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { stopAll(); setTimeout(() => process.exit(0), 300); });

function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { return send(res, 400, 'Invalid URL', 'text/plain'); }
  if (p.includes('\0')) return send(res, 400, 'Invalid URL', 'text/plain');
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  const relative = path.relative(PUBLIC, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

// Requests that change something must come from this site's own pages, so a
// website you happen to visit (or a sandboxed novel) cannot use these routes.
function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}
const onThisPC = req => /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');

http.createServer(async (req, res) => {
  if (req.method !== 'GET' && !sameSite(req)) return send(res, 403, { error: 'Forbidden' });
  try { if (await community.handle(req, res, send, readBody)) return; }
  catch (e) { console.error('Community error:', e); return send(res, 500, { error: 'The community server hit an error.' }); }
  // If this server is opened up to other people (HOST=0.0.0.0) they only get
  // the Community: the AI, key and GPU routes stay on this PC.
  if (!onThisPC(req)) {
    if (req.url.startsWith('/api/')) return send(res, 403, { error: 'Only available on this computer.' });
    if (req.url === '/' || req.url.startsWith('/index.html')) { res.writeHead(302, { Location: '/community.html' }); return res.end(); }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/status')) {
    return send(res, 200, { hasServerKey: !!ENV_KEY, baseUrl: ENV_BASE, model: ENV_MODEL, sam3dUrl: ENV_SAM3D_URL });
  }
  if (req.method === 'POST' && req.url.startsWith('/api/chat')) return handleChat(req, res);
  if (req.method === 'POST' && req.url.startsWith('/api/models')) return handleModels(req, res);
  if (req.method === 'POST' && req.url === '/api/image') return handleImage(req, res);
  if (req.url.startsWith('/api/sam3d/engines')) return handleEngines(req, res);
  if (req.method === 'POST' && req.url.startsWith('/api/sam3d')) return handleSam3d(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: 'Method not allowed' });
}).listen(PORT, HOST, () => {
  console.log(`Game Forge running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Meta AI endpoint: ${ENV_BASE} · model ${ENV_MODEL} · server key ${ENV_KEY ? 'set' : 'not set (add one in the app or in .env)'}`);
  // start-game-forge.bat sets OPEN_BROWSER=1 so the page opens once we are listening.
  if (process.env.OPEN_BROWSER === '1') {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    try { require('child_process').spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* open it by hand */ }
  }
});
