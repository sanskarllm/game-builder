// Community page: browse, play, like and post visual novels.
import { html, render, useState, useEffect, useMemo, useRef } from 'htm/preact';
import { listNovels, publishNovel, reactTo, countPlay, removeNovel, reportNovel, signIn, signUp, signOut, moderationQueue, moderate, novelSaves, storyPage, makeCover } from './community-api.js';

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
  const [dialog, setDialog] = useState(null); // 'post' | 'auth' | { report: novel }
  const [toast, setToast] = useState(null);
  const notify = (text, bad) => { setToast({ text, bad }); clearTimeout(notify.t); notify.t = setTimeout(() => setToast(null), bad ? 6000 : 2600); };
  const refresh = () => listNovels().then(d => { setData(d); setErr(''); return d; }).catch(e => setErr(e.message));
  useEffect(() => { refresh(); }, []);

  const user = data && data.user;
  const taste = (data && data.taste) || { liked: 0, disliked: 0, likes: [], dislikes: [], favouriteAuthors: [] };
  const hasTaste = taste.liked + taste.disliked > 0;
  const novels = (data && data.novels) || [];
  const tags = useMemo(() => { const c = {}; novels.forEach(n => n.tags.forEach(t => { c[t] = (c[t] || 0) + 1; })); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 14).map(e => e[0]); }, [data]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = novels.filter(n => (mode === 'all' || n.mode === mode) && (!tag || n.tags.includes(tag)) && words.every(w => [n.title, n.author, n.description, ...n.tags].join(' ').toLowerCase().includes(w)));
  if (sort === 'foryou') shown = shown.filter(n => n.reaction === 0 && !n.mine).sort((a, b) => (b.score - a.score) || (b.likes - b.dislikes - a.likes + a.dislikes) || (b.createdAt - a.createdAt));
  if (sort === 'new') shown = [...shown].sort((a, b) => b.createdAt - a.createdAt);
  if (sort === 'top') shown = [...shown].sort((a, b) => (b.likes - b.dislikes - a.likes + a.dislikes) || (b.plays - a.plays));
  if (sort === 'liked') shown = shown.filter(n => n.reaction > 0);
  if (sort === 'mine') shown = shown.filter(n => n.mine);

  // Anything that needs an account opens sign-in instead of failing.
  const guard = fn => async (...a) => {
    if (!user) { setDialog('auth'); return; }
    try { await fn(...a); } catch (e) { if (e.signIn) { await refresh(); setDialog('auth'); } else notify(e.message, true); }
  };
  const react = guard(async (n, value) => setData(await reactTo(n.id, n.reaction === value ? 0 : value)));
  function play(n) { setPlaying(n.id); countPlay(n.id).catch(() => {}); }
  async function remove(n) {
    if (!confirm(`Remove “${n.title}” from the community? This cannot be undone.`)) return;
    try { await removeNovel(n.id); await refresh(); notify('Removed'); } catch (e) { notify(e.message, true); }
  }
  async function leave() { try { await signOut(); await refresh(); setSort('foryou'); notify('Signed out'); } catch (e) { notify(e.message, true); } }
  const current = playing && novels.find(n => n.id === playing);
  const pills = [['foryou', 'For you', 'ph-sparkle'], ['new', 'Newest', 'ph-clock'], ['top', 'Most liked', 'ph-thumbs-up'], ...(user ? [['liked', 'Liked', 'ph-heart'], ['mine', 'My novels', 'ph-books']] : []), ...(user && user.admin ? [['moderation', 'Moderation' + (data.reports ? ` (${data.reports})` : ''), 'ph-shield-warning']] : [])];

  return html`
    <header class="c-head">
      <a class="c-brand" href="community.html"><i class="ph ph-sparkle" style="color:var(--color-accent);font-size:18px"></i>Game Forge Community</a>
      <div class="c-search"><i class="ph ph-magnifying-glass"></i><input class="input" type="search" aria-label="Search novels" placeholder="Search titles, authors, tags…" value=${query} onInput=${e => setQuery(e.target.value)} /></div>
      <div style="flex:1"></div>
      <a class="btn btn-secondary" href="index.html"><i class="ph ph-pencil-simple"></i>Open editor</a>
      <button class="btn btn-solid" onClick=${() => (user ? setDialog('post') : setDialog('auth'))}><i class="ph ph-upload-simple"></i>Post a novel</button>
      ${user ? html`<span class="c-me"><i class="ph ph-user-circle"></i>${user.name}</span><button class="btn btn-ghost" onClick=${leave}>Sign out</button>` : html`<button class="btn btn-secondary" onClick=${() => setDialog('auth')}><i class="ph ph-sign-in"></i>Sign in</button>`}
    </header>
    <div class="c-wrap">
      <main style="min-width:0">
        <div class="c-bar">
          <div class="c-pills">${pills.map(([id, label, icon]) => html`<button class=${'c-pill' + (sort === id ? ' on' : '')} onClick=${() => setSort(id)}><i class=${'ph ' + icon}></i>${label}</button>`)}</div>
          ${sort !== 'moderation' && html`<div class="c-pills">${[['all', 'All'], ['2D', '2D'], ['3D', '3D']].map(([id, label]) => html`<button class=${'c-pill' + (mode === id ? ' on' : '')} onClick=${() => setMode(id)}>${label}</button>`)}</div>`}
        </div>
        ${sort === 'moderation' ? html`<${Moderation} onChanged=${refresh} onPlay=${play} novels=${novels} notify=${notify} />` : html`
        ${tags.length > 0 && html`<div class="c-tags" style="margin-bottom:16px">${tags.map(t => html`<button class=${'c-tag' + (tag === t ? ' on' : '')} onClick=${() => setTag(tag === t ? '' : t)}>${t}</button>`)}</div>`}
        ${err && html`<div class="msg err" style="max-width:100%;margin-bottom:12px">${err}</div>`}
        <div class="c-grid">
          ${!data && !err && html`<div class="c-empty"><i class="ph ph-spinner spin"></i>Loading novels…</div>`}
          ${data && shown.length === 0 && html`<div class="c-empty"><i class="ph ph-books"></i>
            ${!novels.length ? 'No novels yet. Be the first to post one.' : sort === 'liked' ? 'Novels you like will appear here.' : sort === 'mine' ? 'Novels you post will appear here.' : sort === 'foryou' && !words.length && !tag ? 'You have rated everything here. New novels will appear as people post them.' : 'Nothing matches that.'}
            ${!novels.length && html`<button class="btn btn-solid" onClick=${() => (user ? setDialog('post') : setDialog('auth'))}><i class="ph ph-upload-simple"></i>Post a novel</button>`}</div>`}
          ${shown.map(n => html`<${Card} key=${n.id} n=${n} sort=${sort} admin=${user && user.admin} onPlay=${play} onReact=${react} onRemove=${remove} onReport=${guard(async x => setDialog({ report: x }))} onTag=${t => setTag(tag === t ? '' : t)} activeTag=${tag} />`)}
        </div>`}
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
          : user ? html`<span class="muted" style="font-size:12px">Like or dislike a few novels and “For you” will learn what you enjoy, on any device you sign in on.</span>`
          : html`<span class="muted" style="font-size:12px">Sign in to like novels. “For you” learns what you enjoy and follows you to any device.</span><button class="btn btn-secondary" onClick=${() => setDialog('auth')}>Sign in or create an account</button>`}
        </section>
        <section class="c-panel">
          <h2><i class="ph ph-shield-check" style="color:var(--color-accent)"></i> Safe to play</h2>
          <span class="muted" style="font-size:12px">Every novel runs sealed off from this site. It cannot see your account, keys or projects, or send anything out. See something wrong? Use the flag on its card.</span>
        </section>
      </aside>
    </div>
    ${dialog === 'auth' && html`<${AuthDialog} onClose=${() => setDialog(null)} onDone=${async name => { setDialog(null); await refresh(); notify('Welcome, ' + name); }} />`}
    ${dialog === 'post' && html`<${PostDialog} onClose=${() => setDialog(null)} onDone=${async t => { setDialog(null); await refresh(); setSort('mine'); notify('Posted “' + t + '”'); }} notify=${notify} />`}
    ${dialog && dialog.report && html`<${ReportDialog} n=${dialog.report} reasons=${data.reasons} onClose=${() => setDialog(null)} onDone=${d => { setData(d); setDialog(null); notify('Thanks. An admin will review it.'); }} />`}
    ${current && html`<${Player} key=${current.id} n=${current} user=${user} onClose=${() => setPlaying(null)} onReact=${react} />`}
    ${toast && html`<div class=${'toast' + (toast.bad ? ' err' : '')} role="status">${toast.text}</div>`}`;
}

function Card({ n, sort, admin, onPlay, onReact, onRemove, onReport, onTag, activeTag }) {
  return html`<article class="c-card">
    <button class="c-cover" aria-label=${'Play ' + n.title} onClick=${() => onPlay(n)}>
      ${n.cover ? html`<img src=${n.cover} alt="" loading="lazy" />` : html`<span class="c-fallback">${n.title}</span>`}
      <span class="tag tag-neutral c-mode">${n.mode}</span>
      <span class="c-go"><i class="ph ph-play-circle"></i></span>
    </button>
    <div class="c-body">
      <h3 class="c-title">${n.title}</h3>
      <span class="c-by">by ${n.author}${n.mine ? ' · you' : ''} · ${n.plays} play${n.plays === 1 ? '' : 's'}</span>
      ${n.hidden && html`<span class="c-why" style="color:var(--color-danger)"><i class="ph ph-eye-slash"></i>Hidden while an admin reviews it</span>`}
      ${sort === 'foryou' && n.why && html`<span class="c-why"><i class="ph ph-sparkle"></i>${n.why}</span>`}
      ${n.description && html`<p class="c-desc">${n.description}</p>`}
      ${n.tags.length > 0 && html`<div class="c-tags">${n.tags.map(t => html`<button class=${'c-tag' + (activeTag === t ? ' on' : '')} onClick=${() => onTag(t)}>${t}</button>`)}</div>`}
      <div class="c-foot">
        <${Reactions} n=${n} onReact=${onReact} />
        <div style="flex:1"></div>
        ${!n.mine && html`<button class="btn btn-ghost btn-icon" title=${n.reported ? 'You reported this' : 'Report this novel'} aria-label=${'Report ' + n.title} disabled=${n.reported} onClick=${() => onReport(n)}><i class="ph ph-flag"></i></button>`}
        ${(n.mine || admin) && html`<button class="btn btn-ghost btn-icon" title="Remove this novel" aria-label=${'Remove ' + n.title} onClick=${() => onRemove(n)}><i class="ph ph-trash"></i></button>`}
      </div>
    </div>
  </article>`;
}

function Reactions({ n, onReact }) {
  return html`
    <button class=${'c-react like' + (n.reaction > 0 ? ' on' : '')} aria-pressed=${n.reaction > 0} aria-label=${'Like, ' + n.likes + ' likes'} onClick=${() => onReact(n, 1)}><i class="ph ph-thumbs-up"></i>${n.likes}</button>
    <button class=${'c-react dislike' + (n.reaction < 0 ? ' on' : '')} aria-pressed=${n.reaction < 0} aria-label=${'Dislike, ' + n.dislikes + ' dislikes'} onClick=${() => onReact(n, -1)}><i class="ph ph-thumbs-down"></i>${n.dislikes}</button>`;
}

function Moderation({ onChanged, onPlay, novels, notify }) {
  const [queue, setQueue] = useState(null);
  const load = () => moderationQueue().then(d => setQueue(d.queue)).catch(e => notify(e.message, true));
  useEffect(() => { load(); }, []);
  async function act(n, action) {
    if (action !== 'keep' && !confirm(action === 'ban' ? `Ban ${n.author} and remove all their novels? This cannot be undone.` : `Remove “${n.title}”? This cannot be undone.`)) return;
    try { await moderate(n.id, action); await onChanged(); await load(); notify(action === 'keep' ? 'Kept and back on the page' : action === 'ban' ? 'Banned' : 'Removed'); } catch (e) { notify(e.message, true); }
  }
  if (!queue) return html`<div class="c-empty"><i class="ph ph-spinner spin"></i>Loading reports…</div>`;
  if (!queue.length) return html`<div class="c-empty"><i class="ph ph-shield-check"></i>No reports waiting.</div>`;
  return html`<div class="stack" style="gap:12px">${queue.map(n => html`<section class="c-panel" key=${n.id}>
    <div class="row" style="gap:8px;flex-wrap:wrap"><h2 style="flex:1;min-width:0">${n.title}</h2><span class="muted" style="font-size:12px">by ${n.author}</span>${n.hidden && html`<span class="tag tag-neutral">Hidden</span>`}</div>
    <ul class="c-reports">${n.reports.map(r => html`<li><b>${r.reason}</b> · ${r.by}${r.note ? ': ' + r.note : ''}</li>`)}</ul>
    <div class="row" style="gap:6px;flex-wrap:wrap">
      <button class="btn btn-secondary" disabled=${!novels.some(x => x.id === n.id)} onClick=${() => onPlay({ id: n.id })}><i class="ph ph-play"></i>Open</button>
      <button class="btn btn-secondary" onClick=${() => act(n, 'keep')}><i class="ph ph-check"></i>Keep</button>
      <button class="btn btn-secondary" onClick=${() => act(n, 'remove')}><i class="ph ph-trash"></i>Remove</button>
      <button class="btn btn-ghost btn-danger" onClick=${() => act(n, 'ban')}><i class="ph ph-prohibit"></i>Ban author</button>
    </div>
  </section>`)}</div>`;
}

function ReportDialog({ n, reasons, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() { setBusy(true); try { onDone(await reportNovel(n.id, reason, note)); } catch (e) { setErr(e.message); setBusy(false); } }
  return html`<div class="backdrop" onClick=${onClose}><div class="dialog" style="width:420px" role="dialog" aria-label="Report a novel" onClick=${e => e.stopPropagation()}>
    <div class="row"><i class="ph ph-flag" style="color:var(--color-accent);font-size:18px"></i><span class="dialog-title">Report “${n.title}”</span><div style="flex:1"></div><button class="btn btn-ghost btn-icon" aria-label="Close" onClick=${onClose}><i class="ph ph-x"></i></button></div>
    <div class="field"><label>What is wrong with it?</label><select class="input" value=${reason} onChange=${e => setReason(e.target.value)}><option value="">Choose a reason…</option>${reasons.map(r => html`<option value=${r} selected=${r === reason}>${r}</option>`)}</select></div>
    <div class="field"><label>Anything else? (optional)</label><textarea class="input" maxlength="500" value=${note} onInput=${e => setNote(e.target.value)}></textarea></div>
    ${err && html`<div class="msg err" style="max-width:100%">${err}</div>`}
    <div class="dialog-actions"><button class="btn btn-secondary" onClick=${onClose}>Cancel</button><button class="btn btn-solid" disabled=${!reason || busy} onClick=${send}>Send report</button></div>
  </div></div>`;
}

function AuthDialog({ onClose, onDone }) {
  const [mode, setMode] = useState('in');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await (mode === 'in' ? signIn : signUp)(name, password); onDone(r.user.name); }
    catch (x) { setErr(x.message); setBusy(false); }
  }
  return html`<div class="backdrop" onClick=${onClose}><form class="dialog" style="width:380px" aria-label=${mode === 'in' ? 'Sign in' : 'Create account'} onSubmit=${go} onClick=${e => e.stopPropagation()}>
    <div class="row"><i class="ph ph-user-circle" style="color:var(--color-accent);font-size:18px"></i><span class="dialog-title">${mode === 'in' ? 'Sign in' : 'Create an account'}</span><div style="flex:1"></div><button type="button" class="btn btn-ghost btn-icon" aria-label="Close" onClick=${onClose}><i class="ph ph-x"></i></button></div>
    <div class="seg" style="align-self:flex-start"><button type="button" class=${'seg-opt' + (mode === 'in' ? ' on' : '')} onClick=${() => { setMode('in'); setErr(''); }}>Sign in</button><button type="button" class=${'seg-opt' + (mode === 'new' ? ' on' : '')} onClick=${() => { setMode('new'); setErr(''); }}>New account</button></div>
    <div class="field"><label>Username</label><input class="input" autocomplete="username" required maxlength="24" value=${name} onInput=${e => setName(e.target.value)} /></div>
    <div class="field"><label>Password</label><input class="input" type="password" required maxlength="200" autocomplete=${mode === 'in' ? 'current-password' : 'new-password'} value=${password} onInput=${e => setPassword(e.target.value)} />${mode === 'new' && html`<span class="muted" style="font-size:11px">At least 8 characters. There is no email reset, so keep it safe.</span>`}</div>
    ${err && html`<div class="msg err" style="max-width:100%" role="alert">${err}</div>`}
    <div class="dialog-actions"><button type="button" class="btn btn-secondary" onClick=${onClose}>Cancel</button><button class="btn btn-solid" disabled=${busy}>${mode === 'in' ? 'Sign in' : 'Create account'}</button></div>
  </form></div>`;
}

function Player({ n, user, onClose, onReact }) {
  const frame = useRef();
  const [page, setPage] = useState(null);
  const [failed, setFailed] = useState('');
  // The novel is sealed off, so it asks here to keep saves and to reach Meta AI.
  // Only its own saves and story fields pass through, with limits.
  useEffect(() => {
    let busy = false, count = 0;
    const saves = novelSaves(n.id, !!user), loaded = saves.load();
    const on = async e => {
      if (!frame.current || e.source !== frame.current.contentWindow || !e.data || !e.data.forgeInfinity) return;
      const d = e.data.forgeInfinity, reply = m => e.source.postMessage({ forgeInfinity: m }, '*');
      if (d.type === 'hello') return reply({ type: 'ready', saves: await loaded, signedIn: !!user });
      if (d.type === 'save') return saves.set(d.key, d.value);
      if (d.type !== 'ask') return;
      if (busy) return reply({ type: 'reply', id: d.id, error: 'One moment, the last scene is still being written.' });
      if (++count > 40) return reply({ type: 'reply', id: d.id, error: 'That is a lot of story for one sitting. Reopen the novel to carry on.' });
      busy = true;
      try {
        const q = d.request || {}, own = JSON.parse(localStorage.getItem('gf.settings') || '{}');
        const request = { mode: q.mode, action: q.action, part: q.part, memory: q.memory, path: q.path, story: q.story, lastLocation: q.lastLocation };
        if (own.apiKey) Object.assign(request, { apiKey: own.apiKey, baseUrl: own.baseUrl, model: own.model });
        const r = await fetch('/api/infinity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
        const data = await r.json().catch(() => ({ error: 'The Game Forge server did not answer.' }));
        reply(r.ok && !data.error ? { type: 'reply', id: d.id, result: data } : { type: 'reply', id: d.id, error: data.error || 'Meta AI could not continue.' });
      } catch (err) { reply({ type: 'reply', id: d.id, error: 'Meta AI could not continue.' }); }
      busy = false;
    };
    window.addEventListener('message', on);
    return () => { window.removeEventListener('message', on); saves.flush(); };
  }, [n.id]);
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
    try { await publishNovel({ title, description, tags: tags.split(','), mode, cover, html: file.html }); onDone(title); }
    catch (e) { notify(e.message, true); setBusy(false); }
  }
  return html`<div class="backdrop" onClick=${onClose}><div class="dialog" style="width:460px;max-height:90vh;overflow:auto" role="dialog" aria-label="Post a novel" onClick=${e => e.stopPropagation()}>
    <div class="row"><i class="ph ph-upload-simple" style="color:var(--color-accent);font-size:18px"></i><span class="dialog-title">Post a novel</span><div style="flex:1"></div><button class="btn btn-ghost btn-icon" aria-label="Close" onClick=${onClose}><i class="ph ph-x"></i></button></div>
    <span style="font-size:13px;color:var(--color-neutral-300)">Anyone using this Community page can see and play what you post, under your username.</span>
    <div class="field"><label>Novel file (.html from Game Forge, or a .gameforge.json project)</label><input class="input" type="file" accept=".html,.htm,.json" onChange=${pick} /></div>
    ${file && html`
      <div class="field"><label>Title</label><input class="input" maxlength="80" value=${title} onInput=${e => setTitle(e.target.value)} /></div>
      <div class="field"><label>Description</label><textarea class="input" maxlength="500" value=${description} onInput=${e => setDescription(e.target.value)}></textarea></div>
      <div class="field"><label>Tags, separated by commas</label><input class="input" placeholder="mystery, romance, cozy" value=${tags} onInput=${e => setTags(e.target.value)} /><span class="muted" style="font-size:11px">Tags are how “For you” matches your novel to people who would like it.</span></div>
      <div class="row"><span class="label" style="flex:1">Type</span><div class="seg">${['2D', '3D'].map(m => html`<button class=${'seg-opt' + (mode === m ? ' on' : '')} onClick=${() => setMode(m)}>${m}</button>`)}</div></div>
      <div class="field"><label>Cover image (optional)</label><input class="input" type="file" accept="image/*" onChange=${pickCover} />${cover && html`<img class="c-cover-preview" src=${cover} alt="Cover preview" />`}</div>`}
    <div class="dialog-actions"><button class="btn btn-secondary" onClick=${onClose}>Cancel</button><button class="btn btn-solid" disabled=${!file || !title.trim() || busy} onClick=${post}><i class=${'ph ' + (busy ? 'ph-spinner spin' : 'ph-upload-simple')}></i>${busy ? 'Posting…' : 'Post'}</button></div>
  </div></div>`;
}

render(html`<${App} />`, document.getElementById('root'));
