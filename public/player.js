/* Game Forge player runtime.
   Renders a branching visual novel from a game JSON object. Used by the
   editor preview and inlined verbatim into exported games, so it must stay
   dependency-free plain JS. */
(function () {
  'use strict';

  const CSS = `
.fp-stage{position:relative;width:100%;height:100%;overflow:hidden;background:#0d0f1a;font-family:Inter,system-ui,sans-serif;color:#e9e9ed;user-select:none;container-type:inline-size}
.fp-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:fp-in .5s ease}
.fp-chars{position:absolute;inset:0;pointer-events:none}
.fp-char{position:absolute;bottom:0;height:82%;transform:translateX(-50%);display:flex;align-items:flex-end;justify-content:center;transition:left .4s ease,filter .3s}
.fp-char img{height:100%;width:auto;max-width:none;filter:drop-shadow(0 8px 24px rgba(0,0,0,.55))}
.fp-char.dim img{filter:brightness(.6) drop-shadow(0 8px 24px rgba(0,0,0,.55))}
.fp-box{position:absolute;left:3%;right:3%;bottom:4%;min-height:22%;padding:14px 18px 22px;border-radius:10px;background:rgba(16,18,30,.88);box-shadow:0 0 0 1px rgba(233,233,237,.14),0 10px 30px rgba(0,0,0,.4);cursor:pointer;display:flex;flex-direction:column;gap:6px;backdrop-filter:blur(6px)}
.fp-who{font-size:clamp(11px,1.6cqi,15px);font-weight:600;color:#d2cefd;letter-spacing:.02em}
.fp-text{font-size:clamp(13px,2cqi,20px);line-height:1.45;text-wrap:pretty}
.fp-count{position:absolute;right:14px;bottom:8px;font-size:10px;color:#9397ab}
.fp-choices{position:absolute;top:16%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;width:min(56%,520px)}
.fp-choice{padding:10px 14px;border-radius:8px;border:1px solid #9184d9;background:rgba(16,18,30,.88);color:#e9e9ed;font:inherit;font-size:clamp(12px,1.8cqi,16px);cursor:pointer;text-align:left;animation:fp-up .3s ease both}
.fp-choice:hover{background:rgba(145,132,217,.25)}
.fp-tag{position:absolute;top:10px;left:12px;font:11px ui-monospace,monospace;color:#cfd3e5;padding:3px 8px;border-radius:6px;background:rgba(16,18,30,.7)}
.fp-music{position:absolute;top:10px;right:12px;font-size:11px;color:#cfd3e5;padding:3px 8px;border-radius:6px;background:rgba(16,18,30,.7);cursor:pointer;border:none;font-family:inherit}
.fp-title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;background:radial-gradient(80% 70% at 50% 40%,rgba(38,42,96,.85),rgba(13,15,26,.96))}
.fp-title h1{margin:0;font-size:clamp(26px,6cqi,64px);font-weight:600;letter-spacing:-.02em}
.fp-title p{margin:0;max-width:640px;color:#cfd3e5;font-size:clamp(13px,2cqi,18px)}
.fp-btn{padding:10px 22px;border-radius:8px;border:1px solid #9184d9;background:transparent;color:#b5abfc;font:inherit;font-size:15px;cursor:pointer}
.fp-btn:hover{background:rgba(145,132,217,.18)}
.fp-small{font-size:11px;color:#9397ab}
.fp-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.fp-menu-btn{position:absolute;top:10px;left:12px;z-index:3;font:inherit;font-size:12px;color:#e9e9ed;padding:5px 10px;border-radius:6px;border:1px solid rgba(233,233,237,.2);background:rgba(16,18,30,.75);cursor:pointer}
.fp-menu-btn:hover{border-color:#9184d9}
.fp-panel-wrap{position:absolute;inset:0;z-index:10;display:grid;place-items:center;background:rgba(5,6,12,.6);backdrop-filter:blur(3px);animation:fp-in .2s ease}
.fp-panel{width:min(380px,86%);display:flex;flex-direction:column;gap:8px;padding:20px;border-radius:12px;background:#1b1d2b;box-shadow:0 0 0 1px rgba(233,233,237,.16),0 20px 50px rgba(0,0,0,.6)}
.fp-panel h2{margin:0 0 4px;font-size:18px;font-weight:600}
.fp-panel .fp-btn{width:100%}
.fp-quiet{border-color:rgba(233,233,237,.2);color:#cfd3e5}
.fp-slot{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(233,233,237,.16);background:rgba(255,255,255,.03);color:#e9e9ed;font:inherit;text-align:left;cursor:pointer}
.fp-slot span{font-size:12px;color:#9397ab}
.fp-slot:hover:not(:disabled){border-color:#9184d9;background:rgba(145,132,217,.12)}
.fp-slot:disabled{opacity:.45;cursor:default}
.fp-note{font-size:12px;color:#b5abfc}
.fp-ask{display:flex;gap:8px;margin-top:10px}
.fp-ask input{flex:1;min-width:0;padding:9px 12px;border-radius:8px;border:1px solid #9184d9;background:rgba(5,6,12,.7);color:#e9e9ed;font:inherit;font-size:clamp(12px,1.8cqi,16px);user-select:text}
.fp-ask input:focus{outline:2px solid #b5abfc;outline-offset:1px}
.fp-ask button{padding:9px 16px;border-radius:8px;border:1px solid #9184d9;background:#5d5294;color:#fff;font:inherit;font-size:clamp(12px,1.8cqi,16px);cursor:pointer}
.fp-knows{max-width:560px;font-size:clamp(12px,1.7cqi,15px);color:#cfd3e5}
.fp-knows b{color:#d2cefd;font-weight:600}
.fp-mode{display:flex;flex-direction:column;gap:2px;max-width:280px;padding:12px 16px;border-radius:10px;border:1px solid #9184d9;background:rgba(16,18,30,.7);color:#e9e9ed;font:inherit;text-align:left;cursor:pointer}
.fp-mode b{font-size:15px;color:#d2cefd}
.fp-mode span{font-size:12px;color:#b2b6ca}
.fp-mode:hover{background:rgba(145,132,217,.2)}
.fp-writing{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.fp-dots{display:flex;gap:6px}
.fp-dots i{width:8px;height:8px;border-radius:50%;background:#b5abfc;animation:fp-dot 1.2s infinite ease-in-out}
.fp-dots i:nth-child(2){animation-delay:.15s}.fp-dots i:nth-child(3){animation-delay:.3s}
@keyframes fp-dot{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){.fp-dots i{animation:none}}
.fp-fade{animation:fp-in .6s ease}.fp-dissolve{animation:fp-in 1.1s ease}.fp-slide-left{animation:fp-slide .5s ease}
@keyframes fp-in{from{opacity:0}to{opacity:1}}
@keyframes fp-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes fp-slide{from{transform:translateX(8%);opacity:0}to{transform:none;opacity:1}}
`;
  function injectCss() {
    if (document.getElementById('fp-css')) return;
    const s = document.createElement('style'); s.id = 'fp-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // ---------- helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
  const svgUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  // Strip anything active from model-written SVG. It is only ever shown via
  // <img>, which never runs scripts, but exported files may be opened elsewhere.
  function sanitizeSvg(text) {
    const m = String(text || '').match(/<svg[\s\S]*<\/svg>/i);
    if (!m) return '';
    let s = m[0]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href\s*=\s*["'])\s*(javascript:|https?:)[^"']*/gi, '$1#');
    if (!/xmlns=/.test(s)) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return s;
  }

  // ---------- fallback art (used until Meta AI paints the real asset) ----------
  const PALETTES = [
    { k: /dusk|sunset|evening|harbor|harbour|dock/, sky: ['#2b2741', '#7a4a6e', '#e59a6b'], ground: '#1b1d2e', sun: '#ffcf8a' },
    { k: /night|moon|dark|midnight|star/, sky: ['#070914', '#141a3a', '#2c3470'], ground: '#0b0d18', sun: '#e9ecff' },
    { k: /fog|mist|haze|ghost/, sky: ['#5c6274', '#8b91a3', '#b7bccb'], ground: '#4a4f60', sun: '#e4e7f5' },
    { k: /forest|wood|jungle|grove|garden/, sky: ['#16301f', '#2f5a3a', '#88b07a'], ground: '#10221a', sun: '#f0f5c8' },
    { k: /desert|sand|dune|canyon/, sky: ['#6b3b2a', '#d08a4f', '#f3d39a'], ground: '#8a5a33', sun: '#fff1c4' },
    { k: /snow|ice|winter|frost|mountain/, sky: ['#3f5577', '#8ea7c9', '#dfe9f5'], ground: '#cfdcec', sun: '#ffffff' },
    { k: /interior|room|hall|house|inside|lighthouse|tavern|castle|lab/, sky: ['#2a1d18', '#4d3326', '#8a5c3d'], ground: '#1d1411', sun: '#ffd27a', indoor: true },
    { k: /city|street|market|town|neon|cyber/, sky: ['#1a1433', '#3b2763', '#d0618a'], ground: '#140f24', sun: '#ffd6f0', city: true },
    { k: /cliff|coast|sea|ocean|beach|shore/, sky: ['#1f3550', '#3f6c8f', '#a8c9d9'], ground: '#1a2638', sun: '#fff4d6' },
    { k: /space|planet|galaxy|ship|station/, sky: ['#02030a', '#0b0f2b', '#231a4a'], ground: '#05060f', sun: '#bfe3ff', space: true },
  ];
  function pickPalette(text) {
    const t = String(text || '').toLowerCase();
    return PALETTES.find(p => p.k.test(t)) || { sky: ['#1d2140', '#3a3f74', '#7d79b8'], ground: '#161826', sun: '#e7e5fe' };
  }
  function fallbackBg(name, desc) {
    const p = pickPalette(name + ' ' + (desc || '')), r = rng(hash(name));
    let shapes = '';
    if (p.indoor) {
      shapes += `<rect x="0" y="620" width="1600" height="280" fill="${p.ground}"/>`;
      for (let i = 0; i < 6; i++) shapes += `<rect x="${i * 280 + 40}" y="0" width="18" height="620" fill="#00000033"/>`;
      shapes += `<rect x="620" y="180" width="360" height="260" rx="8" fill="#0d0f1a" stroke="#00000055" stroke-width="14"/><circle cx="800" cy="300" r="70" fill="${p.sun}" opacity=".35"/>`;
      shapes += `<circle cx="1260" cy="520" r="160" fill="url(#glow)"/>`;
    } else {
      shapes += `<circle cx="${300 + r() * 1000}" cy="${180 + r() * 120}" r="${p.space ? 140 : 70}" fill="${p.sun}" opacity=".9"/>`;
      if (p.space) for (let i = 0; i < 90; i++) shapes += `<circle cx="${r() * 1600}" cy="${r() * 900}" r="${r() * 2 + .5}" fill="#fff" opacity="${.4 + r() * .6}"/>`;
      for (let layer = 0; layer < 3; layer++) {
        const base = 560 + layer * 90; let d = `M0 ${base}`;
        for (let x = 0; x <= 1600; x += 100) d += ` L${x} ${base - r() * (120 - layer * 30)}`;
        d += ' L1600 900 L0 900Z';
        shapes += `<path d="${d}" fill="${p.ground}" opacity="${.45 + layer * .25}"/>`;
      }
      if (p.city) for (let i = 0; i < 22; i++) { const w = 40 + r() * 60, h = 120 + r() * 300, x = i * 75; shapes += `<rect x="${x}" y="${760 - h}" width="${w}" height="${h + 140}" fill="#0b0816" opacity=".9"/>`; for (let j = 0; j < 6; j++) shapes += `<rect x="${x + 8 + r() * (w - 16)}" y="${780 - h + r() * h}" width="6" height="9" fill="${p.sun}" opacity="${r() * .8}"/>`; }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".6" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient><radialGradient id="glow"><stop offset="0" stop-color="${p.sun}" stop-opacity=".45"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="900" fill="url(#sky)"/>${shapes}</svg>`;
  }
  function fallbackChar(name, color) {
    const c = color || ['#9184d9', '#d0618a', '#5aa6a0', '#d8a657', '#7aa2f7', '#c678dd'][hash(name) % 6];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#161826"/></linearGradient></defs><ellipse cx="200" cy="190" rx="82" ry="96" fill="#e8c9b0"/><path d="M118 170 Q120 80 200 78 Q285 80 284 175 Q270 120 200 118 Q135 120 118 170Z" fill="#2b2741"/><circle cx="172" cy="200" r="7" fill="#161826"/><circle cx="228" cy="200" r="7" fill="#161826"/><path d="M180 240 Q200 252 220 240" stroke="#7a4a4a" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M60 800 Q60 330 200 300 Q340 330 340 800Z" fill="url(#g)"/><path d="M160 300 L200 360 L240 300" fill="none" stroke="#ffffff55" stroke-width="6"/></svg>`;
  }

  function bgUrl(game, name) {
    const b = (game.backgrounds || []).find(x => x.name === name);
    if (b && b.img) return b.img;
    if (b && b.svg) return svgUrl(b.svg);
    return svgUrl(fallbackBg(name || 'scene', b && b.desc));
  }
  function charUrl(game, name) {
    const c = (game.characters || []).find(x => x.name === name);
    if (c && c.img) return c.img;
    if (c && c.svg) return svgUrl(c.svg);
    return svgUrl(fallbackChar(name, c && c.color));
  }
  const EXPR_FILTER = { sad: 'saturate(.55) brightness(.9)', hollow: 'saturate(.3) brightness(.85)', angry: 'sepia(.25) saturate(1.6) hue-rotate(-20deg)', joyful: 'brightness(1.08) saturate(1.2)', happy: 'brightness(1.08) saturate(1.2)', scared: 'saturate(.6) hue-rotate(15deg)', tired: 'brightness(.88)' };

  // ---------- music: tiny WebAudio sequencer ----------
  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  function freq(n) {
    const m = String(n).match(/^([A-G][#b]?)(-?\d)$/); if (!m) return 0;
    return 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12);
  }
  // Seeded melody from the track's mood, so every track is playable before
  // Meta AI composes a real one.
  function proceduralTrack(track) {
    const mood = String((track.mood || '') + ' ' + track.name).toLowerCase();
    const minor = /dark|sad|tense|fog|myster|confront|danger|night|grim|horror|melanch/.test(mood);
    const fast = /battle|chase|confront|action|market|bustle|upbeat|tense/.test(mood);
    const scale = minor ? ['A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5'] : ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'];
    const r = rng(hash(track.name)); let i = 3; const notes = [];
    for (let k = 0; k < 32; k++) { i = Math.max(0, Math.min(scale.length - 1, i + Math.round(r() * 4 - 2))); notes.push([r() < .12 ? 'rest' : scale[i], r() < .25 ? 2 : 1]); }
    return { bpm: fast ? 128 : 84, wave: minor ? 'triangle' : 'sine', notes, bass: minor ? ['A2', 'F2', 'C3', 'G2'] : ['C3', 'A2', 'F2', 'G2'] };
  }
  const music = {
    ctx: null, timer: null, current: null, audioEl: null, muted: false, onchange: null,
    play(game, name) {
      if (this.current === name && (this.timer || this.audioEl)) return;
      this.stop(); this.current = name;
      if (!name || this.muted) return;
      const track = (game.music || []).find(t => t.name === name) || { name };
      if (track.src) { this.audioEl = new Audio(track.src); this.audioEl.loop = true; this.audioEl.volume = .5; this.audioEl.play().catch(() => {}); return; }
      const seq = (track.notes && track.notes.length) ? { bpm: track.bpm || 90, wave: track.wave || 'triangle', notes: track.notes, bass: track.bass || [] } : proceduralTrack(track);
      try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      const ctx = this.ctx; if (ctx.state === 'suspended') ctx.resume();
      const beat = 60 / Math.max(40, Math.min(200, seq.bpm));
      const master = ctx.createGain(); master.gain.value = .12; master.connect(ctx.destination);
      let t = ctx.currentTime + .05, idx = 0, bar = 0, beatsInBar = 0;
      const tone = (f, start, dur, type, vol) => {
        if (!f) return; const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(vol, start + .02); g.gain.exponentialRampToValueAtTime(.001, start + dur * .95);
        o.connect(g); g.connect(master); o.start(start); o.stop(start + dur);
      };
      const schedule = () => {
        while (t < ctx.currentTime + .6) {
          const [n, beats] = seq.notes[idx % seq.notes.length]; const dur = beat * (Number(beats) || 1);
          if (n !== 'rest') tone(freq(n), t, dur, ['sine', 'square', 'triangle', 'sawtooth'].includes(seq.wave) ? seq.wave : 'triangle', .9);
          if (seq.bass && seq.bass.length && beatsInBar === 0) tone(freq(seq.bass[bar % seq.bass.length]), t, beat * 4, 'sine', .7);
          beatsInBar += Number(beats) || 1; if (beatsInBar >= 4) { beatsInBar = 0; bar++; }
          t += dur; idx++;
        }
      };
      schedule(); this.timer = setInterval(schedule, 200); this._master = master;
      if (this.onchange) this.onchange();
    },
    stop() {
      if (this.timer) clearInterval(this.timer); this.timer = null;
      if (this._master) { try { this._master.disconnect(); } catch (e) {} this._master = null; }
      if (this.audioEl) { this.audioEl.pause(); this.audioEl = null; }
      this.current = null; if (this.onchange) this.onchange();
    },
    toggleMute(game, name) { this.muted = !this.muted; if (this.muted) this.stop(); else this.play(game, name); },
  };

  // ---------- scene renderer ----------
  // opts: { scene, line, onScene(id), onLine(i), music:bool, showTags:bool, onEnd(),
  //         onChange({scene, line}) after every step, menu: show the Menu button, onMenu(),
  //         onChoice(scene, choice) when a choice is picked,
  //         onAct(text) when the player types what they do (scenes with ask: true) }
  function mount(el, game, opts) {
    injectCss();
    opts = opts || {};
    const scenes = game.scenes || [];
    let scene = scenes.find(s => s.id === opts.scene) || scenes[0];
    let line = opts.line || 0;
    let first = true;
    if (!scene) { el.innerHTML = '<div class="fp-stage"><div class="fp-title"><p>No scenes yet.</p></div></div>'; return { destroy() {} }; }

    function draw() {
      const lines = scene.lines && scene.lines.length ? scene.lines : [{ who: '', text: '(no dialogue yet)' }];
      line = Math.min(line, lines.length - 1);
      const L = lines[line];
      const atEnd = line === lines.length - 1;
      const choices = scene.choices || [];
      const pos = { L: '24%', C: '50%', R: '76%' };
      const trans = first ? 'fp-' + String(scene.transition || 'fade').toLowerCase().replace(/\s+/g, '-') : '';
      el.innerHTML = `<div class="fp-stage ${trans === 'fp-cut' ? '' : trans}">
        <img class="fp-bg" alt="" src="${bgUrl(game, scene.bg)}">
        <div class="fp-chars">${(scene.chars || []).slice(0, 4).map(c => `<div class="fp-char ${L.who && L.who !== c.name && L.who !== 'Narrator' ? 'dim' : ''}" style="left:${pos[c.pos] || '50%'};${EXPR_FILTER[String(c.expr || '').toLowerCase()] ? 'filter:' + EXPR_FILTER[String(c.expr).toLowerCase()] : ''}"><img alt="${esc(c.name)}" src="${charUrl(game, c.name)}"></div>`).join('')}</div>
        ${opts.showTags ? `<div class="fp-tag">BG · ${esc(scene.bg || '—')}</div>` : ''}
        ${opts.menu ? `<button class="fp-menu-btn" data-act="menu" title="Save, load or quit">☰ Menu</button>` : ''}
        ${scene.music ? `<button class="fp-music" data-act="mute" title="Toggle music">${music.muted ? '🔇' : '♪'} ${esc(scene.music)}</button>` : ''}
        ${atEnd && choices.length ? `<div class="fp-choices">${choices.map((c, i) => `<button class="fp-choice" data-choice="${i}" style="animation-delay:${i * 60}ms">${esc(c.text)}</button>`).join('')}</div>` : ''}
        <div class="fp-box" data-act="next">
          ${L.who ? `<div class="fp-who">${esc(L.who)}</div>` : ''}
          <div class="fp-text">${esc(L.text)}</div>
          ${atEnd && scene.ask ? `<form class="fp-ask" data-ask><input maxlength="300" autocomplete="off" aria-label="What do you do?" placeholder="What do you do?"><button type="submit">Do it</button></form>` : ''}
          ${scene.ask && atEnd ? '' : `<div class="fp-count">${atEnd && !choices.length ? 'The End · click to finish' : (line + 1) + ' / ' + lines.length}</div>`}
        </div>
      </div>`;
      first = false;
      const box = el.querySelector('[data-ask] input'); if (box) box.focus({ preventScroll: true });
      if (opts.music) music.play(game, scene.music);
      if (opts.onChange) opts.onChange({ scene: scene.id, line });
    }
    function onClick(e) {
      const ch = e.target.closest('[data-choice]');
      if (ch) {
        const c = scene.choices[Number(ch.dataset.choice)];
        if (!c) return;
        if (opts.onChoice) opts.onChoice(scene, c);
        if (opts.onScene) return opts.onScene(c.to);
        const next = scenes.find(s => s.id === c.to); if (next) { scene = next; line = 0; first = true; draw(); }
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'mute') { music.toggleMute(game, scene.music); draw(); return; }
      if (act.dataset.act === 'menu') { if (opts.onMenu) opts.onMenu(); return; }
      const lines = scene.lines && scene.lines.length ? scene.lines : [1];
      if (line < lines.length - 1) { line++; if (opts.onLine) opts.onLine(line); draw(); }
      else if (!(scene.choices || []).length && !scene.ask && opts.onEnd) opts.onEnd(scene);
    }
    function onSubmit(e) {
      const form = e.target.closest('[data-ask]'); if (!form) return;
      e.preventDefault();
      const text = form.querySelector('input').value.trim();
      if (text && opts.onAct) opts.onAct(scene, text);
    }
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    draw();
    return { destroy() { el.removeEventListener('click', onClick); el.removeEventListener('submit', onSubmit); }, state: () => ({ scene: scene.id, line }) };
  }

  // ---------- save slots (player progress) ----------
  // Saved in the browser's localStorage, one set of slots per game.
  const SLOTS = ['1', '2', '3'];
  function saves(game) {
    const key = 'forge-save:' + hash((game.title || '') + '|' + (game.scenes || []).map(s => s.id).join(','));
    const read = () => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } };
    return {
      all: read,
      get: slot => read()[slot] || null,
      put(slot, st) {
        const all = read(); const sc = (game.scenes || []).find(s => s.id === st.scene) || {};
        all[slot] = { scene: st.scene, line: st.line, title: sc.title || '', at: Date.now() };
        try { localStorage.setItem(key, JSON.stringify(all)); return true; } catch (e) { return false; }
      },
    };
  }
  const when = t => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };

  // Full standalone game: title screen → scenes → ending → restart,
  // with autosave, Continue, and three save slots.
  // options.ai: { ready: Promise<boolean>, ask(request): Promise<result> } lets
  // the story carry on with Meta AI after The End. In the Community the novel
  // has no network, so it asks the page around it (see frameBridge).
  function boot(el, source, options) {
    injectCss();
    let ctl = null;
    const game = JSON.parse(JSON.stringify(source)); // the story grows, the project must not
    const store = saves(game);
    const resumable = s => s && (game.scenes || []).some(x => x.id === s.scene);
    const ai = (options && options.ai) || frameBridge();
    const baseCount = (game.scenes || []).length;
    const infKey = 'forge-infinity:' + hash((game.title || '') + '|' + (game.scenes || []).map(s => s.id).join(','));
    let inf = { path: [], memory: { likes: [], dislikes: [], summary: '' }, part: 1, count: 0, ended: 'The End' };
    let endedAt = null; // the ending the player actually reached
    function saveInf() {
      try { localStorage.setItem(infKey, JSON.stringify({ inf, scenes: game.scenes.slice(baseCount), characters: game.characters, backgrounds: game.backgrounds.map(b => ({ name: b.name, desc: b.desc })) })); } catch (e) { /* storage blocked: it just will not resume */ }
    }
    try {
      const was = JSON.parse(localStorage.getItem(infKey));
      if (was && was.inf) {
        inf = was.inf; game.scenes.push(...(was.scenes || []));
        (was.characters || []).forEach(c => { if (!game.characters.some(x => x.name === c.name)) game.characters.push({ name: c.name, desc: c.desc, role: c.role || 'Minor' }); });
        (was.backgrounds || []).forEach(b => { if (!game.backgrounds.some(x => x.name === b.name)) game.backgrounds.push(b); });
      }
    } catch (e) { /* nothing saved */ }
    const gist = s => (s.lines || []).slice(-2).map(l => (l.who && l.who !== 'Narrator' ? l.who + ': ' : '') + l.text).join(' ').slice(0, 240);
    const knows = () => {
      const m = inf.memory || {}, a = [];
      if ((m.likes || []).length) a.push('<b>You seem to enjoy:</b> ' + m.likes.slice(0, 5).map(esc).join(', '));
      if ((m.dislikes || []).length) a.push('<b>You seem to avoid:</b> ' + m.dislikes.slice(0, 4).map(esc).join(', '));
      return a.length ? '<p class="fp-knows">' + a.join('<br>') + '</p>' : '';
    };
    const PARTS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    const partName = n => 'Part ' + (PARTS[n] || n);

    function play(from) {
      if (ctl) ctl.destroy();
      ctl = mount(el, game, {
        scene: from && from.scene, line: from ? from.line : 0, music: true, menu: true, onEnd: ending, onMenu: menu,
        onChange: st => store.put('auto', st),
        onChoice: (s, c) => { inf.path.push({ scene: s.title, gist: gist(s), did: c.text }); saveInf(); },
        onAct: (s, text) => write('next', text, s),
      });
    }
    // Fresh playthrough: the story goes back to the author's, but what it has
    // learned about the player stays.
    function restart() {
      game.scenes.length = baseCount;
      inf = { path: [], memory: { ...inf.memory, summary: '' }, part: 1, count: 0, ended: 'The End' };
      saveInf(); play(null);
    }
    function addCast(r) {
      (r.newCharacters || []).forEach(c => { if (!game.characters.some(x => x.name === c.name)) game.characters.push({ name: c.name, desc: c.desc, role: 'Minor' }); });
      (r.newLocations || []).forEach(l => { if (!game.backgrounds.some(x => x.name === l.name)) game.backgrounds.push({ name: l.name, desc: l.desc }); });
    }
    const lastScene = () => endedAt || game.scenes[game.scenes.length - 1] || {};
    function waitScreen(text, bg) {
      if (ctl) ctl.destroy(); ctl = null;
      el.innerHTML = `<div class="fp-stage"><img class="fp-bg" alt="" src="${bgUrl(game, bg)}"><div class="fp-title"><div class="fp-writing" role="status"><div class="fp-dots"><i></i><i></i><i></i></div><p>${esc(text)}</p><span class="fp-small">Written live by Meta AI</span></div></div></div>`;
    }
    // Ask Meta AI for what comes next. mode: 'next' (one scene) or 'part' (a chapter).
    async function write(mode, action, from) {
      const at = from || lastScene();
      if (action) inf.path.push({ scene: at.title, gist: gist(at), did: action });
      saveInf();
      const part = inf.part + 1, retry = () => { if (action) inf.path.pop(); write(mode, action, from); };
      waitScreen(mode === 'part' ? 'Writing ' + partName(part) + ' from the choices you made…' : 'The story is writing what happens next…', at.bg);
      const fromTitle = el.firstElementChild;
      try {
        const r = await ai.ask({
          mode, action: action || '', part, memory: inf.memory, path: inf.path, lastLocation: at.bg,
          story: { title: game.title, logline: game.logline, characters: game.characters.map(c => ({ name: c.name, desc: c.desc })), locations: game.backgrounds.map(b => ({ name: b.name, desc: b.desc })) },
        });
        if (el.firstElementChild !== fromTitle) return; // the player left this screen
        addCast(r); inf.memory = r.memory || inf.memory;
        if (mode === 'next') {
          const id = 'x' + (++inf.count);
          game.scenes.push({ ...r.scene, id, ask: true, transition: 'Fade', music: at.music || '', choices: [] });
          saveInf(); play({ scene: id, line: 0 });
        } else {
          inf.part = part; inf.ended = 'End of ' + partName(part);
          const pre = 'p' + part + '_';
          r.scenes.forEach(s => game.scenes.push({ ...s, id: pre + s.id, transition: 'Fade', music: at.music || '', choices: s.choices.map(c => ({ text: c.text, to: pre + c.to })) }));
          saveInf();
          el.innerHTML = `<div class="fp-stage"><img class="fp-bg" alt="" src="${bgUrl(game, r.scenes[0].bg)}"><div class="fp-title"><h1>${esc(partName(part))}</h1><p>${esc(r.title || '')}</p>${knows()}<button class="fp-btn" data-begin>Begin</button></div></div>`;
          el.querySelector('[data-begin]').onclick = () => play({ scene: pre + r.scenes[0].id, line: 0 });
        }
      } catch (e) {
        if (el.firstElementChild !== fromTitle) return;
        el.innerHTML = `<div class="fp-stage"><div class="fp-title"><h1>The story paused</h1><p>${esc(e.message || 'Meta AI could not continue.')}</p><div class="fp-row"><button class="fp-btn" data-retry>Try again</button><button class="fp-btn fp-quiet" data-back>Back</button></div></div></div>`;
        el.querySelector('[data-retry]').onclick = retry;
        el.querySelector('[data-back]').onclick = () => { if (action) inf.path.pop(); action ? play({ scene: at.id, line: 99 }) : ending(); };
      }
    }
    function title() {
      if (ctl) ctl.destroy(); ctl = null; music.stop();
      const auto = store.get('auto'); const any = SLOTS.some(s => resumable(store.get(s)));
      el.innerHTML = `<div class="fp-stage"><img class="fp-bg" alt="" src="${bgUrl(game, (game.scenes[0] || {}).bg)}"><div class="fp-title"><h1>${esc(game.title || 'Untitled')}</h1><p>${esc(game.logline || '')}</p>
        <div class="fp-row">${resumable(auto) ? `<button class="fp-btn" data-continue>Continue · ${esc(auto.title)}</button>` : ''}<button class="fp-btn" data-start>${resumable(auto) ? 'New game' : 'Start'}</button>${any ? '<button class="fp-btn" data-load>Load</button>' : ''}</div>
        <span class="fp-small">Made with Game Forge · written with Meta AI</span></div></div>`;
      el.querySelector('[data-start]').onclick = restart;
      const c = el.querySelector('[data-continue]'); if (c) c.onclick = () => play(auto);
      const l = el.querySelector('[data-load]'); if (l) l.onclick = () => panel('load', true);
    }
    function menu() { panel('menu', false); }
    // mode: 'menu' | 'save' | 'load'. fromTitle: Back returns to the title screen.
    function panel(mode, fromTitle) {
      const old = el.querySelector('.fp-panel-wrap'); if (old) old.remove();
      const all = store.all();
      const slotBtn = s => { const v = all[s]; const ok = mode === 'save' || resumable(v);
        return `<button class="fp-slot" data-slot="${s}" ${ok ? '' : 'disabled'}><b>Slot ${s}</b><span>${v ? esc(v.title) + ' · ' + when(v.at) : 'Empty'}</span></button>`; };
      const body = mode === 'menu'
        ? `${knows()}<button class="fp-btn" data-p="save">Save game</button><button class="fp-btn" data-p="load">Load game</button><button class="fp-btn" data-p="title">Title screen</button><button class="fp-btn fp-quiet" data-p="close">Back to game</button>`
        : SLOTS.map(slotBtn).join('') + `<button class="fp-btn fp-quiet" data-p="${fromTitle ? 'title' : 'menu'}">Back</button>`;
      const wrap = document.createElement('div');
      wrap.className = 'fp-panel-wrap';
      wrap.innerHTML = `<div class="fp-panel"><h2>${{ menu: 'Menu', save: 'Save game', load: 'Load game' }[mode]}</h2>${body}<div class="fp-note" hidden></div></div>`;
      wrap.addEventListener('click', e => {
        e.stopPropagation();
        const p = e.target.closest('[data-p]'), s = e.target.closest('[data-slot]');
        if (p) {
          const a = p.dataset.p;
          if (a === 'close') wrap.remove();
          else if (a === 'title') title();
          else panel(a === 'menu' ? 'menu' : a, fromTitle);
        } else if (s && !s.disabled) {
          if (mode === 'save') {
            const ok = ctl && store.put(s.dataset.slot, ctl.state());
            panel('save', fromTitle);
            const n = el.querySelector('.fp-note'); n.hidden = false; n.textContent = ok ? 'Saved to slot ' + s.dataset.slot + '.' : 'Could not save — browser storage is blocked.';
          } else play(store.get(s.dataset.slot));
        }
      });
      (el.querySelector('.fp-stage') || el).appendChild(wrap);
    }
    async function ending(scene) {
      if (ctl) ctl.destroy(); ctl = null;
      if (scene && scene.title) { endedAt = scene; inf.path.push({ scene: scene.title, gist: gist(scene), ending: true }); saveInf(); }
      const at = scene || lastScene(), next = partName(inf.part + 1);
      const draw = can => {
        el.innerHTML = `<div class="fp-stage"><img class="fp-bg" alt="" src="${bgUrl(game, at.bg)}"><div class="fp-title"><h1>${esc(inf.ended)}</h1><p>${esc(game.title || '')}</p>${knows()}
          ${can ? `<p>Want to keep going?</p><div class="fp-row"><button class="fp-mode" data-more="next"><b>Enhanced</b><span>Type what you do. Meta AI writes each scene as you go, for as long as you like.</span></button><button class="fp-mode" data-more="part"><b>${esc(next)}</b><span>Meta AI writes a whole new chapter from your choices, with set choices to pick from.</span></button></div>` : ''}
          <button class="fp-btn ${can ? 'fp-quiet' : ''}" data-again>Play again</button></div></div>`;
        el.querySelector('[data-again]').onclick = title;
        el.querySelectorAll('[data-more]').forEach(b => { b.onclick = () => write(b.dataset.more); });
      };
      draw(false);
      if (ai && await ai.ready && !ctl) draw(true);
    }
    title();
  }

  // In the Community a novel runs sealed off, so it asks the page around it to
  // reach Meta AI. If nobody answers, it is a saved file and simply ends.
  function frameBridge() {
    if (window.parent === window) return null;
    const waiting = {}; let n = 0, yes;
    const ready = new Promise(res => { yes = res; setTimeout(() => res(false), 1500); });
    window.addEventListener('message', e => {
      if (e.source !== window.parent || !e.data || !e.data.forgeInfinity) return;
      const d = e.data.forgeInfinity;
      if (d.type === 'ready') yes(true);
      if (d.type === 'reply' && waiting[d.id]) { const w = waiting[d.id]; delete waiting[d.id]; d.error ? w.rej(new Error(d.error)) : w.res(d.result); }
    });
    window.parent.postMessage({ forgeInfinity: { type: 'hello' } }, '*');
    return { ready, ask: request => new Promise((res, rej) => { const id = ++n; waiting[id] = { res, rej }; window.parent.postMessage({ forgeInfinity: { type: 'ask', id, request } }, '*'); }) };
  }

  window.ForgePlayer = { mount, boot, music, sanitizeSvg, fallbackBg, fallbackChar, bgUrl, charUrl, svgUrl, proceduralTrack, CSS };
})();
