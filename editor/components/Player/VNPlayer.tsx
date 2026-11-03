"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { SceneNode, ProjectAssets, CharacterPosition, TimeConfig, Variable, Choice, OverlayButton, OverlayCorner, OverlayPanelButton, normalizeMinutes, formatClock, dayNightOverlay, isVideoUrl } from "@/lib/vn-types";
import {
  applyEffect,
  applyRealtimeTicks,
  applyStepTicks,
  evalCondition,
  extractClock,
  RESERVED_VARS,
  initVars,
  resolveStaging,
  resolveStagingStatic,
  tickTargets,
  visibleChoices,
  withClock,
  type Staging,
  type TickCarry,
  type VarBag,
  type VarValue,
} from "@/lib/vn-vars";
import { Button } from "@/components/ui/button";
import { X, LogOut, Clock, Undo2, ScrollText, FastForward, Play, Save, FolderOpen, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface HistoryEntry {
  nodeId: string;
  minutes: number;
  /** Snapshot taken BEFORE moving, so BACK restores state exactly. */
  vars: VarBag;
  staging: Staging;
}

interface BacklogEntry {
  speaker: string;
  text: string;
}



interface VNPlayerProps {
  projectId: string;
  scenes: Record<string, SceneNode>;
  assets: ProjectAssets;
  timeConfig?: TimeConfig;
  /** Author-declared story variables; choices read and write these. */
  variables?: Variable[];
  /** Where to begin — defaults to "start". Set by the editor's Play from here. */
  startNodeId?: string;
  /** Buttons pinned on screen for the whole novel. */
  overlays?: OverlayButton[];
  onExit: () => void;
}

/** A pinned button's face — an emoji, or an image when given a URL. */
function OverlayIcon({ icon }: { icon: string }) {
  if (/^(https?:|data:|blob:)/i.test(icon)) {
    return <img src={icon} alt="" className="w-6 h-6 object-contain" />;
  }
  return <span className="text-xl leading-none">{icon || "\u2605"}</span>;
}

const CORNER_POS: Record<OverlayCorner, string> = {
  "top-left": "",                                  // shares the top-left column
  "top-right": "",                                 // shares the exit-button row
  "bottom-left": "fixed bottom-6 left-6 z-[600]",
  "bottom-right": "fixed bottom-6 right-6 z-[600]",
};

const posClasses: Record<CharacterPosition, string> = {
  "far-left": "left-[10%] -translate-x-1/2 scale-75",
  "left": "left-[25%] -translate-x-1/2 scale-85",
  "center": "left-1/2 -translate-x-1/2 scale-100",
  "right": "left-[75%] -translate-x-1/2 scale-85",
  "far-right": "left-[90%] -translate-x-1/2 scale-75",
};

export function VisualNovelPlayer({ projectId, scenes, assets, timeConfig, variables, overlays, startNodeId, onExit }: VNPlayerProps) {
  const PREVIEW_SAVE_KEY = "game-builder-preview:" + projectId;
  const firstId =
    (startNodeId && scenes[startNodeId] && startNodeId) ||
    (scenes["start"] ? "start" : Object.keys(scenes)[0] || "start");
  const [currentId, setCurrentId] = useState(firstId);
  const [clockMinutes, setClockMinutes] = useState(timeConfig?.startMinutes ?? 0);
  const [vars, setVars] = useState<VarBag>(() => initVars(variables));
  /**
   * What is currently on stage. Scenes that omit a background/cast/track
   * inherit it, so we carry it forward across navigation rather than reading
   * it off the scene. Starting mid-story resolves statically up the graph so
   * "Play from here" doesn't open on a blank stage.
   */
  const [staging, setStaging] = useState<Staging>(() => resolveStagingStatic(scenes, firstId));
  // Table-stakes VN runtime features: rollback, backlog, auto, skip, save/load.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [backlog, setBacklog] = useState<BacklogEntry[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const [skipMode, setSkipMode] = useState(false);
  const [showLog, setShowLog] = useState(false);
  /** Which pinned button's panel is open, if any. */
  const [openOverlayId, setOpenOverlayId] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentMusicIdRef = useRef<string | null>(null);
  const appliedTimeForSceneRef = useRef<string | null>(null);
  const loggedSceneRef = useRef<string | null>(null);

  const scene = scenes[currentId];

  // Apply the scene's clock action exactly once per scene entry.
  useEffect(() => {
    if (!timeConfig?.enabled || !scene?.time) return;
    if (appliedTimeForSceneRef.current === currentId) return;
    appliedTimeForSceneRef.current = currentId;
    setClockMinutes(prev =>
      scene.time!.mode === "set"
        ? normalizeMinutes(scene.time!.value)
        : normalizeMinutes(prev + scene.time!.value)
    );
  }, [currentId, scene, timeConfig?.enabled]);

  // Append each visited scene's line to the backlog (once per entry).
  useEffect(() => {
    if (!scene || loggedSceneRef.current === currentId) return;
    loggedSceneRef.current = currentId;
    const speakerName = assets.characters.find(c => c.id === scene.speakerId)?.name
      || (scene.speakerId ? "???" : "Narrator");
    setBacklog(prev => [...prev.slice(-199), { speaker: speakerName, text: scene.dialogue || "" }]);
  }, [currentId, scene, assets.characters]);

  /**
   * Everything that moves on its own — the clock plus any value with a tick.
   */
  const targets = useMemo(
    () => tickTargets(variables, timeConfig?.tick),
    [variables, timeConfig?.tick],
  );

  /**
   * The bag conditions and effects see. The clock is projected in as `time`
   * so `time >= 22:00` works, but it stays authoritative in clockMinutes.
   */
  const evalVars = withClock(vars, clockMinutes);

  /** Write a bag back out, splitting the clock from the saved variables. */
  const commitBag = (bag: VarBag) => {
    const { vars: nextVars, minutes } = extractClock(bag);
    setVars(nextVars);
    if (minutes !== null) setClockMinutes(normalizeMinutes(minutes));
  };

  /** Run an effect without navigating (used by overlay panel buttons). */
  const runEffect = (effect?: string) => {
    if (effect) commitBag(applyEffect(effect, evalVars));
  };

  /** The choices the player can actually see right now, given the values. */
  const available = visibleChoices<Choice>(scene?.choices, evalVars);
  /** Exactly one open path — what AUTO/SKIP and a click on the box follow. */
  const soleOpenChoice =
    available.filter(c => !c.locked).length === 1
      ? available.find(c => !c.locked)!.choice
      : null;

  /**
   * Navigate forward, applying the choice's effect and recording the state we
   * are leaving so BACK can restore it exactly.
   */
  const goTo = (nextId: string, effect?: string) => {
    if (!scenes[nextId]) return;
    setHistory(prev => [...prev.slice(-99), { nodeId: currentId, minutes: clockMinutes, vars, staging }]);
    // Effects and per-step ticks both run against a bag holding the clock.
    let bag = evalVars;
    if (effect) bag = applyEffect(effect, bag);
    bag = applyStepTicks(bag, targets);
    commitBag(bag);

    setStaging(prev => resolveStaging(scenes[nextId], prev));
    setCurrentId(nextId);
  };

  /** Rollback one step, restoring the clock, variables and stage as they were. */
  const goBack = () => {
    setHistory(prev => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      appliedTimeForSceneRef.current = last.nodeId; // don't re-apply its time action
      loggedSceneRef.current = last.nodeId;         // don't re-log it
      setBacklog(b => b.slice(0, -1));
      setClockMinutes(last.minutes);
      setVars(last.vars);
      setStaging(last.staging);
      setCurrentId(last.nodeId);
      return prev.slice(0, -1);
    });
  };

  // Auto-forward / skip: advance automatically through single-path scenes.
  useEffect(() => {
    if (!autoMode && !skipMode) return;
    if (!soleOpenChoice) return;
    const t = setTimeout(() => goTo(soleOpenChoice.nextNodeId, soleOpenChoice.effect), skipMode ? 250 : 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, autoMode, skipMode, scene, vars]);

  /**
   * Real-time ticking. Elapsed time is measured from the wall clock rather
   * than assumed from the interval, and BANKED per value, so a slow rate stays
   * exact. Paused while the backlog is open or the tab is hidden — otherwise
   * tabbing away silently costs the player hours. Deliberately NOT paused
   * while a choice is on screen: that pressure is the point.
   */
  const carryRef = useRef<TickCarry>({});
  const lastTickRef = useRef<number>(0);
  const liveRef = useRef({ vars, clockMinutes });
  liveRef.current = { vars, clockMinutes };

  useEffect(() => {
    const realtime = targets.filter(t => t.tick.mode === "realtime");
    if (realtime.length === 0) return;

    lastTickRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const paused = showLog || (typeof document !== "undefined" && document.hidden);
      if (paused) {
        lastTickRef.current = now; // discard the paused span
        return;
      }
      const elapsed = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      const before = withClock(liveRef.current.vars, liveRef.current.clockMinutes);
      const { bag, carry } = applyRealtimeTicks(before, realtime, elapsed, carryRef.current);
      carryRef.current = carry;
      // Same object back means nothing fired — skip the re-render.
      if (bag !== before) commitBag(bag);
    }, 1000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, showLog]);

  const flashMessage = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), 1500);
  };

  const handleSaveGame = () => {
    try {
      localStorage.setItem(PREVIEW_SAVE_KEY, JSON.stringify({
        nodeId: currentId, minutes: clockMinutes, history, backlog, vars, staging
      }));
      flashMessage("Game saved");
    } catch {
      flashMessage("Save failed");
    }
  };

  const handleLoadGame = () => {
    try {
      const raw = localStorage.getItem(PREVIEW_SAVE_KEY);
      if (!raw) { flashMessage("No save found"); return; }
      const s = JSON.parse(raw);
      if (!s?.nodeId || !scenes[s.nodeId]) { flashMessage("Save doesn't match this story"); return; }
      appliedTimeForSceneRef.current = s.nodeId;
      loggedSceneRef.current = s.nodeId;
      setClockMinutes(s.minutes ?? (timeConfig?.startMinutes ?? 0));
      setHistory(Array.isArray(s.history) ? s.history : []);
      setBacklog(Array.isArray(s.backlog) ? s.backlog : []);
      // Older saves predate variables/staging — fall back rather than refuse.
      setVars(s.vars && typeof s.vars === "object" ? s.vars : initVars(variables));
      setStaging(s.staging && typeof s.staging === "object" ? s.staging : resolveStagingStatic(scenes, s.nodeId));
      setCurrentId(s.nodeId);
      flashMessage("Game loaded");
    } catch {
      flashMessage("Load failed");
    }
  };

  const tint = timeConfig?.enabled && timeConfig.dayNightTint ? dayNightOverlay(clockMinutes) : null;

  useEffect(() => {
    if (!scene) return;

    const musicAsset = assets.music.find(m => m.id === staging.musicId);

    if (staging.musicId !== currentMusicIdRef.current) {
      if (audioRef.current) {
        if (musicAsset) {
          audioRef.current.src = musicAsset.url;
          audioRef.current.loop = true;
          audioRef.current.play().catch(e => console.log("Audio play blocked"));
        } else {
          audioRef.current.pause();
          audioRef.current.src = "";
        }
      }
      currentMusicIdRef.current = staging.musicId || null;
    }
  }, [currentId, scene, staging.musicId, assets.music]);

  if (!scene) return null;

  const bg = assets.backgrounds.find(b => b.id === staging.backgroundId);
  const speaker = assets.characters.find(c => c.id === (scene.speakerId || ""));
  /** Format one value the way the author asked for. */
  const formatValue = (v: Variable, raw: VarValue | undefined): string => {
    if (v.display === "clock") return formatClock(Number(raw ?? 0), timeConfig?.format || "24h");
    return String(raw ?? "");
  };

  /** Only declared values the author chose to show; the clock has its own chip. */
  const hudValues = (variables || []).filter(
    v => v.name && v.showInHud !== false && !RESERVED_VARS.has(v.name),
  );
  const panelValues = (variables || []).filter(v => v.name && v.showInPanel);

  /** Pinned buttons that pass their condition and aren't hidden on this scene. */
  const activeOverlays = (overlays || []).filter(
    o => !(o.hiddenOnScenes || []).includes(currentId) && evalCondition(o.condition, evalVars),
  );
  const byCorner = (corner: OverlayCorner) => activeOverlays.filter(o => o.corner === corner);
  const openOverlay = activeOverlays.find(o => o.id === openOverlayId) || null;

  const runPanelButton = (b: OverlayPanelButton) => {
    if (b.action === "close" || b.action === "none") {
      setOpenOverlayId(null);
      return;
    }
    if (b.action === "goto" && b.targetNodeId && scenes[b.targetNodeId]) {
      setOpenOverlayId(null);
      goTo(b.targetNodeId, b.effect);
      return;
    }
    runEffect(b.effect);
    setOpenOverlayId(null);
  };

  const handleNext = () => {
    if (soleOpenChoice) goTo(soleOpenChoice.nextNodeId, soleOpenChoice.effect);
  };

  return (
    <div className="fixed inset-0 z-[500] bg-black flex items-center justify-center">
      <audio ref={audioRef} />

      {/* One top-left column: the clock, the values the author chose to show,
          and any pinned button placed there — so they stack instead of
          overlapping when some of them are switched off. */}
      <div className="fixed top-6 left-6 z-[600] flex flex-col gap-2 items-start">
        {timeConfig?.enabled && (
          <div className="flex items-center gap-2 bg-black/70 border border-white/15 text-white px-4 py-2 rounded-full backdrop-blur-md">
            <Clock className="w-4 h-4 text-primary" />
            <span className="text-sm font-mono tracking-[0.2em]">{formatClock(clockMinutes, timeConfig.format)}</span>
          </div>
        )}

        {hudValues.map(v => (
          <div
            key={v.name}
            className="flex items-center gap-2 bg-black/70 border border-white/15 text-white px-3 py-1 rounded-full backdrop-blur-md"
          >
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/50">{v.label || v.name}</span>
            <span className="text-xs font-mono text-primary">{formatValue(v, vars[v.name])}</span>
          </div>
        ))}

        {byCorner("top-left").map(o => (
          <button
            key={o.id}
            title={o.label}
            aria-label={o.label}
            className="w-12 h-12 grid place-items-center rounded-full bg-black/70 border border-white/15 backdrop-blur-md hover:border-primary transition-colors"
            onClick={(e) => { e.stopPropagation(); setOpenOverlayId(o.id); }}
          >
            <OverlayIcon icon={o.icon} />
          </button>
        ))}
      </div>

      {/* The remaining corners. */}
      {(["bottom-left", "bottom-right"] as OverlayCorner[]).map(corner => {
        const items = byCorner(corner);
        if (!items.length) return null;
        return (
          <div key={corner} className={cn(CORNER_POS[corner], "flex flex-col gap-2 items-start")}>
            {items.map(o => (
              <button
                key={o.id}
                title={o.label}
                aria-label={o.label}
                className="w-12 h-12 grid place-items-center rounded-full bg-black/70 border border-white/15 backdrop-blur-md hover:border-primary transition-colors"
                onClick={(e) => { e.stopPropagation(); setOpenOverlayId(o.id); }}
              >
                <OverlayIcon icon={o.icon} />
              </button>
            ))}
          </div>
        );
      })}

      <div className="fixed top-6 right-6 z-[600] flex items-center gap-4">
        {byCorner("top-right").map(o => (
          <button
            key={o.id}
            title={o.label}
            aria-label={o.label}
            className="w-12 h-12 grid place-items-center rounded-full bg-black/70 border border-white/15 backdrop-blur-md hover:border-primary transition-colors"
            onClick={(e) => { e.stopPropagation(); setOpenOverlayId(o.id); }}
          >
            <OverlayIcon icon={o.icon} />
          </button>
        ))}
        <Button
          variant="destructive"
          size="lg"
          className="h-12 px-8 gap-2 shadow-2xl ring-2 ring-white/20 font-bold bg-destructive hover:bg-destructive/90"
          onClick={(e) => {
            e.stopPropagation();
            onExit();
          }}
        >
          <X className="w-5 h-5" /> EXIT PREVIEW
        </Button>
      </div>

      {/* Runtime control bar: rollback, backlog, auto, skip, save, load */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[600] flex items-center gap-1 bg-black/70 border border-white/15 rounded-full px-2 py-1 backdrop-blur-md">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-white/80 hover:text-white hover:bg-white/10 text-[11px] font-bold tracking-wider rounded-full"
          disabled={history.length === 0}
          onClick={(e) => { e.stopPropagation(); goBack(); }}>
          <Undo2 className="w-3.5 h-3.5" /> BACK
        </Button>
        <Button variant="ghost" size="sm"
          className={cn("h-8 gap-1.5 text-[11px] font-bold tracking-wider rounded-full hover:bg-white/10",
            autoMode ? "text-primary bg-primary/20" : "text-white/80 hover:text-white")}
          onClick={(e) => { e.stopPropagation(); setAutoMode(v => !v); setSkipMode(false); }}>
          <Play className="w-3.5 h-3.5" /> AUTO
        </Button>
        <Button variant="ghost" size="sm"
          className={cn("h-8 gap-1.5 text-[11px] font-bold tracking-wider rounded-full hover:bg-white/10",
            skipMode ? "text-primary bg-primary/20" : "text-white/80 hover:text-white")}
          onClick={(e) => { e.stopPropagation(); setSkipMode(v => !v); setAutoMode(false); }}>
          <FastForward className="w-3.5 h-3.5" /> SKIP
        </Button>
        <Button variant="ghost" size="sm"
          className={cn("h-8 gap-1.5 text-[11px] font-bold tracking-wider rounded-full hover:bg-white/10",
            showLog ? "text-primary bg-primary/20" : "text-white/80 hover:text-white")}
          onClick={(e) => { e.stopPropagation(); setShowLog(v => !v); }}>
          <ScrollText className="w-3.5 h-3.5" /> LOG
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-white/80 hover:text-white hover:bg-white/10 text-[11px] font-bold tracking-wider rounded-full"
          onClick={(e) => { e.stopPropagation(); handleSaveGame(); }}>
          <Save className="w-3.5 h-3.5" /> SAVE
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-white/80 hover:text-white hover:bg-white/10 text-[11px] font-bold tracking-wider rounded-full"
          onClick={(e) => { e.stopPropagation(); handleLoadGame(); }}>
          <FolderOpen className="w-3.5 h-3.5" /> LOAD
        </Button>
      </div>

      {flash && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[650] bg-black/85 text-white text-sm px-5 py-2 rounded-full border border-white/20 animate-in fade-in slide-in-from-top-2">
          {flash}
        </div>
      )}

      {/* A pinned button's panel: a map/image with placed buttons, or the
          status screen listing the values the author chose to expose. */}
      {openOverlay?.panel && (
        <div
          className="fixed inset-0 z-[645] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-10"
          onClick={() => setOpenOverlayId(null)}
        >
          <div className="w-full max-w-4xl flex items-center justify-between mb-4">
            <h3 className="text-white font-headline text-2xl tracking-widest uppercase">
              {openOverlay.panel.title || openOverlay.label}
            </h3>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => setOpenOverlayId(null)}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            {openOverlay.panel.kind === "values" ? (
              <div className="grid grid-cols-2 gap-3">
                {panelValues.length === 0 && (
                  <p className="text-white/50 italic col-span-2">No values are set to show here.</p>
                )}
                {panelValues.map(v => (
                  <div key={v.name} className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-white/70 text-sm">{v.label || v.name}</span>
                    <span className="text-primary font-mono">{formatValue(v, vars[v.name])}</span>
                  </div>
                ))}
              </div>
            ) : openOverlay.panel.imageUrl ? (
              // Buttons are placed on the image in %, exactly like hotspots.
              <div className="relative w-full rounded-xl overflow-hidden border border-white/10">
                <img src={openOverlay.panel.imageUrl} alt={openOverlay.panel.title || ""} className="w-full h-auto block" />
                {(openOverlay.panel.buttons || [])
                  .filter(b => evalCondition(b.condition, evalVars))
                  .map(b => (
                    <button
                      key={b.id}
                      title={b.label}
                      aria-label={b.label}
                      className={cn(
                        "absolute bg-transparent cursor-pointer",
                        b.showOutline && "outline-dashed outline-2 outline-white/40 rounded-md",
                      )}
                      style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                      onClick={() => runPanelButton(b)}
                    />
                  ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(openOverlay.panel.buttons || [])
                  .filter(b => evalCondition(b.condition, evalVars))
                  .map(b => (
                    <Button
                      key={b.id}
                      className="w-full justify-start text-left bg-white/5 border border-white/10 hover:bg-primary hover:border-primary p-6 text-lg rounded-xl h-auto"
                      onClick={() => runPanelButton(b)}
                    >
                      {b.label}
                    </Button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backlog (dialogue history) overlay */}
      {showLog && (
        <div className="fixed inset-0 z-[640] bg-black/85 backdrop-blur-sm flex flex-col items-center p-10" onClick={() => setShowLog(false)}>
          <div className="w-full max-w-3xl flex items-center justify-between mb-6">
            <h3 className="text-white font-headline text-2xl tracking-widest uppercase flex items-center gap-3">
              <ScrollText className="w-6 h-6 text-primary" /> Backlog
            </h3>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => setShowLog(false)}>
              <X className="w-5 h-5" />
            </Button>
          </div>
          <div className="w-full max-w-3xl flex-1 overflow-y-auto space-y-4 pr-2" onClick={(e) => e.stopPropagation()}>
            {backlog.length === 0 && <p className="text-white/50 italic">Nothing yet.</p>}
            {backlog.map((entry, i) => (
              <div key={i} className="border-l-2 border-primary/50 pl-4">
                <div className="text-primary text-xs font-bold uppercase tracking-widest mb-1">{entry.speaker}</div>
                <p className="text-white/90 leading-relaxed">{entry.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative w-full h-full max-w-[1920px] max-h-[1080px] overflow-hidden">
        <div className="absolute inset-0 bg-neutral-900">
           {bg && (isVideoUrl(bg.url)
             ? <video src={bg.url} autoPlay loop muted playsInline className="w-full h-full object-cover animate-in fade-in duration-700" />
             : <img src={bg.url} alt="bg" className="w-full h-full object-cover animate-in fade-in duration-700" />)}
        </div>

        {staging.characters.map((sc, idx) => {
          const charAsset = assets.characters.find(c => c.id === sc.characterId);
          if (!charAsset?.url) return null;
          const isSpeaker = sc.characterId === scene.speakerId;

          return (
            <div 
              key={`${sc.characterId}-${idx}`}
              className={`vn-character-layer h-[90%] ${posClasses[sc.position]} animate-in slide-in-from-bottom-20 duration-500 transition-all ${isSpeaker ? 'z-20' : 'z-10'}`}
            >
              <img 
                src={charAsset.url} 
                alt={charAsset.name} 
                className={`h-full w-auto max-w-none object-contain drop-shadow-2xl transition-all duration-300 ${isSpeaker ? 'brightness-110 scale-102' : 'brightness-[0.65] saturate-[0.8]'}`} 
              />
            </div>
          );
        })}

        {/* Day/night tint overlay */}
        {tint && (
          <div
            className="absolute inset-0 z-30 pointer-events-none transition-colors duration-1000"
            style={{ backgroundColor: tint }}
          />
        )}

        {/* Invisible hotspot buttons drawn by the author */}
        {(scene.hotspots || []).map((h) => (
          <button
            key={h.id}
            aria-label={h.label || "hotspot"}
            title={h.showOutline ? h.label : undefined}
            className={cn(
              "absolute z-40 cursor-pointer bg-transparent",
              h.showOutline && "outline-dashed outline-2 outline-white/40 rounded-md"
            )}
            style={{ left: `${h.x}%`, top: `${h.y}%`, width: `${h.w}%`, height: `${h.h}%` }}
            onClick={(e) => {
              e.stopPropagation();
              if (h.action === "goto" && h.targetNodeId && scenes[h.targetNodeId]) {
                goTo(h.targetNodeId);
              } else if (h.action === "advanceTime") {
                setClockMinutes(prev => normalizeMinutes(prev + (h.advanceMinutes || 60)));
              }
            }}
          />
        ))}

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl z-50">
          <div 
            className="bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_50px_rgba(0,0,0,0.8)] animate-in slide-in-from-bottom-10 duration-500 cursor-pointer active:bg-primary/5 transition-all"
            onClick={handleNext}
          >
             <div className="flex justify-between items-start mb-2">
                <span className="text-primary font-headline text-xl tracking-widest uppercase font-bold">
                  {speaker?.name || "Narrator"}
                </span>
                <span className="text-[10px] text-white/40 tracking-[0.2em] font-medium">{scene.title}</span>
             </div>
             
             <p className="text-2xl text-white/95 font-body leading-relaxed mb-8 min-h-[6rem]">
               {scene.dialogue}
             </p>

             <div className="flex flex-col gap-3">
               {available.length > 0 ? (
                 <div className="grid grid-cols-1 gap-3">
                   {available.map(({ choice, locked }, i) => (
                     <Button
                      key={i}
                      disabled={locked}
                      title={locked ? `Requires: ${choice.condition}` : undefined}
                      className={cn(
                        "w-full justify-start text-left border transition-all p-7 text-xl rounded-xl group h-auto",
                        locked
                          ? "bg-white/[0.02] border-white/5 text-white/35 cursor-not-allowed"
                          : "bg-white/5 border-white/10 hover:bg-primary hover:border-primary",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (locked) return;
                        goTo(choice.nextNodeId, choice.effect);
                      }}
                     >
                       {locked && <Lock className="w-4 h-4 mr-3 shrink-0" />}
                       {choice.text}
                     </Button>
                   ))}
                 </div>
               ) : (
                 <div className="flex justify-end pt-4">
                   <Button 
                    variant="default"
                    size="lg"
                    className="group gap-2 bg-primary hover:bg-primary/90 px-10 h-14 text-lg font-bold shadow-xl transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExit();
                    }}
                   >
                     FINISH PREVIEW <LogOut className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                   </Button>
                 </div>
               )}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}