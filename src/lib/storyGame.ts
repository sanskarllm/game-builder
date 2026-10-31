import type { BlueprintLevel, Environment, StoryBlueprint } from './gameBlueprint';
import { hashString, mulberry32 } from './random';

/**
 * A small top-down action-adventure runtime that plays a StoryBlueprint:
 * one room per level, NPC dialogue, items, enemies and an exit that unlocks
 * when the level objective is met.
 */
export const GAME_W = 960;
export const GAME_H = 540;

type Mode = 'intro' | 'play' | 'dialogue' | 'levelComplete' | 'victory' | 'dead';

interface ConvoLine {
  speaker: string;
  color: string;
  text: string;
}

interface Npc {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  convo: ConvoLine[];
  talked: boolean;
}

interface Enemy {
  name: string;
  boss: boolean;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  hit: number;
  wander: number;
}

interface Item {
  name: string;
  x: number;
  y: number;
  taken: boolean;
}

interface Obstacle {
  x: number;
  y: number;
  r: number;
}

const ENV_STYLE: Record<Environment, { ground: string; ground2: string; obstacle: string; top: string; square: boolean }> = {
  forest: { ground: '#2f5d34', ground2: '#2a5530', obstacle: '#1d3b20', top: '#3f7a43', square: false },
  castle: { ground: '#5a5a66', ground2: '#52525d', obstacle: '#3a3a44', top: '#7a7a88', square: true },
  village: { ground: '#6b8f4a', ground2: '#638545', obstacle: '#8a5a3a', top: '#b5533c', square: true },
  city: { ground: '#4a4d55', ground2: '#45484f', obstacle: '#2b2e35', top: '#5a6170', square: true },
  cave: { ground: '#3d3530', ground2: '#38302b', obstacle: '#251f1b', top: '#5a4d44', square: false },
  dungeon: { ground: '#34323a', ground2: '#2f2d35', obstacle: '#1f1d24', top: '#4f4c58', square: true },
  desert: { ground: '#c8a86a', ground2: '#bf9f62', obstacle: '#8a6a3a', top: '#4f9a45', square: false },
  snow: { ground: '#dfe8ef', ground2: '#d5dfe7', obstacle: '#7d8f9c', top: '#f7fbff', square: false },
  sea: { ground: '#d9c79a', ground2: '#cfbd90', obstacle: '#2f6fb0', top: '#5fa0e0', square: false },
  space: { ground: '#1d2233', ground2: '#1a1f2f', obstacle: '#2f3650', top: '#56ccf2', square: true },
  interior: { ground: '#7a5a3f', ground2: '#72543a', obstacle: '#4a3524', top: '#9a7452', square: true },
  field: { ground: '#7aa352', ground2: '#729a4c', obstacle: '#4f6f35', top: '#8fbf5f', square: false },
};

const PLAYER_SPEED = 200;
const PLAYER_R = 14;

export interface StoryGame {
  onKey(key: string): void;
  update(dt: number, keys: Set<string>): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

export function createStoryGame(bp: StoryBlueprint): StoryGame {
  const playerChar = bp.characters.find((c) => c.role === 'player');
  const player = {
    name: playerChar?.name ?? 'Hero',
    color: playerChar?.color ?? '#4f8cff',
    x: 80,
    y: GAME_H / 2,
    hp: 5,
    maxHp: 5,
    fx: 1,
    fy: 0,
    attack: 0,
    invuln: 0,
  };
  let mode: Mode = 'intro';
  let levelIndex = 0;
  let level: BlueprintLevel = bp.levels[0];
  let npcs: Npc[] = [];
  let enemies: Enemy[] = [];
  let items: Item[] = [];
  let obstacles: Obstacle[] = [];
  let tileSeed = 0;
  let monologue: ConvoLine[] = [];
  let dialogue: { lines: ConvoLine[]; index: number; npc?: Npc } | null = null;
  let toasts: { text: string; t: number }[] = [];
  let time = 0;
  let stats = { defeated: 0, collected: 0, talked: 0 };
  const exit = { x: GAME_W - 50, y: GAME_H / 2, r: 24 };

  const charById = new Map(bp.characters.map((c) => [c.id, c]));

  function loadLevel(i: number) {
    levelIndex = i;
    level = bp.levels[i];
    const rand = mulberry32(hashString(level.id + bp.title));
    tileSeed = hashString(level.id);
    player.x = 80;
    player.y = GAME_H / 2;
    player.hp = player.maxHp;
    player.invuln = 0;
    dialogue = null;
    toasts = [];

    const taken: Obstacle[] = [
      { x: player.x, y: player.y, r: 70 },
      { x: exit.x, y: exit.y, r: 80 },
    ];
    const spot = (r: number): { x: number; y: number } => {
      for (let tries = 0; tries < 80; tries++) {
        const x = 150 + rand() * (GAME_W - 300);
        const y = 90 + rand() * (GAME_H - 140);
        if (taken.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 12)) {
          taken.push({ x, y, r });
          return { x, y };
        }
      }
      return { x: 200 + rand() * (GAME_W - 400), y: 100 + rand() * (GAME_H - 200) };
    };

    obstacles = [];
    const nObs = 6 + Math.floor(rand() * 4);
    for (let k = 0; k < nObs; k++) {
      const r = 18 + rand() * 18;
      obstacles.push({ ...spot(r), r });
    }

    // Conversations: each NPC line, plus player replies that follow it.
    const convos = new Map<string, ConvoLine[]>();
    level.npcs.forEach((id) => convos.set(id, []));
    let lastNpc: string | undefined = level.npcs[0];
    const pending: ConvoLine[] = [];
    monologue = [];
    for (const d of level.dialogue) {
      const c = d.speakerId ? charById.get(d.speakerId) : undefined;
      const line = { speaker: d.speaker, color: c?.color ?? '#cfd6e4', text: d.text };
      if (d.speakerId && convos.has(d.speakerId)) {
        const list = convos.get(d.speakerId)!;
        if (pending.length) list.push(...pending.splice(0));
        list.push(line);
        lastNpc = d.speakerId;
      } else if (lastNpc && convos.has(lastNpc) && convos.get(lastNpc)!.length) {
        convos.get(lastNpc)!.push(line);
      } else if (level.npcs.length) {
        pending.push(line);
      } else {
        monologue.push(line);
      }
    }
    if (pending.length && lastNpc) convos.get(lastNpc)?.push(...pending);

    npcs = level.npcs.map((id) => {
      const c = charById.get(id)!;
      const convo = convos.get(id) ?? [];
      return {
        id,
        name: c.name,
        color: c.color,
        ...spot(PLAYER_R),
        convo: convo.length ? convo : [{ speaker: c.name, color: c.color, text: '…' }],
        talked: false,
      };
    });

    enemies = [];
    for (const e of level.enemies) {
      for (let k = 0; k < e.count; k++) {
        const boss = !!e.characterId;
        const p = spot(boss ? 22 : 14);
        enemies.push({ name: e.name, boss, x: p.x, y: p.y, hp: boss ? 6 : 3, maxHp: boss ? 6 : 3, hit: 0, wander: rand() * Math.PI * 2 });
      }
    }
    items = level.items.map((name) => ({ name, ...spot(12), taken: false }));
    mode = 'intro';
  }

  function objectiveProgress(): { done: number; total: number } {
    switch (level.objective.type) {
      case 'defeat': {
        const total = level.enemies.reduce((n, e) => n + e.count, 0);
        return { done: total - enemies.length, total };
      }
      case 'collect':
        return { done: items.filter((i) => i.taken).length, total: items.length };
      case 'talk': {
        const targets = npcs.filter((n) => level.dialogue.some((d) => d.speakerId === n.id));
        return { done: targets.filter((n) => n.talked).length, total: targets.length };
      }
      default:
        return { done: 1, total: 1 };
    }
  }
  const objectiveDone = () => {
    const p = objectiveProgress();
    return p.done >= p.total;
  };

  const toast = (text: string) => toasts.push({ text, t: 2.2 });

  function nearestNpc(): Npc | undefined {
    let best: Npc | undefined;
    let bestD = 56;
    for (const n of npcs) {
      const d = Math.hypot(n.x - player.x, n.y - player.y);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  function attack() {
    player.attack = 0.22;
    for (const e of enemies) {
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d < 64 + (e.boss ? 8 : 0)) {
        e.hp -= 1;
        e.hit = 0.15;
        e.x += (dx / (d || 1)) * 28;
        e.y += (dy / (d || 1)) * 28;
      }
    }
    const before = enemies.length;
    enemies = enemies.filter((e) => {
      if (e.hp <= 0) toast(`${e.name} defeated`);
      return e.hp > 0;
    });
    stats.defeated += before - enemies.length;
  }

  const advanceKeys = new Set(['enter', ' ', 'e', 'click']);

  function onKey(key: string) {
    if (mode === 'intro' && advanceKeys.has(key)) {
      mode = 'play';
      if (monologue.length) {
        dialogue = { lines: monologue, index: 0 };
        monologue = [];
        mode = 'dialogue';
      }
      return;
    }
    if (mode === 'dialogue' && advanceKeys.has(key) && dialogue) {
      dialogue.index++;
      if (dialogue.index >= dialogue.lines.length) {
        if (dialogue.npc && !dialogue.npc.talked) {
          dialogue.npc.talked = true;
          stats.talked++;
        }
        dialogue = null;
        mode = 'play';
      }
      return;
    }
    if (mode === 'levelComplete' && advanceKeys.has(key)) return loadLevel(levelIndex + 1);
    if (mode === 'dead' && advanceKeys.has(key)) return loadLevel(levelIndex);
    if (mode === 'victory' && key === 'enter') {
      stats = { defeated: 0, collected: 0, talked: 0 };
      return loadLevel(0);
    }
    if (mode === 'play') {
      if (key === 'e') {
        const n = nearestNpc();
        if (n) {
          dialogue = { lines: n.convo, index: 0, npc: n };
          mode = 'dialogue';
        }
      } else if (key === ' ' || key === 'j') {
        attack();
      }
    }
  }

  function collide(o: { x: number; y: number }, r: number) {
    for (const ob of obstacles) {
      const dx = o.x - ob.x;
      const dy = o.y - ob.y;
      const d = Math.hypot(dx, dy);
      const min = ob.r + r;
      if (d < min && d > 0) {
        o.x = ob.x + (dx / d) * min;
        o.y = ob.y + (dy / d) * min;
      }
    }
    o.x = Math.max(r + 8, Math.min(GAME_W - r - 8, o.x));
    o.y = Math.max(r + 58, Math.min(GAME_H - r - 8, o.y));
  }

  function update(dt: number, keys: Set<string>) {
    time += dt;
    toasts = toasts.filter((t) => (t.t -= dt) > 0);
    if (mode !== 'play') return;

    let mx = 0;
    let my = 0;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my);
      player.fx = mx / len;
      player.fy = my / len;
      player.x += player.fx * PLAYER_SPEED * dt;
      player.y += player.fy * PLAYER_SPEED * dt;
    }
    collide(player, PLAYER_R);
    player.attack = Math.max(0, player.attack - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    for (const e of enemies) {
      e.hit = Math.max(0, e.hit - dt);
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy);
      const speed = e.boss ? 85 : 70;
      if (d < 260) {
        e.x += (dx / d) * speed * dt;
        e.y += (dy / d) * speed * dt;
      } else {
        e.wander += (Math.random() - 0.5) * dt * 2;
        e.x += Math.cos(e.wander) * 30 * dt;
        e.y += Math.sin(e.wander) * 30 * dt;
      }
      const r = e.boss ? 22 : 14;
      collide(e, r);
      if (d < r + PLAYER_R && player.invuln <= 0) {
        player.hp -= 1;
        player.invuln = 1;
        player.x += (dx / (d || 1)) * 30;
        player.y += (dy / (d || 1)) * 30;
        collide(player, PLAYER_R);
        if (player.hp <= 0) mode = 'dead';
      }
    }

    for (const it of items) {
      if (!it.taken && Math.hypot(it.x - player.x, it.y - player.y) < PLAYER_R + 14) {
        it.taken = true;
        stats.collected++;
        toast(`Found the ${it.name}`);
      }
    }

    if (objectiveDone() && Math.hypot(exit.x - player.x, exit.y - player.y) < exit.r + PLAYER_R) {
      mode = levelIndex >= bp.levels.length - 1 ? 'victory' : 'levelComplete';
    }
  }

  // ---------- rendering ----------

  function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = 'rgba(12, 14, 20, 0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();
  }

  function card(ctx: CanvasRenderingContext2D, title: string, body: string[], footer: string) {
    const w = 620;
    ctx.font = '15px system-ui, sans-serif';
    const lines = body.flatMap((b) => [...wrap(ctx, b, w - 60), '']);
    const h = 120 + lines.length * 21;
    const x = (GAME_W - w) / 2;
    const y = (GAME_H - h) / 2;
    panel(ctx, x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, GAME_W / 2, y + 46);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = '#c9d1e0';
    lines.forEach((l, i) => ctx.fillText(l, GAME_W / 2, y + 82 + i * 21));
    ctx.fillStyle = '#9d8cff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(footer, GAME_W / 2, y + h - 22);
    ctx.textAlign = 'left';
  }

  function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff') {
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = ctx.measureText(text).width + 10;
    ctx.fillRect(x - w / 2, y - 12, w, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }

  function drawWorld(ctx: CanvasRenderingContext2D) {
    const style = ENV_STYLE[level.environment];
    ctx.fillStyle = style.ground;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    const tile = 48;
    for (let tx = 0; tx < GAME_W / tile; tx++) {
      for (let ty = 0; ty < GAME_H / tile; ty++) {
        if (hashString(`${tileSeed}:${tx}:${ty}`) % 3 === 0) {
          ctx.fillStyle = style.ground2;
          ctx.fillRect(tx * tile, ty * tile, tile, tile);
        }
      }
    }
    if (level.environment === 'space') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let k = 0; k < 60; k++) {
        const h = hashString(`star${k}${tileSeed}`);
        ctx.fillRect(h % GAME_W, (h >>> 10) % GAME_H, 2, 2);
      }
    }

    for (const ob of obstacles) {
      ctx.fillStyle = style.obstacle;
      if (style.square) {
        ctx.fillRect(ob.x - ob.r, ob.y - ob.r, ob.r * 2, ob.r * 2);
        ctx.fillStyle = style.top;
        ctx.fillRect(ob.x - ob.r + 4, ob.y - ob.r + 4, ob.r * 2 - 8, ob.r - 4);
      } else {
        ctx.beginPath();
        ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = style.top;
        ctx.beginPath();
        ctx.arc(ob.x - ob.r * 0.25, ob.y - ob.r * 0.25, ob.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // exit
    const open = objectiveDone();
    const pulse = 0.6 + Math.sin(time * 4) * 0.2;
    ctx.fillStyle = open ? `rgba(80, 230, 160, ${pulse})` : 'rgba(120,120,130,0.8)';
    ctx.beginPath();
    ctx.arc(exit.x, exit.y, exit.r, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, open ? 'EXIT' : 'LOCKED', exit.x, exit.y - exit.r - 6, open ? '#7dffc4' : '#bbbbbb');

    for (const it of items) {
      if (it.taken) continue;
      const bob = Math.sin(time * 3 + it.x) * 3;
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      ctx.moveTo(it.x, it.y - 10 + bob);
      ctx.lineTo(it.x + 8, it.y + bob);
      ctx.lineTo(it.x, it.y + 10 + bob);
      ctx.lineTo(it.x - 8, it.y + bob);
      ctx.closePath();
      ctx.fill();
      label(ctx, it.name, it.x, it.y - 16 + bob, '#ffe98a');
    }

    for (const n of npcs) {
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, PLAYER_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.name.charAt(0), n.x, n.y + 5);
      ctx.textAlign = 'left';
      label(ctx, n.talked ? n.name : `${n.name} !`, n.x, n.y - PLAYER_R - 6, n.talked ? '#ffffff' : '#ffe98a');
    }

    for (const e of enemies) {
      const r = e.boss ? 22 : 14;
      ctx.fillStyle = e.hit > 0 ? '#ffffff' : e.boss ? '#b3261e' : '#d9534f';
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(e.x - 6, e.y - 4, 4, 4);
      ctx.fillRect(e.x + 2, e.y - 4, 4, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - r, e.y - r - 8, r * 2, 4);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(e.x - r, e.y - r - 8, (r * 2 * e.hp) / e.maxHp, 4);
      if (e.boss) label(ctx, e.name, e.x, e.y - r - 14, '#ff9a9a');
    }

    // player
    if (!(player.invuln > 0 && Math.floor(time * 12) % 2 === 0)) {
      ctx.fillStyle = player.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(player.x + player.fx * 8, player.y + player.fy * 8, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (player.attack > 0) {
      const a = Math.atan2(player.fy, player.fx);
      ctx.strokeStyle = `rgba(255,255,255,${player.attack * 4})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 40, a - 1.1, a + 1.1);
      ctx.stroke();
    }

    if (level.time === 'night') {
      ctx.fillStyle = 'rgba(10, 15, 45, 0.38)';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    } else if (level.time === 'dusk') {
      ctx.fillStyle = 'rgba(120, 50, 20, 0.18)';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }
  }

  function drawHud(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(10,12,18,0.78)';
    ctx.fillRect(0, 0, GAME_W, 50);
    ctx.fillStyle = '#9d8cff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(`LEVEL ${levelIndex + 1}/${bp.levels.length}`, 16, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(level.name, 16, 40);
    const p = objectiveProgress();
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = objectiveDone() ? '#7dffc4' : '#e6e9ef';
    const objText = `${objectiveDone() ? '✔' : '◆'} ${level.objective.description}${p.total > 1 ? ` (${p.done}/${p.total})` : ''}`;
    ctx.textAlign = 'center';
    ctx.fillText(objText, GAME_W / 2, 31);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff6b8a';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('♥'.repeat(Math.max(0, player.hp)) + '♡'.repeat(Math.max(0, player.maxHp - player.hp)), GAME_W - 16, 32);
    ctx.textAlign = 'left';

    const near = mode === 'play' ? nearestNpc() : undefined;
    if (near) label(ctx, `E — talk to ${near.name}`, player.x, player.y + PLAYER_R + 22, '#ffe98a');

    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'right';
    ctx.fillText('WASD / arrows move · E talk · Space attack', GAME_W - 12, GAME_H - 10);
    ctx.textAlign = 'left';

    toasts.forEach((t, i) => {
      ctx.globalAlpha = Math.min(1, t.t);
      label(ctx, t.text, GAME_W / 2, 80 + i * 22, '#7dffc4');
      ctx.globalAlpha = 1;
    });
  }

  function drawDialogue(ctx: CanvasRenderingContext2D) {
    if (!dialogue) return;
    const line = dialogue.lines[dialogue.index];
    const x = 40;
    const w = GAME_W - 80;
    const h = 130;
    const y = GAME_H - h - 24;
    panel(ctx, x, y, w, h);
    ctx.fillStyle = line.color;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(line.speaker, x + 22, y + 32);
    ctx.fillStyle = '#e6e9ef';
    ctx.font = '16px system-ui, sans-serif';
    wrap(ctx, line.text, w - 44)
      .slice(0, 3)
      .forEach((l, i) => ctx.fillText(l, x + 22, y + 60 + i * 22));
    ctx.fillStyle = '#9d8cff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${dialogue.index + 1}/${dialogue.lines.length}  ▼ E / Space`, x + w - 18, y + h - 14);
    ctx.textAlign = 'left';
  }

  function draw(ctx: CanvasRenderingContext2D) {
    drawWorld(ctx);
    drawHud(ctx);
    if (mode === 'dialogue') drawDialogue(ctx);
    if (mode === 'intro') {
      card(ctx, level.name, [...level.narration, `Objective: ${level.objective.description}`], 'Press Enter or click to begin');
    }
    if (mode === 'levelComplete') {
      card(ctx, 'Level complete', [`${level.name} cleared.`, `Next: ${bp.levels[levelIndex + 1]?.name ?? ''}`], 'Press Enter to continue');
    }
    if (mode === 'dead') card(ctx, 'You fell', ['The story is not over yet.'], 'Press Enter to retry the level');
    if (mode === 'victory') {
      card(
        ctx,
        `The End — ${bp.title}`,
        [
          `${player.name} finished all ${bp.levels.length} levels.`,
          `Enemies defeated: ${stats.defeated} · Items found: ${stats.collected} · Conversations: ${stats.talked}`,
        ],
        'Press Enter to play again',
      );
    }
  }

  if (bp.levels.length) loadLevel(0);
  return { onKey, update, draw };
}
