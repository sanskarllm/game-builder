// The Community API on an isolated server with its own temporary data folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HTML = '<!DOCTYPE html><html><body>novel</body></html>';
let server, base, dir, ana, ben, cat, dan, boss;
let n = 0;

const free = () => new Promise(res => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => res(port)); }); });
async function api(method, url, body, cookie, headers = {}) {
  const r = await fetch(base + '/api/community/' + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], setCookie: r.headers.get('set-cookie') || '', body: await r.json() };
}
const account = async name => (await api('POST', 'signup', { name, password: 'correct horse' })).cookie;
const post = (cookie, over) => api('POST', 'novels', { title: 'Novel ' + ++n, tags: ['mystery'], mode: '2D', html: HTML, ...over }, cookie);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-community-'));
  const port = await free();
  base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPEN_BROWSER: '0', COMMUNITY_DIR: dir, COMMUNITY_ADMINS: 'boss' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/status'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  [ana, ben, cat, dan, boss] = await Promise.all(['ana', 'ben', 'cat', 'dan', 'boss'].map(account));
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('accounts: rules, and passwords are never stored in the clear', async () => {
  assert.equal((await api('POST', 'signup', { name: 'x', password: 'long enough' })).status, 400);
  assert.equal((await api('POST', 'signup', { name: 'valid', password: 'short' })).status, 400);
  assert.equal((await api('POST', 'signup', { name: 'bad name!', password: 'long enough' })).status, 400);
  assert.equal((await api('POST', 'signup', { name: 'ANA', password: 'long enough' })).status, 409);
  assert.equal((await api('POST', 'signup', { name: 'Admin', password: 'long enough' })).status, 400);
  const db = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.doesNotMatch(db, /correct horse/);
  assert.equal(JSON.parse(db).users.every(u => u.hash.length === 128 && u.salt.length === 32), true);
});

test('sign-in: cookie is HttpOnly and SameSite, wrong passwords fail, sign out ends it', async () => {
  const good = await api('POST', 'login', { name: 'ana', password: 'correct horse' });
  assert.equal(good.status, 200);
  assert.match(good.setCookie, /HttpOnly/);
  assert.match(good.setCookie, /SameSite=Strict/);
  assert.equal((await api('GET', 'novels', undefined, good.cookie)).body.user.name, 'ana');
  assert.equal((await api('POST', 'login', { name: 'ana', password: 'wrong' })).status, 401);
  assert.equal((await api('POST', 'login', { name: 'nobody', password: 'wrong' })).status, 401);
  await api('POST', 'logout', {}, good.cookie);
  assert.equal((await api('GET', 'novels', undefined, good.cookie)).body.user, null);
});

test('repeated wrong passwords get locked out', async () => {
  await account('locked');
  let status;
  for (let i = 0; i < 9; i++) status = (await api('POST', 'login', { name: 'locked', password: 'nope' })).status;
  assert.equal(status, 429);
});

test('guests can browse and play, but voting, posting and reporting need an account', async () => {
  const { body: novel } = await post(ana);
  assert.equal((await api('GET', 'novels')).status, 200);
  assert.equal((await fetch(base + '/community/play/' + novel.id)).status, 200);
  assert.equal((await post(undefined)).status, 401);
  assert.equal((await api('POST', `novels/${novel.id}/react`, { value: 1 })).status, 401);
  assert.equal((await api('POST', `novels/${novel.id}/report`, { reason: 'Other' })).status, 401);
});

test('a forged cookie gets nowhere', async () => {
  const { body: novel } = await post(ana);
  const fake = 'gf_session=' + 'a'.repeat(64);
  assert.equal((await api('POST', `novels/${novel.id}/react`, { value: 1 }, fake)).status, 401);
});

test('rejects posts that are not novels, and the author is always the account', async () => {
  assert.equal((await post(ana, { title: '' })).status, 400);
  assert.equal((await post(ana, { html: 'just text' })).status, 400);
  const { body } = await post(ana, { author: 'Someone Famous' });
  assert.equal(body.author, 'ana');
});

test('a posted novel plays inside a sandbox that blocks storage and network', async () => {
  const { status, body } = await post(ana, { title: 'Sandboxed' });
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
  assert.equal((await fetch(base + '/community/play/0000000000000000')).status, 404);
  const sneaky = await new Promise(res => http.get(base + '/community/play/..%2f..%2fserver.js', x => { x.resume(); res(x.statusCode); }));
  assert.notEqual(sneaky, 200);
});

test('one vote per account, however many times they sign in', async () => {
  const { body: novel } = await post(ana);
  const second = (await api('POST', 'login', { name: 'ben', password: 'correct horse' })).cookie;
  await api('POST', `novels/${novel.id}/react`, { value: 1 }, ben);
  await api('POST', `novels/${novel.id}/react`, { value: 1 }, second);
  let row = (await api('GET', 'novels', undefined, ben)).body.novels.find(x => x.id === novel.id);
  assert.equal(row.likes, 1);
  row = (await api('POST', `novels/${novel.id}/react`, { value: -1 }, second)).body.novels.find(x => x.id === novel.id);
  assert.deepEqual([row.likes, row.dislikes, row.reaction], [0, 1, -1]);
  assert.equal((await api('POST', `novels/${novel.id}/react`, { value: 5 }, ben)).status, 400);
});

test('the taste profile belongs to the account and orders recommendations', async () => {
  const viewer = await account('viewer');
  const horror = (await post(ana, { tags: ['horror', 'dark'] })).body;
  const romance = (await post(dan, { tags: ['romance', 'cozy'], mode: '3D' })).body;
  const moreRomance = (await post(dan, { tags: ['romance'], mode: '3D' })).body;
  const moreHorror = (await post(ana, { tags: ['horror'] })).body;
  await api('POST', `novels/${romance.id}/react`, { value: 1 }, viewer);
  await api('POST', `novels/${horror.id}/react`, { value: -1 }, viewer);
  // A new sign-in, as if on another device, sees the same profile.
  const elsewhere = (await api('POST', 'login', { name: 'viewer', password: 'correct horse' })).cookie;
  const { body } = await api('GET', 'novels', undefined, elsewhere);
  assert.deepEqual(body.taste.likes.map(t => t.name).sort(), ['cozy', 'romance']);
  assert.deepEqual(body.taste.dislikes.map(t => t.name).sort(), ['dark', 'horror']);
  assert.equal(body.taste.favouriteMode, '3D');
  assert.equal(body.taste.favouriteAuthors[0].name, 'dan');
  const score = id => body.novels.find(x => x.id === id);
  assert.ok(score(moreRomance.id).score > 0);
  assert.ok(score(moreHorror.id).score < score(moreRomance.id).score);
  assert.equal(score(moreRomance.id).why, 'Because you like romance');
  assert.equal((await api('GET', 'novels')).body.taste.liked, 0);
});

test('only the owner or an admin can remove a novel', async () => {
  const { body: novel } = await post(ana);
  assert.equal((await api('DELETE', 'novels/' + novel.id, undefined, ben)).status, 403);
  assert.equal((await api('DELETE', 'novels/' + novel.id, undefined)).status, 401);
  assert.equal((await api('DELETE', 'novels/' + novel.id, undefined, ana)).status, 200);
  assert.equal((await fetch(base + '/community/play/' + novel.id)).status, 404);
  const other = (await post(ana)).body;
  assert.equal((await api('DELETE', 'novels/' + other.id, undefined, boss)).status, 200);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(fs.existsSync(path.join(dir, 'novels', novel.id + '.html')), false);
});

test('reporting: one each, not your own, three hide it, admins decide', async () => {
  const { body: novel } = await post(ana, { title: 'Reported' });
  const report = (cookie, reason = 'Spam or scam') => api('POST', `novels/${novel.id}/report`, { reason, note: 'junk' }, cookie);
  assert.equal((await report(ana)).status, 400);
  assert.equal((await report(ben, 'Because')).status, 400);
  assert.equal((await report(ben)).status, 200);
  assert.equal((await report(ben)).status, 409);
  await report(cat);
  assert.equal((await api('GET', 'novels')).body.novels.some(x => x.id === novel.id), true);
  await report(dan);
  assert.equal((await api('GET', 'novels')).body.novels.some(x => x.id === novel.id), false);
  assert.equal((await fetch(base + '/community/play/' + novel.id)).status, 404);
  assert.equal((await api('GET', 'novels', undefined, ana)).body.novels.find(x => x.id === novel.id).hidden, true);
  assert.equal((await api('GET', 'moderation', undefined, ben)).status, 403);
  assert.equal((await api('POST', 'moderation', { novel: novel.id, action: 'keep' }, ben)).status, 403);
  const queue = (await api('GET', 'moderation', undefined, boss)).body.queue.find(x => x.id === novel.id);
  assert.deepEqual(queue.reports.map(r => r.by).sort(), ['ben', 'cat', 'dan']);
  assert.equal((await fetch(base + '/community/play/' + novel.id, { headers: { Cookie: boss } })).status, 200);
  await api('POST', 'moderation', { novel: novel.id, action: 'keep' }, boss);
  assert.equal((await api('GET', 'novels')).body.novels.some(x => x.id === novel.id), true);
  assert.equal((await api('GET', 'moderation', undefined, boss)).body.queue.some(x => x.id === novel.id), false);
});

test('a ban removes the author, their novels and their sessions', async () => {
  const bad = await account('badactor');
  const one = (await post(bad)).body, two = (await post(bad)).body;
  await api('POST', `novels/${one.id}/report`, { reason: 'Harmful code' }, ben);
  assert.equal((await api('POST', 'moderation', { novel: one.id, action: 'ban' }, boss)).status, 200);
  const left = (await api('GET', 'novels')).body.novels.map(x => x.id);
  assert.equal(left.includes(one.id) || left.includes(two.id), false);
  assert.equal((await post(bad)).status, 401);
  assert.equal((await api('POST', 'login', { name: 'badactor', password: 'correct horse' })).status, 403);
});

test('saves belong to the account and follow it, and stay private', async () => {
  const { body: novel } = await post(ana);
  const saves = { 'forge-save:1': { auto: { scene: 's3', line: 2 } } };
  assert.equal((await api('PUT', 'saves/' + novel.id, { saves })).status, 401);
  assert.equal((await api('PUT', 'saves/' + novel.id, { saves }, ben)).status, 200);
  const elsewhere = (await api('POST', 'login', { name: 'ben', password: 'correct horse' })).cookie;
  assert.deepEqual((await api('GET', 'saves/' + novel.id, undefined, elsewhere)).body.saves, saves);
  assert.deepEqual((await api('GET', 'saves/' + novel.id, undefined, cat)).body.saves, {});
  assert.equal((await api('PUT', 'saves/' + novel.id, { saves: [1] }, ben)).status, 400);
  assert.equal((await api('PUT', 'saves/' + novel.id, { saves: { big: 'x'.repeat(700 * 1024) } }, ben)).status, 413);
  assert.equal((await api('GET', 'saves/..%2f..%2fdb', undefined, ben)).status, 404);
});

test('other websites and sandboxed novels cannot use the account', async () => {
  for (const Origin of ['https://evil.example', 'null']) {
    assert.equal((await api('POST', 'novels', { title: 'x', html: HTML }, ana, { Origin })).status, 403);
    assert.equal((await api('POST', 'login', { name: 'ana', password: 'correct horse' }, undefined, { Origin })).status, 403);
  }
});

test('a large novel posts, and one over the limit is refused', async () => {
  const big = '<!DOCTYPE html><html><body>' + 'x'.repeat(20 * 1024 * 1024) + '</body></html>';
  const ok = await post(cat, { title: 'Big', html: big });
  assert.equal(ok.status, 201);
  assert.equal((await fetch(base + '/community/play/' + ok.body.id)).status, 200);
  assert.equal((await post(cat, { title: 'Too big', html: '<!DOCTYPE html>' + 'x'.repeat(51 * 1024 * 1024) })).status, 413);
});

test('plays are counted', async () => {
  const { body: novel } = await post(ana);
  await api('POST', `novels/${novel.id}/play`, {});
  assert.equal((await api('POST', `novels/${novel.id}/play`, {}, ben)).body.plays, 2);
});
