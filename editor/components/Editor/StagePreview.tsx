
"use client";

import React, { useRef, useState } from "react";
import { SceneNode, CharacterAsset, BackgroundAsset, CharacterPosition, Hotspot, isVideoUrl } from "@/lib/vn-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MousePointerClick, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface StagePreviewProps {
  scene?: SceneNode;
  assets: {
    characters: CharacterAsset[];
    backgrounds: BackgroundAsset[];
  };
  /** When provided, the "Draw Button" tool is available. */
  onUpdateScene?: (scene: SceneNode) => void;
}

const posClasses: Record<CharacterPosition, string> = {
  "far-left": "left-[10%] -translate-x-1/2 scale-75",
  "left": "left-[25%] -translate-x-1/2 scale-85",
  "center": "left-1/2 -translate-x-1/2 scale-100",
  "right": "left-[75%] -translate-x-1/2 scale-85",
  "far-right": "left-[90%] -translate-x-1/2 scale-75",
};

interface DraftRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function StagePreview({ scene, assets, onUpdateScene }: StagePreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  if (!scene) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="font-headline text-lg">Stage Preview</h3>
        </div>
        <div className="vn-stage-container border shadow-2xl bg-black flex items-center justify-center text-muted-foreground italic">
          No Scene Selected
        </div>
      </div>
    );
  }

  const bg = assets.backgrounds.find(b => b.id === (scene.backgroundId || ""));
  const speaker = assets.characters.find(c => c.id === (scene.speakerId || ""));

  /** Pointer position as % of stage. */
  const toPercent = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!drawMode) return;
    const p = toPercent(e);
    if (!p) return;
    dragStart.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawMode || !dragStart.current) return;
    const p = toPercent(e);
    if (!p) return;
    const s = dragStart.current;
    setDraft({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  };

  const handlePointerUp = () => {
    if (!drawMode || !draft || !onUpdateScene) {
      dragStart.current = null;
      return;
    }
    dragStart.current = null;
    // Ignore accidental clicks (too small to be a button).
    if (draft.w >= 2 && draft.h >= 2) {
      const hotspot: Hotspot = {
        id: `hs-${Date.now()}`,
        x: Math.round(draft.x * 10) / 10,
        y: Math.round(draft.y * 10) / 10,
        w: Math.round(draft.w * 10) / 10,
        h: Math.round(draft.h * 10) / 10,
        label: `Button ${(scene.hotspots?.length || 0) + 1}`,
        action: "goto",
        showOutline: false,
      };
      onUpdateScene({ ...scene, hotspots: [...(scene.hotspots || []), hotspot] });
      setDrawMode(false);
    }
    setDraft(null);
  };

  const removeHotspot = (id: string) => {
    if (!onUpdateScene) return;
    onUpdateScene({ ...scene, hotspots: (scene.hotspots || []).filter(h => h.id !== id) });
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="font-headline text-lg">Stage Preview</h3>
        <div className="flex items-center gap-2">
          {onUpdateScene && (
            <Button
              variant={drawMode ? "default" : "outline"}
              size="sm"
              className={cn("h-7 gap-1.5 text-[10px] uppercase tracking-wide", drawMode && "bg-primary animate-pulse")}
              onClick={() => { setDrawMode(v => !v); setDraft(null); dragStart.current = null; }}
              title="Drag a rectangle on the stage to create an invisible clickable button"
            >
              <MousePointerClick className="w-3 h-3" />
              {drawMode ? "Drawing... (drag on stage)" : "Draw Invisible Button"}
            </Button>
          )}
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest">
            {scene.characters?.length || 0} Character(s) on Stage
          </Badge>
        </div>
      </div>
      <div
        ref={stageRef}
        className={cn("vn-stage-container border shadow-2xl bg-black relative", drawMode && "cursor-crosshair ring-2 ring-primary")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Background Layer */}
        {bg?.url ? (
          isVideoUrl(bg.url) ? (
            <video
              src={bg.url}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover opacity-80 pointer-events-none select-none"
            />
          ) : (
          <img
            src={bg.url}
            alt="background"
            className="w-full h-full object-cover opacity-80 pointer-events-none select-none"
            draggable={false}
          />
          )
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground italic">
            No Background Selected
          </div>
        )}

        {/* Character Layer */}
        {scene.characters?.map((sc, idx) => {
          const charAsset = assets.characters.find(c => c.id === sc.characterId);
          if (!charAsset?.url) return null;

          const isSpeaker = sc.characterId === scene.speakerId;

          return (
            <div
              key={`${sc.characterId}-${idx}`}
              className={`vn-character-layer h-[90%] ${posClasses[sc.position] || posClasses.center} ${isSpeaker ? 'z-20' : 'z-10'} pointer-events-none`}
            >
              <img
                src={charAsset.url}
                alt={charAsset.name}
                draggable={false}
                className={`h-full w-auto max-w-none object-contain transition-all duration-300 select-none ${isSpeaker ? 'drop-shadow-[0_0_25px_rgba(46,91,255,0.7)] brightness-110 scale-102' : 'brightness-[0.65] saturate-[0.8]'}`}
              />
            </div>
          );
        }) || null}

        {/* Hotspots (always visible in the editor so they can be managed) */}
        {(scene.hotspots || []).map((h) => (
          <div
            key={h.id}
            className="absolute z-40 border-2 border-dashed border-primary/80 bg-primary/10 rounded-md group"
            style={{ left: `${h.x}%`, top: `${h.y}%`, width: `${h.w}%`, height: `${h.h}%` }}
            title={`${h.label} → ${h.action}`}
          >
            <span className="absolute -top-5 left-0 text-[9px] font-bold uppercase tracking-wider text-primary bg-black/70 px-1.5 py-0.5 rounded whitespace-nowrap">
              {h.label}
            </span>
            {onUpdateScene && (
              <button
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white items-center justify-center hidden group-hover:flex"
                onClick={(e) => { e.stopPropagation(); removeHotspot(h.id); }}
                title="Delete hotspot"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {/* Draft rectangle while drawing */}
        {draft && (
          <div
            className="absolute z-50 border-2 border-primary bg-primary/20 rounded-md pointer-events-none"
            style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.w}%`, height: `${draft.h}%` }}
          />
        )}

        {/* UI Overlay Simulation */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black/80 to-transparent z-30 pointer-events-none">
          <div className="max-w-3xl mx-auto border-t border-primary/30 pt-4">
            <div className="text-primary font-headline text-sm mb-1 uppercase tracking-wider">
              {speaker?.name || "Narrator"}
            </div>
            <p className="font-body text-base text-white/90 leading-relaxed">
              {scene.dialogue || "No dialogue set for this scene."}
            </p>
          </div>
        </div>
      </div>
      {drawMode && (
        <p className="text-[10px] text-primary mt-1.5 px-1 animate-pulse">
          Drag a rectangle anywhere on the stage to place an invisible button. Configure what it does in the Node Properties panel.
        </p>
      )}
    </div>
  );
}
