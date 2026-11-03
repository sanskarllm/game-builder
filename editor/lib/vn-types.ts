export interface CharacterAsset {
  id: string;
  name: string;
  url: string;
  expression: string;
}

export interface BackgroundAsset {
  id: string;
  name: string;
  url: string;
}

export interface MusicAsset {
  id: string;
  name: string;
  url: string;
}

export type CharacterPosition =
  | "far-left"
  | "left"
  | "center"
  | "right"
  | "far-right";

export interface SceneCharacter {
  characterId: string;
  position: CharacterPosition;
}

export interface Choice {
  text: string;
  nextNodeId: string;
  /**
   * Optional assignment run when the player takes this choice, e.g.
   * `trust += 1`, `hasLantern = true`, `route = quiet`. Parsed by
   * `applyEffect` in `vn-vars.ts`.
   */
  effect?: string;
  /**
   * Optional gate, e.g. `trust >= 2` or `hasLantern`. When it evaluates
   * false the choice is hidden — or shown greyed out if `showLocked` is
   * set. An absent/blank condition always passes.
   */
  condition?: string;
  /** Show a failed-condition choice as disabled instead of hiding it. */
  showLocked?: boolean;
}

/**
 * Automatic movement for a global value. The same shape drives the in-game
 * clock and any author-declared value, so there is one control to learn.
 *
 * "A full day every 10 real minutes" is
 * `{ mode: "realtime", amount: 1440, perSeconds: 600 }`.
 */
export interface ValueTick {
  /** "realtime" moves with the wall clock; "step" moves per player advance. */
  mode: "realtime" | "step";
  /** Units added each tick. Negative counts down. */
  amount: number;
  /** realtime only: how many real seconds one tick takes. */
  perSeconds?: number;
}

/** How a value is rendered to the player. */
export type ValueDisplay = "number" | "clock" | "bool" | "text";

/** A story-wide variable the author declares and choices mutate. */
export type VariableType = "int" | "bool" | "string";

export interface Variable {
  name: string;
  type: VariableType;
  /** Initial value, stored as text and coerced by `type` at play time. */
  init: string;
  /** Optional automatic movement — see ValueTick. */
  tick?: ValueTick;
  /** Friendly name shown to the player; defaults to `name`. */
  label?: string;
  /** How to render it; "clock" formats a minutes count via formatClock(). */
  display?: ValueDisplay;
  /** Show as a corner chip during play. Defaults to true. */
  showInHud?: boolean;
  /** Include on the status panel. */
  showInPanel?: boolean;
}

/**
 * How a node reads on the story map. Derived from the shape of the graph
 * rather than stored, so it can never drift out of sync with the choices.
 */
export type NodeKind = "scene" | "choice" | "ending";

export function nodeKind(scene: Pick<SceneNode, "choices">): NodeKind {
  const n = scene.choices?.length ?? 0;
  if (n === 0) return "ending";
  if (n > 1) return "choice";
  return "scene";
}

/**
 * An invisible (or optionally outlined) clickable region layered over the
 * scene. Coordinates and sizes are stored as percentages of the stage (0-100)
 * so they render identically in the editor, the player, and the export.
 */
export interface Hotspot {
  id: string;
  /** X of the top-left corner, in % of stage width. */
  x: number;
  /** Y of the top-left corner, in % of stage height. */
  y: number;
  /** Width, in % of stage width. */
  w: number;
  /** Height, in % of stage height. */
  h: number;
  /** Author-facing label (also used as an accessible name). */
  label: string;
  /** What happens when the player clicks it. */
  action: "goto" | "advanceTime" | "none";
  /** Target scene for `goto`. */
  targetNodeId?: string;
  /** Minutes to advance the clock for `advanceTime`. */
  advanceMinutes?: number;
  /** If true, the region is faintly outlined at play time instead of invisible. */
  showOutline?: boolean;
}

/** Per-scene manipulation of the in-game clock. */
export interface SceneTime {
  /** "set" jumps to `value` minutes-since-midnight; "advance" adds `value`. */
  mode: "set" | "advance";
  /** Minutes. For "set" this is minutes since midnight (0-1439). */
  value: number;
}

export interface SceneNode {
  id: string;
  title: string;
  dialogue: string;
  speakerId: string;
  /**
   * Staging fields are INHERITED when absent: `undefined` means "unchanged
   * from the scene the player arrived from", so a run of dialogue only has
   * to state what actually changes. Note the distinction for `musicId`:
   * `undefined` inherits, `""` explicitly stops the music. Use the helpers
   * in `vn-vars.ts` (`resolveStaging` / `resolveStagingStatic`) rather than
   * reading these directly.
   */
  characters?: SceneCharacter[];
  backgroundId?: string;
  musicId?: string;
  choices: Choice[];
  hotspots?: Hotspot[];
  /** Optional clock action applied when this scene is entered. */
  time?: SceneTime;
  visualPosition?: { x: number; y: number };
  isAiGenerated?: boolean;
}

export interface ProjectAssets {
  characters: CharacterAsset[];
  backgrounds: BackgroundAsset[];
  music: MusicAsset[];
}

/** Project-wide in-game clock configuration. */
export interface TimeConfig {
  /** Master switch for the whole time system. */
  enabled: boolean;
  /** Starting time, minutes since midnight (0-1439). */
  startMinutes: number;
  /** 12h or 24h display. */
  format: "12h" | "24h";
  /** Tint the stage based on time of day (dawn/day/dusk/night). */
  dayNightTint: boolean;
  /**
   * Optional automatic advance. Without it the clock only moves when a scene's
   * `time` action, a hotspot, or a choice effect moves it.
   */
  tick?: ValueTick;
}

export const DEFAULT_TIME_CONFIG: TimeConfig = {
  enabled: false,
  startMinutes: 8 * 60, // 08:00
  format: "24h",
  dayNightTint: true,
};
export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * A button placed on an overlay panel. Coordinates are percentages of the
 * panel, the same convention `Hotspot` uses over the stage.
 */
export interface OverlayPanelButton {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: "goto" | "effect" | "close" | "none";
  targetNodeId?: string;
  /** Runs on click — same expression engine as a choice. */
  effect?: string;
  /** Hides the button unless this passes — same engine as a choice. */
  condition?: string;
  /** Outline the region at play time instead of leaving it invisible. */
  showOutline?: boolean;
}

/** What opens when a persistent button is clicked. */
export interface OverlayPanel {
  /** "buttons" is a map/image with placed buttons; "values" is the status screen. */
  kind: "buttons" | "values";
  title?: string;
  /** Background image. Without one, buttons fall back to a plain list. */
  imageUrl?: string;
  buttons: OverlayPanelButton[];
}

/**
 * A button pinned to a corner of the stage for the whole novel — a map, a
 * phone, a character sheet.
 */
export interface OverlayButton {
  id: string;
  label: string;
  /**
   * An emoji, or an image URL. Emoji are used rather than an icon library so
   * the button renders identically in the editor preview and in the exported
   * game, which has no React and no icon dependency.
   */
  icon: string;
  corner: OverlayCorner;
  /** Only shown when this passes. */
  condition?: string;
  /** Scenes where it is hidden, e.g. endings or a title card. */
  hiddenOnScenes?: string[];
  panel?: OverlayPanel;
}
export function isVideoUrl(url: string): boolean {
  return /^data:video\//.test(url) || /\.(mp4|webm|ogv)(\?|#|$)/i.test(url);
}

/* ---------- Time helpers (shared by editor, player and export) ---------- */

export function normalizeMinutes(m: number): number {
  const mod = ((m % 1440) + 1440) % 1440;
  return Math.floor(mod);
}

export function formatClock(minutes: number, format: "12h" | "24h"): string {
  const m = normalizeMinutes(minutes);
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  if (format === "24h") return `${String(h24).padStart(2, "0")}:${mm}`;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${period}`;
}

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

export function timeOfDay(minutes: number): TimeOfDay {
  const m = normalizeMinutes(minutes);
  if (m >= 5 * 60 && m < 8 * 60) return "dawn";
  if (m >= 8 * 60 && m < 17 * 60) return "day";
  if (m >= 17 * 60 && m < 20 * 60) return "dusk";
  return "night";
}

/** A CSS overlay color (rgba) for a given time of day, or null for full day. */
export function dayNightOverlay(minutes: number): string | null {
  switch (timeOfDay(minutes)) {
    case "dawn":
      return "rgba(255, 170, 120, 0.18)";
    case "day":
      return null;
    case "dusk":
      return "rgba(255, 120, 60, 0.22)";
    case "night":
      return "rgba(10, 20, 60, 0.45)";
  }
}
