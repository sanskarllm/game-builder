/**
 * @fileOverview Story variables and staging inheritance.
 *
 * Two small runtimes shared by the editor, the in-app player and the exported
 * game, so a story behaves identically in all three:
 *
 *  - Variables: author-declared flags that choices WRITE (`effect`) and gate
 *    on (`condition`). Deliberately not JS `eval` — a tiny hand-rolled parser
 *    keeps exported games free of arbitrary code execution.
 *  - Staging inheritance: a scene may omit background/characters/music, which
 *    means "unchanged from where the player came from".
 */

import type {
  SceneCharacter,
  SceneNode,
  ValueTick,
  Variable,
  VariableType,
} from "./vn-types";

export type VarValue = number | boolean | string;
export type VarBag = Record<string, VarValue>;

/* ------------------------------ variables ------------------------------ */

/** Coerce an author-typed initial value to the declared type. */
export function coerceValue(raw: string, type: VariableType): VarValue {
  const t = (raw ?? "").trim();
  if (type === "int") {
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "bool") return t === "true" || t === "1" || t === "yes";
  return t;
}

/** Build the starting variable bag from the project's declarations. */
export function initVars(variables?: Variable[]): VarBag {
  const bag: VarBag = {};
  (variables || []).forEach(v => {
    const name = (v.name || "").trim();
    if (!name) return;
    bag[name] = coerceValue(v.init, v.type);
  });
  return bag;
}

/**
 * Reserved names that are projected into the bag for evaluation but are not
 * author-declared variables. Kept out of saves and out of the HUD.
 */
export const RESERVED_VARS = new Set(["time"]);

/**
 * Read a clock literal as minutes since midnight: "22:00", "10pm", "10:30pm",
 * "9am". Returns null for anything else.
 *
 * Deliberately strict: a BARE number is never a time, so `trust >= 10` keeps
 * comparing against the number 10 rather than 10:00.
 */
export function parseTimeLiteral(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");

  // 22:00 / 9:30  (with an optional am/pm suffix)
  const hhmm = /^(\d{1,2}):(\d{2})(am|pm)?$/.exec(t);
  if (hhmm) {
    let h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (m > 59) return null;
    const suffix = hhmm[3];
    if (suffix) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (suffix === "pm" ? 12 : 0);
    } else if (h > 23) return null;
    return h * 60 + m;
  }

  // 10pm / 9am — a bare hour is only a time when it carries a suffix.
  const bare = /^(\d{1,2})(am|pm)$/.exec(t);
  if (bare) {
    const h = Number(bare[1]);
    if (h < 1 || h > 12) return null;
    return ((h % 12) + (bare[2] === "pm" ? 12 : 0)) * 60;
  }

  return null;
}

/** Parse a bare literal the way an author would expect it to read. */
function literal(raw: string): VarValue {
  const t = raw.trim().replace(/^["'](.*)["']$/, "$1");
  if (t === "true") return true;
  if (t === "false") return false;
  const clock = parseTimeLiteral(t);
  if (clock !== null) return clock;
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : t;
}

/**
 * Project the in-game clock into the bag so conditions can read `time` and
 * effects can write it. The clock stays authoritative in the player's own
 * state; this is only ever a view of it.
 */
export function withClock(vars: VarBag, minutes: number): VarBag {
  return { ...vars, time: minutes };
}

/**
 * Split the clock back out after an effect ran. `minutes` is null when the
 * expression left `time` alone.
 */
export function extractClock(bag: VarBag): { vars: VarBag; minutes: number | null } {
  const vars: VarBag = {};
  let minutes: number | null = null;
  for (const [key, value] of Object.entries(bag)) {
    if (key === "time") {
      const n = Number(value);
      minutes = Number.isFinite(n) ? n : null;
    } else {
      vars[key] = value;
    }
  }
  return { vars, minutes };
}

/** Resolve an operand: a known variable name, else a literal. */
function operand(raw: string, vars: VarBag): VarValue {
  const t = raw.trim();
  if (Object.prototype.hasOwnProperty.call(vars, t)) return vars[t];
  return literal(t);
}

const ASSIGN_RE = /^\s*([A-Za-z_]\w*)\s*(\+=|-=|=)\s*(.+?)\s*$/;

/**
 * Apply one assignment (`trust += 1`, `route = quiet`, `hasLantern = true`)
 * and return a NEW bag. Unparseable or empty effects are a no-op, so a
 * half-typed expression in the editor can never break a playthrough.
 */
export function applyEffect(expr: string | undefined, vars: VarBag): VarBag {
  const m = ASSIGN_RE.exec(expr || "");
  if (!m) return vars;
  const [, name, op, rhs] = m;
  const next: VarBag = { ...vars };
  const value = operand(rhs, vars);

  if (op === "=") {
    next[name] = value;
    return next;
  }
  // += / -= are numeric; treat a missing or non-numeric current value as 0.
  const current = Number(next[name] ?? 0);
  const delta = Number(value);
  if (!Number.isFinite(delta)) return vars;
  next[name] = (Number.isFinite(current) ? current : 0) + (op === "+=" ? delta : -delta);
  return next;
}

/** Apply several effects in order (used by the editor's "test run"). */
export function applyEffects(exprs: (string | undefined)[], vars: VarBag): VarBag {
  return exprs.reduce<VarBag>((acc, e) => applyEffect(e, acc), vars);
}

const COMPARE_RE = /^\s*(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+?)\s*$/;

/** Evaluate one comparison, or a bare truthiness test. */
function evalClause(clause: string, vars: VarBag): boolean {
  const t = clause.trim();
  if (!t) return true;

  if (t.startsWith("!")) return !evalClause(t.slice(1), vars);

  const m = COMPARE_RE.exec(t);
  if (!m) {
    const v = operand(t, vars);
    // A bare name is a truthiness test: `hasLantern`, or `trust` (non-zero).
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    return v !== "" && v !== "false";
  }

  const [, lhsRaw, op, rhsRaw] = m;
  const a = operand(lhsRaw, vars);
  const b = operand(rhsRaw, vars);

  switch (op) {
    case "==": return String(a) === String(b);
    case "!=": return String(a) !== String(b);
    default: {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
      if (op === ">=") return na >= nb;
      if (op === "<=") return na <= nb;
      if (op === ">") return na > nb;
      return na < nb;
    }
  }
}

/**
 * Evaluate a choice condition. Supports `&&` / `and` and `||` / `or` between
 * comparisons, with `&&` binding tighter. A blank condition always passes.
 */
export function evalCondition(expr: string | undefined, vars: VarBag): boolean {
  const t = (expr || "").trim();
  if (!t) return true;
  return t
    .split(/\s*(?:\|\||\bor\b)\s*/i)
    .some(orPart =>
      orPart
        .split(/\s*(?:&&|\band\b)\s*/i)
        .every(andPart => evalClause(andPart, vars)),
    );
}

/** The choices currently selectable, with locked ones flagged for the UI. */
export function visibleChoices<T extends { condition?: string; showLocked?: boolean }>(
  choices: T[] | undefined,
  vars: VarBag,
): { choice: T; locked: boolean }[] {
  return (choices || [])
    .map(choice => ({ choice, locked: !evalCondition(choice.condition, vars) }))
    .filter(({ choice, locked }) => !locked || !!choice.showLocked);
}

/* -------------------------- automatic ticking -------------------------- */

/** One value that moves on its own. `name` is "time" or a variable name. */
export interface TickTarget {
  name: string;
  tick: ValueTick;
}

/** Seconds banked per target, so a slow rate still fires exactly on schedule. */
export type TickCarry = Record<string, number>;

/**
 * Everything that ticks, the clock included. Kept in one place so the player
 * and the exported game can never disagree about what moves.
 */
export function tickTargets(variables: Variable[] | undefined, clockTick?: ValueTick): TickTarget[] {
  const targets: TickTarget[] = [];
  if (clockTick && clockTick.amount) targets.push({ name: "time", tick: clockTick });
  (variables || []).forEach(v => {
    const name = (v.name || "").trim();
    if (name && v.tick && v.tick.amount) targets.push({ name, tick: v.tick });
  });
  return targets;
}

/**
 * Advance every real-time target by `elapsedSeconds`.
 *
 * Leftover time is BANKED per target rather than dropped, so "+1440 every 600s"
 * stays exact no matter how often this is called, and a rate slower than the
 * caller's interval still fires.
 */
export function applyRealtimeTicks(
  bag: VarBag,
  targets: TickTarget[],
  elapsedSeconds: number,
  carry: TickCarry,
): { bag: VarBag; carry: TickCarry } {
  let next = bag;
  const nextCarry: TickCarry = { ...carry };

  for (const { name, tick } of targets) {
    if (tick.mode !== "realtime") continue;
    const per = Math.max(0.001, tick.perSeconds ?? 1);
    const banked = (nextCarry[name] ?? 0) + Math.max(0, elapsedSeconds);
    const steps = Math.floor(banked / per);
    nextCarry[name] = banked - steps * per;
    if (steps > 0) {
      const current = Number(next[name] ?? 0);
      next = { ...next, [name]: (Number.isFinite(current) ? current : 0) + steps * tick.amount };
    }
  }
  return { bag: next, carry: nextCarry };
}

/** Advance every per-step target by exactly one step. */
export function applyStepTicks(bag: VarBag, targets: TickTarget[]): VarBag {
  let next = bag;
  for (const { name, tick } of targets) {
    if (tick.mode !== "step") continue;
    const current = Number(next[name] ?? 0);
    next = { ...next, [name]: (Number.isFinite(current) ? current : 0) + tick.amount };
  }
  return next;
}

/** Human-readable problem with an expression, or null when it's fine. */
export function validateExpression(expr: string, kind: "effect" | "condition"): string | null {
  const t = (expr || "").trim();
  if (!t) return null;
  if (kind === "effect") {
    return ASSIGN_RE.test(t) ? null : 'Expected something like "trust += 1" or "route = quiet".';
  }
  const clauses = t.split(/\s*(?:\|\||\bor\b|&&|\band\b)\s*/i).map(s => s.trim()).filter(Boolean);
  if (!clauses.length) return "Empty condition.";
  return null;
}

/* -------------------------- staging inheritance -------------------------- */

export interface Staging {
  backgroundId: string;
  characters: SceneCharacter[];
  musicId: string;
}

export const EMPTY_STAGING: Staging = { backgroundId: "", characters: [], musicId: "" };

/**
 * Resolve a scene's staging against what was on screen when the player
 * arrived. `undefined` inherits; an explicit value (including `""` for
 * music) overrides.
 */
export function resolveStaging(scene: SceneNode | undefined, inherited: Staging): Staging {
  if (!scene) return inherited;
  return {
    backgroundId: scene.backgroundId ?? inherited.backgroundId,
    characters: scene.characters ?? inherited.characters,
    musicId: scene.musicId ?? inherited.musicId,
  };
}

/**
 * Best-effort staging for the EDITOR, which has no playback history: walk
 * back through the graph while each step has exactly one incoming edge, so a
 * linear run of dialogue previews correctly. Ambiguous joins stop the walk.
 */
export function resolveStagingStatic(
  scenes: Record<string, SceneNode>,
  sceneId: string,
  maxDepth = 50,
): Staging {
  const chain: SceneNode[] = [];
  const seen = new Set<string>();
  let id: string | undefined = sceneId;

  while (id && !seen.has(id) && chain.length < maxDepth) {
    const node: SceneNode | undefined = scenes[id];
    if (!node) break;
    seen.add(id);
    chain.unshift(node);

    // Stop as soon as everything is pinned down — nothing left to inherit.
    if (node.backgroundId !== undefined && node.characters !== undefined && node.musicId !== undefined) {
      break;
    }

    const parents = Object.values(scenes).filter(s =>
      (s.choices || []).some(c => c.nextNodeId === id),
    );
    id = parents.length === 1 ? parents[0].id : undefined;
  }

  return chain.reduce<Staging>((acc, node) => resolveStaging(node, acc), EMPTY_STAGING);
}
