// Game Forge — local server.
// Serves the editor from ./public and proxies AI calls to Meta AI models:
// Muse Spark on Meta Model API by default, or Meta Llama on any
// OpenAI-compatible host.
// No dependencies: run with `node server.js` (Node 18+).

const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

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
  const maxTokens = Math.min(Number(body.maxTokens) || 2048, 8192);
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
    method: 'POST', headers, body: JSON.stringify(p), signal: AbortSignal.timeout(240000),
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
    send(res, 200, { text, model: (data && data.model) || payload.model, ms: Date.now() - started, usage: data && data.usage });
  } catch (e) {
    send(res, 502, { error: 'Could not reach ' + base + ' — ' + (e.name === 'TimeoutError' ? 'request timed out' : e.message) });
  }
}

// SAM 3D Body / SAM 3D Objects (Meta) — forwards an image to the GPU service
// in ./sam3d-service and streams the .glb back. Body: { action: 'health' |
// 'reconstruct', serviceUrl?, token?, kind?: 'body'|'objects', image: dataURL, mask?, seed?, textured? }
async function handleSam3d(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req, 60 * 1024 * 1024)); } catch (e) { return send(res, 400, { error: 'Invalid request: ' + e.message }); }
  const base = String(body.serviceUrl || ENV_SAM3D_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return send(res, 400, { error: 'Set the SAM 3D Objects service URL in the Meta AI tab (or SAM3D_URL in .env).' });
  const token = body.token || (base === ENV_SAM3D_URL ? ENV_SAM3D_TOKEN : '');
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

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/api/status')) {
    return send(res, 200, { hasServerKey: !!ENV_KEY, baseUrl: ENV_BASE, model: ENV_MODEL, sam3dUrl: ENV_SAM3D_URL });
  }
  if (req.method === 'POST' && req.url.startsWith('/api/chat')) return handleChat(req, res);
  if (req.method === 'POST' && req.url.startsWith('/api/sam3d')) return handleSam3d(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: 'Method not allowed' });
}).listen(PORT, HOST, () => {
  console.log(`Game Forge running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Meta AI endpoint: ${ENV_BASE} · model ${ENV_MODEL} · server key ${ENV_KEY ? 'set' : 'not set (add one in the app or in .env)'}`);
});
