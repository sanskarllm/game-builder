// /api/infinity against a local stand-in for the chat API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { shapePart, shapeNext, parse } = require('../infinity');

const story = { title: 'Harbor', logline: 'Fog.', characters: [{ name: 'Mira', desc: 'keeper' }], locations: [{ name: 'Pier', desc: 'wood' }, { name: 'Tower', desc: 'stone' }] };
const memory = { likes: ['romance'], dislikes: ['gore'], summary: 'Mira lit the lamp.' };
const scene = { title: 'Dawn', location: 'Pier', chars: [{ name: 'Mira', expr: 'calm', pos: 'C' }, { name: 'Ghost', pos: 'L' }], lines: [{ who: 'Mira', text: 'It is over.' }] };
const seen = [];
let reply = () => JSON.stringify({ scene, memory });
let upstream, server, base, dir;

const free = () => new Promise(res => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => res(port)); }); });
const post = body => fetch(base + '/api/infinity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));

before(async () => {
  const up = await free();
  upstream = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: reply(seen.length) } }] }));
    });
  });
  await new Promise(res => upstream.listen(up, '127.0.0.1', res));
  const port = await free();
  base = 'http://127.0.0.1:' + port;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-infinity-'));
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPEN_BROWSER: '0', COMMUNITY_DIR: dir, MODEL_API_KEY: 'server-key', MODEL_BASE_URL: `http://127.0.0.1:${up}/v1`, MODEL_NAME: 'muse-spark-1.1' } });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/status'); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('server did not start');
});
after(() => { server.kill(); upstream.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('writes the next scene from what the player typed, and tells the model what it learned', async () => {
  reply = () => JSON.stringify({ scene, memory });
  const r = await post({ mode: 'next', action: 'I kiss the stranger', story, memory: { likes: ['mystery'] }, path: [{ scene: 'Start', gist: 'Fog rolled in.', did: 'Stay' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.scene.title, 'Dawn');
  assert.deepEqual(r.body.memory.likes, ['romance']);
  const text = seen.at(-1).body.messages[1].content;
  assert.match(text, /I kiss the stranger/);
  assert.match(text, /This player likes: mystery/);
  assert.match(text, /Player did: "Stay"/);
});

test('characters the story does not know are dropped from the stage', async () => {
  const r = shapeNext({ scene, memory }, { story });
  assert.deepEqual(r.scene.chars.map(c => c.name), ['Mira']);
  const added = shapeNext({ scene, memory, newCharacters: [{ name: 'Ghost', desc: 'pale' }] }, { story });
  assert.deepEqual(added.scene.chars.map(c => c.name), ['Mira', 'Ghost']);
});

test('an unknown location falls back to one that exists', () => {
  const r = shapeNext({ scene: { ...scene, location: 'Moon' }, memory }, { story, lastLocation: 'Tower' });
  assert.equal(r.scene.bg, 'Tower');
});

test('a chapter has working links, reachable scenes and an ending', () => {
  const s = (id, choices) => ({ id, title: id, location: 'Pier', lines: [{ who: 'Narrator', text: id }], choices });
  const r = shapePart({ title: 'Part', memory, scenes: [
    s('start', [{ text: 'Go', to: 'b' }, { text: 'Broken', to: 'missing' }, { text: 'Loop', to: 'start' }]),
    s('b', [{ text: 'Back', to: 'start' }]),
    s('island', [{ text: 'Nowhere', to: 'b' }]),
  ] }, { story });
  assert.deepEqual(r.scenes.map(x => x.title), ['start', 'b']);
  assert.deepEqual(r.scenes[0].choices.map(c => c.text), ['Go']);
  assert.equal(r.scenes[1].choices.length, 0);
});

test('a bad reply is retried, then reported', async () => {
  reply = n => (seen.length % 2 ? 'Sorry, here is a story' : JSON.stringify({ scene, memory }));
  seen.length = 0;
  const ok = await post({ mode: 'next', story });
  assert.equal(ok.status, 200);
  assert.equal(seen.length, 2);
  reply = () => 'never json';
  const bad = await post({ mode: 'next', story });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /Try again/);
});

test('reads JSON wrapped in fences or chatter', () => {
  assert.deepEqual(parse('```json\n{"a":1,}\n```'), { a: 1 });
  assert.deepEqual(parse('Here you go: {"a":1} enjoy'), { a: 1 });
  assert.equal(parse('nothing here'), null);
});

test('the server key is never sent to an address from the request', async () => {
  reply = () => JSON.stringify({ scene, memory });
  seen.length = 0;
  const r = await post({ mode: 'next', story, baseUrl: 'http://127.0.0.1:9/evil' });
  assert.equal(r.status, 200);
  assert.equal(seen[0].auth, 'Bearer server-key');
});

test('a player using their own key sends that key, not the server one', async () => {
  seen.length = 0;
  await post({ mode: 'next', story, apiKey: 'my-key', model: 'muse-wonder-1.0' });
  assert.equal(seen[0].auth, 'Bearer my-key');
  assert.equal(seen[0].body.model, 'muse-wonder-1.0');
});

test('other sites and unknown modes are refused', async () => {
  assert.equal((await post({ mode: 'hack', story })).status, 400);
  const r = await fetch(base + '/api/infinity', { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'next', story }) });
  assert.equal(r.status, 403);
});

test('use of the server key is limited per visitor', async () => {
  reply = () => JSON.stringify({ scene, memory });
  let status = 200;
  for (let i = 0; i < 70 && status === 200; i++) status = (await post({ mode: 'next', story })).status;
  assert.equal(status, 429);
  assert.equal((await post({ mode: 'next', story, apiKey: 'my-key' })).status, 200);
});
