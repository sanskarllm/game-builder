// The Community API on an isolated server with its own temporary data folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ALICE = 'a'.repeat(32), BOB = 'b'.repeat(32);
const HTML = '<!DOCTYPE html><html><body>novel</body></html>';
let server, base, dir;

const free = () => new Promise(res => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => res(port)); }); });
async function api(method, url, body, viewer, headers = {}) {
  const r = await fetch(base + '/api/community/' + url, { method, headers: { 'Content-Type': 'application/json', ...(viewer ? { 'X-Forge-Viewer': viewer } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const post = (viewer, over) => api('POST', 'novels', { title: 'A novel', author: 'Ana', tags: ['mystery'], mode: '2D', html: HTML, ...over }, viewer);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-community-'));
  const port = await free();
  base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPEN_BROWSER: '0', COMMUNITY_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/status'); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('server did not start');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('rejects posts that are not novels', async () => {
  assert.equal((await post(ALICE, { title: '' })).status, 400);
  assert.equal((await post(ALICE, { html: 'just text' })).status, 400);
  assert.equal((await post(undefined)).status, 400);
});

test('a posted novel plays inside a sandbox that blocks storage and network', async () => {
  const { status, body } = await post(ALICE, { title: 'Sandboxed' });
  assert.equal(status, 201);
  assert.ok(!('owner' in body));
  const r = await fetch(base + '/community/play/' + body.id);
  assert.equal(r.status, 200);
  const page = await r.text();
  assert.ok(page.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"'));
  assert.ok(page.includes('<body>novel</body>'));
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts allow-pointer-lock/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src data: blob: https:\/\/cdn\.jsdelivr\.net/);
  assert.equal((await fetch(base + '/community/play/0000000000000000')).status, 404);
  const sneaky = await new Promise(res => http.get(base + '/community/play/..%2f..%2fserver.js', r => { r.resume(); res(r.statusCode); }));
  assert.notEqual(sneaky, 200);
});

test('likes and dislikes toggle, and each person has one vote', async () => {
  const { body: n } = await post(ALICE, { title: 'Votes' });
  await api('POST', `novels/${n.id}/react`, { value: 1 }, ALICE);
  await api('POST', `novels/${n.id}/react`, { value: 1 }, ALICE);
  const two = await api('POST', `novels/${n.id}/react`, { value: -1 }, BOB);
  let row = two.body.novels.find(x => x.id === n.id);
  assert.deepEqual([row.likes, row.dislikes, row.reaction], [1, 1, -1]);
  const cleared = await api('POST', `novels/${n.id}/react`, { value: 0 }, BOB);
  row = cleared.body.novels.find(x => x.id === n.id);
  assert.deepEqual([row.likes, row.dislikes, row.reaction], [1, 0, 0]);
  assert.equal((await api('POST', `novels/${n.id}/react`, { value: 5 }, BOB)).status, 400);
});

test('the taste profile learns likes and dislikes and orders recommendations', async () => {
  const viewer = 'c'.repeat(32);
  const horror = (await post(ALICE, { title: 'Haunted', author: 'Hal', tags: ['horror', 'dark'] })).body;
  const romance = (await post(ALICE, { title: 'Love', author: 'Rae', tags: ['romance', 'cozy'], mode: '3D' })).body;
  const moreRomance = (await post(ALICE, { title: 'More love', author: 'Rae', tags: ['romance'], mode: '3D' })).body;
  const moreHorror = (await post(ALICE, { title: 'Scream', author: 'Hal', tags: ['horror'] })).body;
  await api('POST', `novels/${romance.id}/react`, { value: 1 }, viewer);
  const { body } = await api('POST', `novels/${horror.id}/react`, { value: -1 }, viewer);
  assert.deepEqual(body.taste.likes.map(t => t.name).sort(), ['cozy', 'romance']);
  assert.deepEqual(body.taste.dislikes.map(t => t.name).sort(), ['dark', 'horror']);
  assert.equal(body.taste.favouriteMode, '3D');
  assert.equal(body.taste.favouriteAuthors[0].name, 'Rae');
  const score = id => body.novels.find(n => n.id === id);
  assert.ok(score(moreRomance.id).score > 0);
  assert.ok(score(moreHorror.id).score < 0);
  assert.ok(score(moreRomance.id).score > score(moreHorror.id).score);
  assert.equal(score(moreRomance.id).why, 'Because you like romance');
  const stranger = await api('GET', 'novels', undefined, 'd'.repeat(32));
  assert.equal(stranger.body.taste.liked, 0);
  assert.equal(stranger.body.novels.find(n => n.id === moreRomance.id).score, 0);
});

test('only the owner can remove a novel, and the file goes too', async () => {
  const { body: n } = await post(ALICE, { title: 'Mine' });
  assert.equal((await api('DELETE', 'novels/' + n.id, undefined, BOB)).status, 403);
  assert.equal((await api('DELETE', 'novels/' + n.id, undefined, ALICE)).status, 200);
  assert.equal((await fetch(base + '/community/play/' + n.id)).status, 404);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(fs.existsSync(path.join(dir, 'novels', n.id + '.html')), false);
});

test('other websites cannot post, and viewer ids are not stored in the clear', async () => {
  const blocked = await api('POST', 'novels', { title: 'x', html: HTML }, ALICE, { Origin: 'https://evil.example' });
  assert.equal(blocked.status, 403);
  const nullOrigin = await api('POST', 'novels', { title: 'x', html: HTML }, ALICE, { Origin: 'null' });
  assert.equal(nullOrigin.status, 403);
  assert.ok(fs.readFileSync(path.join(dir, 'db.json'), 'utf8').includes('"Votes"'));
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), new RegExp(ALICE));
});

test('a large novel posts, and one over the limit is refused', async () => {
  const big = '<!DOCTYPE html><html><body>' + 'x'.repeat(20 * 1024 * 1024) + '</body></html>';
  const ok = await post(ALICE, { title: 'Big', html: big });
  assert.equal(ok.status, 201);
  assert.equal((await fetch(base + '/community/play/' + ok.body.id)).status, 200);
  const tooBig = await post(ALICE, { title: 'Too big', html: '<!DOCTYPE html>' + 'x'.repeat(51 * 1024 * 1024) });
  assert.equal(tooBig.status, 413);
});

test('plays are counted', async () => {
  const { body: n } = await post(ALICE, { title: 'Played' });
  await api('POST', `novels/${n.id}/play`, {}, BOB);
  assert.equal((await api('POST', `novels/${n.id}/play`, {}, BOB)).body.plays, 2);
});
