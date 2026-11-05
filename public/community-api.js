// Shared by the Community page and the editor's Post dialog. Sign-in is an
// HttpOnly cookie, so this file never sees or stores it.

async function call(path, opts = {}) {
  const r = await fetch('/api/community/' + path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json' } });
  const d = await r.json().catch(() => ({ error: 'The Game Forge server did not answer.' }));
  if (!r.ok || d.error) throw Object.assign(new Error(d.error || 'HTTP ' + r.status), { status: r.status, signIn: !!d.signIn });
  return d;
}
const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const listNovels = () => call('novels');
export const publishNovel = novel => post('novels', novel);
export const reactTo = (id, value) => post(`novels/${id}/react`, { value });
export const countPlay = id => post(`novels/${id}/play`);
export const removeNovel = id => call(`novels/${id}`, { method: 'DELETE' });
export const reportNovel = (id, reason, note) => post(`novels/${id}/report`, { reason, note });

export const signUp = (name, password) => post('signup', { name, password });
export const signIn = (name, password) => post('login', { name, password });
export const signOut = () => post('logout');

export const moderationQueue = () => call('moderation');
export const moderate = (novel, action) => post('moderation', { novel, action });

// One playable .html file for a 2D novel (also used by Save 2D novel).
export async function storyPage(g) {
  const js = await (await fetch('player.js')).text();
  const data = JSON.stringify({ ...g, assets3d: undefined, code: undefined }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(g.title).replace(/</g, '')}</title><style>html,body{margin:0;height:100%;background:#05060c;display:grid;place-items:center}#game{width:min(100vw,177.78vh);aspect-ratio:16/9}</style></head><body><div id="game"></div><script>${js}<\/script><script>ForgePlayer.boot(document.getElementById('game'),${data});<\/script></body></html>`;
}

// Saves for a novel in the Community: with the account when signed in, otherwise
// in this browser. Writes are grouped so a save per line does not flood the server.
export function novelSaves(novelId, signedIn) {
  const localKey = 'gf.novel:' + novelId;
  let data = {}, timer = null;
  const write = () => {
    timer = null;
    const text = JSON.stringify(data);
    if (text.length > 550 * 1024) return;
    if (signedIn) call('saves/' + novelId, { method: 'PUT', body: JSON.stringify({ saves: data }) }).catch(() => {});
    else { try { localStorage.setItem(localKey, text); } catch (e) { /* storage full or blocked */ } }
  };
  return {
    async load() {
      try { data = signedIn ? (await call('saves/' + novelId)).saves : JSON.parse(localStorage.getItem(localKey)) || {}; } catch (e) { data = {}; }
      return data;
    },
    set(key, value) {
      if (typeof key !== 'string' || !/^[\w:-]{1,100}$/.test(key) || key === '__proto__') return;
      if (!(key in data) && Object.keys(data).length >= 8) return;
      data[key] = value; if (!timer) timer = setTimeout(write, 800);
    },
    flush() { if (timer) { clearTimeout(timer); write(); } },
  };
}

// A small JPEG cover from any image URL (SVG art included).
export function makeCover(url, w = 640, h = 360) {
  return new Promise(res => {
    if (!url) return res('');
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const s = Math.max(w / (img.width || w), h / (img.height || h)), iw = (img.width || w) * s, ih = (img.height || h) * s, x = c.getContext('2d');
      x.fillStyle = '#161826'; x.fillRect(0, 0, w, h); x.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
      try { res(c.toDataURL('image/jpeg', 0.78)); } catch (e) { res(''); }
    };
    img.onerror = () => res(''); img.src = url;
  });
}
