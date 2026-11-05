// Community page: browse, play, like and post visual novels.
import { html, render, useState, useEffect, useMemo, useRef } from 'htm/preact';
import { listNovels, publishNovel, reactTo, countPlay, removeNovel, storyPage, makeCover, authorName } from './community-api.js';

const FP = window.ForgePlayer;
const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read that file.')); r[how](file); });

function App() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('foryou');
  const [mode, setMode] = useState('all');
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState(null);
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState(null);
  const notify = (text, bad) => { setToast({ text, bad }); clearTimeout(notify.t); notify.t = setTimeout(() => setToast(null), bad ? 6000 : 2600); };
  const refresh = () => listNovels().then(d => { setData(d); setErr(''); }).catch(e => setErr(e.message));
  useEffect(() => { refresh(); }, []);

  const taste = (data && data.taste) || { liked: 0, disliked: 0, likes: [], dislikes: [], favouriteAuthors: [] };
  const hasTaste = taste.liked + taste.disliked > 0;
  const novels = (data && data.novels) || [];
  const tags = useMemo(() => { const c = {}; novels.forEach(n => n.tags.forEach(t => { c[t] = (c[t] || 0) + 1; })); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 14).map(e => e[0]); }, [data]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = novels.filter(n => (mode === 'all' || n.mode === mode) && (!tag || n.tags.includes(tag)) && words.every(w => [n.title, n.author, n.description, ...n.tags].join(' ').toLowerCase().includes(w)));
  if (sort === 'foryou') shown = shown.filter(n => n.reaction === 0).sort((a, b) => (b.score - a.score) || (b.likes - b.dislikes - a.likes + a.dislikes) || (b.createdAt - a.createdAt));
  if (sort === 'new') shown = [...shown].sort((a, b) => b.createdAt - a.createdAt);
  if (sort === 'top') shown = [...shown].sort((a, b) => (b.likes - b.dislikes - a.likes + a.dislikes) || (b.plays - a.plays));
  if (sort === 'liked') shown = shown.filter(n => n.reaction > 0);

  async function react(n, value) {
    try { setData(await reactTo(n.id, n.reaction === value ? 0 : value)); } catch (e) { notify(e.message, true); }
  }
  function play(n) { setPlaying(n.id); countPlay(n.id).catch(() => {}); }
  async function remove(n) {
    if (!confirm(`Remove “${n.title}” from the community? This cannot be undone.`)) return;
    try { await removeNovel(n.id); await refresh(); notify('Removed'); } catch (e) { notify(e.message, true); }
  }
  const current = playing && novels.find(n => n.id === playing);

  return html`
    <header class="c-head">
      <a class="c-brand" href="community.html"><i class="ph ph-sparkle" style="color:var(--color-accent);font-size:18px"></i>Game Forge Community</a>
      <div class="c-search"><i class="ph ph-magnifying-glass"></i><input class="input" type="search" aria-label="Search novels" placeholder="Search titles, authors, tags…" value=${query} onInput=${e => setQuery(e.target.value)} /></div>
      <div style="flex:1"></div>
      <a class="btn btn-secondary" href="index.html"><i class="ph ph-pencil-simple"></i>Open editor</a>
      <button class="btn btn-solid" onClick=${() => setPosting(true)}><i class="ph ph-upload-simple"></i>Post a novel</button>
    </header>
    <div class="c-wrap">
      <main style="min-width:0">
        <div class="c-bar">
          <div class="c-pills">${[['foryou', 'For you', 'ph-sparkle'], ['new', 'Newest', 'ph-clock'], ['top', 'Most liked', 'ph-thumbs-up'], ['liked', 'Liked', 'ph-heart']].map(([id, label, icon]) => html`<button class=${'c-pill' + (sort === id ? ' on' : '')} onClick=${() => setSort(id)}><i class=${'ph ' + icon}></i>${label}</button>`)}</div>
          <div class="c-pills">${[['all', 'All'], ['2D', '2D'], ['3D', '3D']].map(([id, label]) => html`<button class=${'c-pill' + (mode === id ? ' on' : '')} onClick=${() => setMode(id)}>${label}</button>`)}</div>
        </div>
        ${tags.length > 0 && html`<div class="c-tags" style="margin-bottom:16px">${tags.map(t => html`<button class=${'c-tag' + (tag === t ? ' on' : '')} onClick=${() => setTag(tag === t ? '' : t)}>${t}</button>`)}</div>`}
        ${err && html`<div class="msg err" style="max-width:100%;margin-bottom:12px">${err}</div>`}
        <div class="c-grid">
          ${!data && !err && html`<div class="c-empty"><i class="ph ph-spinner spin"></i>Loading novels…</div>`}
          ${data && shown.length === 0 && html`<div class="c-empty"><i class="ph ph-books"></i>
            ${!novels.length ? 'No novels yet. Be the first to post one.' : sort === 'liked' ? 'Novels you like will appear here.' : sort === 'foryou' && !words.length && !tag ? 'You have rated everything here. New novels will appear as people post them.' : 'Nothing matches that.'}
            ${!novels.length && html`<button class="btn btn-solid" onClick=${() => setPosting(true)}><i class="ph ph-upload-simple"></i>Post a novel</button>`}</div>`}
          ${shown.map(n => html`<${Card} key=${n.id} n=${n} sort=${sort} onPlay=${play} onReact=${react} onRemove=${remove} onTag=${t => setTag(tag === t ? '' : t)} activeTag=${tag} />`)}
        </div>
      </main>
      <aside class="c-side">
        <section class="c-panel">
          <h2><i class="ph ph-user-circle" style="color:var(--color-accent)"></i> Your taste</h2>
          ${hasTaste ? html`
            <span class="muted" style="font-size:12px">From ${taste.liked} like${taste.liked === 1 ? '' : 's'} and ${taste.disliked} dislike${taste.disliked === 1 ? '' : 's'}.</span>
            ${taste.likes.length > 0 && html`<div class="stack" style="gap:4px"><span class="label">You like</span><div class="c-tags">${taste.likes.map(t => html`<span class="c-tag good">${t.name}</span>`)}</div></div>`}
            ${taste.dislikes.length > 0 && html`<div class="stack" style="gap:4px"><span class="label">You avoid</span><div class="c-tags">${taste.dislikes.map(t => html`<span class="c-tag bad">${t.name}</span>`)}</div></div>`}
            ${taste.favouriteMode && html`<span style="font-size:12px;color:var(--color-neutral-300)">You lean towards <b>${taste.favouriteMode}</b> novels.</span>`}
            ${taste.favouriteAuthors.length > 0 && html`<span style="font-size:12px;color:var(--color-neutral-300)">Favourite author: <b>${taste.favouriteAuthors[0].name}</b></span>`}`
          : html`<span class="muted" style="font-size:12px">Like or dislike a few novels and “For you” will learn what you enjoy.</span>`}
        </section>
        <section class="c-panel">
          <h2><i class="ph ph-shield-check" style="color:var(--color-accent)"></i> Safe to play</h2>
          <span class="muted" style="font-size:12px">Every novel runs sealed off from this site. It cannot see your keys or projects, or send anything out.</span>
        </section>
      </aside>
    </div>
    ${posting && html`<${PostDialog} onClose=${() => setPosting(false)} onDone=${async t => { setPosting(false); await refresh(); setSort('new'); notify('Posted “' + t + '”'); }} notify=${notify} />`}
    ${current && html`<${Player} n=${current} onClose=${() => setPlaying(null)} onReact=${react} />`}
    ${toast && html`<div class=${'toast' + (toast.bad ? ' err' : '')} role="status">${toast.text}</div>`}`;
}

function Card({ n, sort, onPlay, onReact, onRemove, onTag, activeTag }) {
  return html`<article class="c-card">
    <button class="c-cover" aria-label=${'Play ' + n.title} onClick=${() => onPlay(n)}>
      ${n.cover ? html`<img src=${n.cover} alt="" loading="lazy" />` : html`<span class="c-fallback">${n.title}</span>`}
      <span class="tag tag-neutral c-mode">${n.mode}</span>
      <span class="c-go"><i class="ph ph-play-circle"></i></span>
    </button>
    <div class="c-body">
      <h3 class="c-title">${n.title}</h3>
      <span class="c-by">by ${n.author}${n.mine ? ' · you' : ''} · ${n.plays} play${n.plays === 1 ? '' : 's'}</span>
      ${sort === 'foryou' && n.why && html`<span class="c-why"><i class="ph ph-sparkle"></i>${n.why}</span>`}
      ${n.description && html`<p class="c-desc">${n.description}</p>`}
      ${n.tags.length > 0 && html`<div class="c-tags">${n.tags.map(t => html`<button class=${'c-tag' + (activeTag === t ? ' on' : '')} onClick=${() => onTag(t)}>${t}</button>`)}</div>`}
      <div class="c-foot">
        <${Reactions} n=${n} onReact=${onReact} />
        <div style="flex:1"></div>
        ${n.mine && html`<button class="btn btn-ghost btn-icon" title="Remove my novel" aria-label=${'Remove ' + n.title} onClick=${() => onRemove(n)}><i class="ph ph-trash"></i></button>`}
      </div>
    </div>
  </article>`;
}

function Reactions({ n, onReact }) {
  return html`
    <button class=${'c-react like' + (n.reaction > 0 ? ' on' : '')} aria-pressed=${n.reaction > 0} aria-label=${'Like, ' + n.likes + ' likes'} onClick=${() => onReact(n, 1)}><i class="ph ph-thumbs-up"></i>${n.likes}</button>
    <button class=${'c-react dislike' + (n.reaction < 0 ? ' on' : '')} aria-pressed=${n.reaction < 0} aria-label=${'Dislike, ' + n.dislikes + ' dislikes'} onClick=${() => onReact(n, -1)}><i class="ph ph-thumbs-down"></i>${n.dislikes}</button>`;
}

function Player({ n, onClose, onReact }) {
  const frame = useRef();
  const [page, setPage] = useState(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/community/play/' + n.id).then(r => { if (!r.ok) throw new Error('This novel could not be loaded.'); return r.text(); }).then(t => live && setPage(t)).catch(e => live && setFailed(e.message));
    return () => { live = false; };
  }, [n.id]);
  useEffect(() => { const k = e => { if (e.key === 'Escape' && document.activeElement !== frame.current) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return html`<div class="c-player" role="dialog" aria-label=${'Playing ' + n.title}>
    <div class="c-player-bar">
      <button class="btn btn-secondary" onClick=${onClose}><i class="ph ph-arrow-left"></i>Back</button>
      <span class="c-player-t">${n.title} <span class="muted" style="font-weight:400">by ${n.author}</span></span>
      <${Reactions} n=${n} onReact=${onReact} />
    </div>
    ${page && html`<iframe ref=${frame} srcdoc=${page} sandbox="allow-scripts allow-pointer-lock" allow="fullscreen; autoplay; gamepad" title=${n.title}></iframe>`}
    ${!page && html`<div class="c-empty" style="flex:1">${failed ? failed : html`<i class="ph ph-spinner spin"></i>Loading…`}</div>`}
  </div>`;
}

function PostDialog({ onClose, onDone, notify }) {
  const [file, setFile] = useState(null); // { html, name }
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(authorName());
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [mode, setMode] = useState('2D');
  const [cover, setCover] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const f = e.target.files[0]; if (!f) return;
    try {
      const text = await readAs(f, 'readAsText');
      if (/\.json$/i.test(f.name)) {
        const { normalizeGame } = await import('./ai.js');
        let g; try { g = normalizeGame(JSON.parse(text)); } catch (err) { throw new Error('That file is not a Game Forge project.'); }
        if (!g.scenes.length) throw new Error('That file is not a Game Forge project.');
        setFile({ html: await storyPage(g), name: f.name }); setMode('2D'); setTitle(g.title); setDescription(g.logline);
        const first = g.scenes[0] && g.scenes[0].bg; setCover(await makeCover(FP.bgUrl(g, first)));
      } else {
        if (!/<!doctype html|<html[\s>]/i.test(text.slice(0, 4096))) throw new Error('Choose a novel saved from Game Forge (.html) or a project (.gameforge.json).');
        setFile({ html: text, name: f.name }); setMode(/three(@|\.module|\/addons)|from ["']three["']/.test(text) ? '3D' : '2D');
        setTitle((text.match(/<title>([^<]*)/i) || [])[1] || f.name.replace(/\.[^.]+$/, ''));
      }
    } catch (err) { setFile(null); notify(err.message, true); }
  }
  async function pickCover(e) { const f = e.target.files[0]; if (f) setCover(await makeCover(await readAs(f, 'readAsDataURL'))); }
  async function post() {
    setBusy(true);
    try { authorName(author); await publishNovel({ title, author, description, tags: tags.split(','), mode, cover, html: file.html }); onDone(title); }
    catch (e) { notify(e.message, true); setBusy(false); }
  }
  return html`<div class="backdrop" onClick=${onClose}><div class="dialog" style="width:460px;max-height:90vh;overflow:auto" role="dialog" aria-label="Post a novel" onClick=${e => e.stopPropagation()}>
    <div class="row"><i class="ph ph-upload-simple" style="color:var(--color-accent);font-size:18px"></i><span class="dialog-title">Post a novel</span><div style="flex:1"></div><button class="btn btn-ghost btn-icon" aria-label="Close" onClick=${onClose}><i class="ph ph-x"></i></button></div>
    <span style="font-size:13px;color:var(--color-neutral-300)">Anyone using this Community page can see and play what you post.</span>
    <div class="field"><label>Novel file (.html from Game Forge, or a .gameforge.json project)</label><input class="input" type="file" accept=".html,.htm,.json" onChange=${pick} /></div>
    ${file && html`
      <div class="field"><label>Title</label><input class="input" maxlength="80" value=${title} onInput=${e => setTitle(e.target.value)} /></div>
      <div class="field"><label>Your name</label><input class="input" maxlength="40" placeholder="Anonymous" value=${author} onInput=${e => setAuthor(e.target.value)} /></div>
      <div class="field"><label>Description</label><textarea class="input" maxlength="500" value=${description} onInput=${e => setDescription(e.target.value)}></textarea></div>
      <div class="field"><label>Tags, separated by commas</label><input class="input" placeholder="mystery, romance, cozy" value=${tags} onInput=${e => setTags(e.target.value)} /><span class="muted" style="font-size:11px">Tags are how “For you” matches your novel to people who would like it.</span></div>
      <div class="row"><span class="label" style="flex:1">Type</span><div class="seg">${['2D', '3D'].map(m => html`<button class=${'seg-opt' + (mode === m ? ' on' : '')} onClick=${() => setMode(m)}>${m}</button>`)}</div></div>
      <div class="field"><label>Cover image (optional)</label><input class="input" type="file" accept="image/*" onChange=${pickCover} />${cover && html`<img class="c-cover-preview" src=${cover} alt="Cover preview" />`}</div>`}
    <div class="dialog-actions"><button class="btn btn-secondary" onClick=${onClose}>Cancel</button><button class="btn btn-solid" disabled=${!file || !title.trim() || busy} onClick=${post}><i class=${'ph ' + (busy ? 'ph-spinner spin' : 'ph-upload-simple')}></i>${busy ? 'Posting…' : 'Post'}</button></div>
  </div></div>`;
}

render(html`<${App} />`, document.getElementById('root'));
