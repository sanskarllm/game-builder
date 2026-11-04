const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

test('static requests reject malformed URLs and traversal without stopping the server', async t => {
  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited: ' + code)); });
    child.stdout.on('data', data => {
      if (data.toString().includes('Game Forge running')) { clearTimeout(timer); resolve(); }
    });
  });
  const request = target => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: target }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  for (const target of ['/%', '/%E0%A4%A', '/%00']) {
    assert.equal((await request(target)).status, 400, target);
  }
  // Encoded separators bypass URL dot-segment normalization; sibling names
  // beginning with "public" must still fail the filesystem boundary check.
  for (const target of ['/..%2fpackage.json', '/..%2fpublic-private%2fsecret.txt', '/..%5cpublic-private%5csecret.txt']) {
    assert.equal((await request(target)).status, target.includes('%5c') && process.platform !== 'win32' ? 404 : 403, target);
  }
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /<title>Game Forge<\/title>/);
  assert.equal((await request('/app.js')).status, 200);
  assert.equal((await request('/missing.txt')).status, 404);
  assert.equal((await request('/api/status')).status, 200);
});
