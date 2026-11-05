// Shared by the Community page and the editor's Publish dialog.

// A random id that stays in this browser. It lets someone like, dislike and
// remove their own posts without an account. It is not a login.
export function viewerId() {
  try {
    let id = localStorage.getItem('gf.viewer');
    if (!/^[a-f0-9]{32,64}$/.test(id || '')) {
      id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('gf.viewer', id);
    }
    return id;
  } catch (e) { return ''; }
}
export const authorName = v => { try { if (v != null) localStorage.setItem('gf.author', v); return localStorage.getItem('gf.author') || ''; } catch (e) { return v || ''; } };

async function call(path, opts = {}) {
  const r = await fetch('/api/community/' + path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Forge-Viewer': viewerId() } });
  const d = await r.json().catch(() => ({ error: 'The Game Forge server did not answer.' }));
  if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}
export const listNovels = () => call('novels');
export const publishNovel = novel => call('novels', { method: 'POST', body: JSON.stringify(novel) });
export const reactTo = (id, value) => call(`novels/${id}/react`, { method: 'POST', body: JSON.stringify({ value }) });
export const countPlay = id => call(`novels/${id}/play`, { method: 'POST', body: '{}' });
export const removeNovel = id => call(`novels/${id}`, { method: 'DELETE' });

// One playable .html file for a 2D novel (also used by Save 2D novel).
export async function storyPage(g) {
  const js = await (await fetch('player.js')).text();
  const data = JSON.stringify({ ...g, assets3d: undefined, code: undefined }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(g.title).replace(/</g, '')}</title><style>html,body{margin:0;height:100%;background:#05060c;display:grid;place-items:center}#game{width:min(100vw,177.78vh);aspect-ratio:16/9}</style></head><body><div id="game"></div><script>${js}<\/script><script>ForgePlayer.boot(document.getElementById('game'),${data});<\/script></body></html>`;
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
