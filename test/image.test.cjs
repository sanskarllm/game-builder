// The /api/image route, against a local stand-in for Meta's image server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP = Buffer.from('RIFFxxxxWEBPVP8 ');
const seen = [];
let upstream, server, base;

const free = () => new Promise(res => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => res(port)); }); });
const post = (body) => fetch(base + '/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));

before(async () => {
  const up = await free();
  upstream = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw); seen.push({ path: req.url, auth: req.headers.authorization, body });
      const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (body.prompt === 'strict' && body.size) return json(400, { error: { message: 'size is not supported' } });
      if (body.prompt === 'denied') return json(403, { error: { message: 'Muse Image is not enabled' } });
      if (body.prompt === 'empty') return json(200, { data: [{}] });
      json(200, { data: [{ b64_json: (body.output_format ? WEBP : PNG).toString('base64') }] });
    });
  });
  await new Promise(res => upstream.listen(up, '127.0.0.1', res));
  const port = await free();
  base = 'http://127.0.0.1:' + port;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPEN_BROWSER: '0', MODEL_IMAGE_BASE_URL: 'http://127.0.0.1:' + up + '/v1' };
  delete env.MODEL_API_KEY; delete env.LLAMA_API_KEY;
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/status'); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('server did not start');
});
after(() => { server.kill(); upstream.close(); });

test('sends the model, prompt and key, and returns the picture', async () => {
  const r = await post({ apiKey: 'test-key', prompt: 'a harbor', size: '1600x900' });
  assert.equal(r.status, 200);
  assert.ok(r.body.image.startsWith('data:image/webp;base64,'));
  const call = seen.at(-1);
  assert.equal(call.path, '/v1/images/generations');
  assert.equal(call.auth, 'Bearer test-key');
  assert.equal(call.body.model, 'muse-image-1.0');
  assert.equal(call.body.size, '1600x900');
});

test('retries without optional settings and labels the real image type', async () => {
  const r = await post({ apiKey: 'test-key', prompt: 'strict', size: '1600x900' });
  assert.equal(r.status, 200);
  assert.ok(r.body.image.startsWith('data:image/png;base64,'));
  assert.deepEqual(Object.keys(seen.at(-1).body).sort(), ['model', 'prompt']);
});

test('passes on the provider error', async () => {
  const r = await post({ apiKey: 'test-key', prompt: 'denied' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /not enabled/);
});

test('reports a reply with no image', async () => {
  const r = await post({ apiKey: 'test-key', prompt: 'empty' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /no image/);
});

test('needs a prompt and a key', async () => {
  assert.equal((await post({ apiKey: 'test-key' })).status, 400);
  assert.equal((await post({ prompt: 'a harbor' })).status, 401);
});
