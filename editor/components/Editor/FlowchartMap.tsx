"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { SceneNode, NodeKind, nodeKind } from "@/lib/vn-types";
import { buildChains } from "@/lib/vn-graph";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, Minus, ZoomIn, ZoomOut, RefreshCcw, Trash2, Link2, X, MousePointer2, Grid3X3, Layout, Sparkles, GitBranch, FlagTriangleRight, MessageSquare, Layers, Play } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface FlowchartMapProps {
  scenes: Record<string, SceneNode>;
  currentSceneId: string;
  onSelectScene: (id: string) => void;
  onUpdateScenes: (scenes: Record<string, SceneNode>) => void;
  onAddScene?: (x: number, y: number) => void;
  /** Start the player from a given scene ("Play from here"). */
  onPlayFrom?: (id: string) => void;
  isExpanded?: boolean;
}

const GRID_SIZE = 20;

/** Runs shorter than this stay expanded — collapsing 2 cards helps nobody. */
const MIN_COLLAPSE = 3;

/** How each node kind reads on the map. */
const KIND_STYLES: Record<NodeKind, { label: string; icon: typeof GitBranch; className: string }> = {
  scene: { label: "Scene", icon: MessageSquare, className: "text-muted-foreground" },
  choice: { label: "Choice", icon: GitBranch, className: "text-primary" },
  ending: { label: "Ending", icon: FlagTriangleRight, className: "text-amber-500" },
};

export function FlowchartMap({ 
  scenes, 
  currentSceneId, 
  onSelectScene, 
  onUpdateScenes,
  onAddScene,
  onPlayFrom,
  isExpanded = false
}: FlowchartMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [linkingSourceId, setLinkingSourceId] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [collapseRuns, setCollapseRuns] = useState(true);
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());

  const chains = useMemo(() => buildChains(scenes), [scenes]);

  /** Chains drawn as a single card right now. */
  const collapsedChains = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!collapseRuns) return map;
    chains.forEach((chain, head) => {
      if (chain.length >= MIN_COLLAPSE && !expandedChains.has(head)) map.set(head, chain);
    });
    return map;
  }, [chains, collapseRuns, expandedChains]);

  /**
   * Which card actually stands for a scene on screen. Members of a collapsed
   * run are represented by their chain head, so edges still land somewhere.
   */
  const representativeOf = useMemo(() => {
    const rep = new Map<string, string>();
    Object.keys(scenes).forEach(id => rep.set(id, id));
    collapsedChains.forEach((chain, head) => chain.forEach(id => rep.set(id, head)));
    return rep;
  }, [scenes, collapsedChains]);

  /** Ids that get their own card (collapsed members are folded away). */
  const visibleIds = useMemo(
    () => Object.keys(scenes).filter(id => representativeOf.get(id) === id),
    [scenes, representativeOf],
  );

  const toggleChain = (head: string) => {
    setExpandedChains(prev => {
      const next = new Set(prev);
      if (next.has(head)) next.delete(head);
      else next.add(head);
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (linkingSourceId) {
      if (linkingSourceId !== id) {
        completeLink(linkingSourceId, id);
      }
      setLinkingSourceId(null);
      return;
    }

    const node = scenes[id];
    if (!node.visualPosition) return;

    setDraggingNode(id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOffset({
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    });
    onSelectScene(id);
  };

  const completeLink = (sourceId: string, targetId: string) => {
    const sourceNode = scenes[sourceId];
    const targetNode = scenes[targetId];
    if (!sourceNode || !targetNode) return;

    const updatedScenes = { ...scenes };
    const newChoices = [
      ...updatedScenes[sourceId].choices, 
      { text: targetNode.title || "Next Scene", nextNodeId: targetId }
    ];
    updatedScenes[sourceId] = { ...updatedScenes[sourceId], choices: newChoices };
    onUpdateScenes(updatedScenes);
  };

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (linkingSourceId) {
      setLinkingSourceId(null);
      return;
    }
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingNode && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      let x = (e.clientX - containerRect.left) / scale - pan.x / scale - dragOffset.x;
      let y = (e.clientY - containerRect.top) / scale - pan.y / scale - dragOffset.y;

      if (snapToGrid) {
        x = Math.round(x / GRID_SIZE) * GRID_SIZE;
        y = Math.round(y / GRID_SIZE) * GRID_SIZE;
      }

      const updatedScenes = { ...scenes };
      updatedScenes[draggingNode] = {
        ...updatedScenes[draggingNode],
        visualPosition: { x, y },
      };
      onUpdateScenes(updatedScenes);
    } else if (isPanning) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setDraggingNode(null);
    setIsPanning(false);
  };

  const handleZoom = (delta: number) => {
    setScale(prev => Math.min(Math.max(0.2, prev + delta), 2));
  };

  const autoArrange = () => {
    const updatedScenes = { ...scenes };
    // Lay out the cards that are actually drawn; folded-away members would
    // otherwise punch holes in the grid.
    const sceneArray = visibleIds.map(id => updatedScenes[id]).filter(Boolean);
    const COLS = 3;
    const SPACING_X = 350;
    const SPACING_Y = 300;

    sceneArray.forEach((scene, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      updatedScenes[scene.id] = {
        ...scene,
        visualPosition: {
          x: 100 + col * SPACING_X + (row % 2 === 0 ? 0 : 40),
          y: 100 + row * SPACING_Y
        }
      };
    });
    onUpdateScenes(updatedScenes);
  };

  const removeChoice = (sceneId: string, choiceIndex: number) => {
    const updatedScenes = { ...scenes };
    const newChoices = [...updatedScenes[sceneId].choices];
    newChoices.splice(choiceIndex, 1);
    updatedScenes[sceneId] = { ...updatedScenes[sceneId], choices: newChoices };
    onUpdateScenes(updatedScenes);
  };

  const updateDialogue = (id: string, text: string) => {
    const updatedScenes = { ...scenes };
    updatedScenes[id] = { ...updatedScenes[id], dialogue: text };
    onUpdateScenes(updatedScenes);
  };

  const addNewChoice = (id: string) => {
    const updatedScenes = { ...scenes };
    const newChoices = [...updatedScenes[id].choices, { text: "New Choice", nextNodeId: id }];
    updatedScenes[id] = { ...updatedScenes[id], choices: newChoices };
    onUpdateScenes(updatedScenes);
  };

  const handleSplitScene = (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const fullText = textarea.value;

      const before = fullText.substring(0, start).trim();
      const after = fullText.substring(start).trim();

      if (after.length === 0) return;

      const currentScene = scenes[id];
      const newId = `scene-${Date.now()}`;
      const updatedScenes = { ...scenes };

      // Update current scene: keep text before, point to new node
      updatedScenes[id] = {
        ...currentScene,
        dialogue: before,
        choices: [{ text: "Next", nextNodeId: newId }]
      };

      // Create new scene: keep text after, inherit characters/bg/choices
      updatedScenes[newId] = {
        ...currentScene,
        id: newId,
        title: `${currentScene.title} (Part 2)`,
        dialogue: after,
        visualPosition: {
          x: (currentScene.visualPosition?.x || 0),
          y: (currentScene.visualPosition?.y || 0) + 180
        },
        choices: currentScene.choices, // Pass down original branching paths
        isAiGenerated: false
      };

      onUpdateScenes(updatedScenes);
      setTimeout(() => onSelectScene(newId), 10);
    }
  };

  const renderConnections = () => {
    return Object.values(scenes).map((scene) => {
      // Draw from whichever card represents this scene on screen.
      const sourceId = representativeOf.get(scene.id) || scene.id;
      const source = scenes[sourceId];
      if (!source?.visualPosition) return null;

      return (scene.choices || []).map((choice, i) => {
        const targetId = representativeOf.get(choice.nextNodeId);
        const target = targetId ? scenes[targetId] : undefined;
        if (!target || !target.visualPosition) return null;
        // Hops inside one collapsed run are internal — the card already says
        // how many lines it holds, so drawing them would just be noise.
        if (targetId === sourceId) return null;

        const startX = source.visualPosition!.x + 120;
        const startY = source.visualPosition!.y + 120;
        const endX = target.visualPosition!.x + 120;
        const endY = target.visualPosition!.y + 20;

        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;

        return (
          <g key={`${scene.id}-${choice.nextNodeId}-${i}`}>
            <path
              d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeDasharray="4"
              className="opacity-40 transition-all hover:opacity-100"
            />
            <foreignObject 
              x={midX - 30} 
              y={midY - 15} 
              width="60" 
              height="30" 
              className="pointer-events-auto overflow-visible"
            >
              <div className="flex items-center justify-center gap-1 h-full w-full">
                <Button 
                  size="icon" 
                  className="h-6 w-6 rounded-full bg-destructive shadow-md hover:scale-110 transition-transform flex items-center justify-center p-0"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    removeChoice(scene.id, i); 
                  }}
                  title="Delete Connection"
                >
                  <Minus className="w-3 h-3 text-white" />
                </Button>
                <Button 
                  size="icon" 
                  className="h-6 w-6 rounded-full bg-primary shadow-md hover:scale-110 transition-transform flex items-center justify-center p-0"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    onSelectScene(scene.id); 
                  }}
                  title="Go to Node"
                >
                  <Link2 className="w-3 h-3 text-white" />
                </Button>
              </div>
            </foreignObject>
          </g>
        );
      });
    });
  };

  return (
    <>
      <div className="editor-map-toolbar">
        <div className="flex bg-background/80 backdrop-blur border rounded-md p-1 gap-1 shadow-lg">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Zoom in" onClick={() => handleZoom(0.1)}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Zoom out" onClick={() => handleZoom(-0.1)}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Reset map view" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>
            <RefreshCcw className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex bg-background/80 backdrop-blur border rounded-md p-2 gap-2 shadow-lg items-center">
          <div className="flex items-center gap-2">
            <Switch id="snap-grid" checked={snapToGrid} onCheckedChange={setSnapToGrid} className="scale-75" />
            <Label htmlFor="snap-grid" className="text-[10px] cursor-pointer flex items-center gap-1">
              <Grid3X3 className="w-3 h-3" /> SNAP
            </Label>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <Switch id="collapse-runs" checked={collapseRuns} onCheckedChange={setCollapseRuns} className="scale-75" />
            <Label htmlFor="collapse-runs" className="text-[10px] cursor-pointer flex items-center gap-1" title={`Fold straight runs of ${MIN_COLLAPSE}+ scenes into one card`}>
              <Layers className="w-3 h-3" /> COLLAPSE
            </Label>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={autoArrange}>
            <Layout className="w-3 h-3" /> AUTO-ARRANGE
          </Button>
        </div>

        {onAddScene && (
          <Button 
            className="gap-2 shadow-lg" 
            size="sm"
            onClick={() => onAddScene(100, 100)}
          >
            <Plus className="w-4 h-4" /> Add Scene
          </Button>
        )}
      </div>

    <div 
      ref={containerRef}
      className={cn(
        "relative flex-1 bg-card/20 border rounded-xl overflow-hidden cursor-grab active:cursor-grabbing select-none",
        isExpanded && "h-full border-none rounded-none",
        linkingSourceId && "cursor-crosshair"
      )}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={(e) => {
        if (e.ctrlKey) {
          handleZoom(e.deltaY > 0 ? -0.1 : 0.1);
          e.preventDefault();
        }
      }}
    >
      {linkingSourceId && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] bg-primary text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 animate-bounce">
          <MousePointer2 className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">Select target scene for "{scenes[linkingSourceId]?.title}"</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/20" onClick={() => setLinkingSourceId(null)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <div 
        className="absolute inset-0 origin-top-left transition-transform duration-75"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
      >
        <svg className="absolute inset-0 w-[5000px] h-[5000px] pointer-events-none overflow-visible">
          {renderConnections()}
        </svg>

        {visibleIds.map((id) => {
          const scene = scenes[id];
          const chain = collapsedChains.get(id);
          const runLength = chain?.length ?? 1;
          const isCollapsed = !!chain;
          // A collapsed card stands for the whole run, so it reads as whatever
          // the LAST node in the run is — that's where the branching lives.
          const kindSource = isCollapsed ? scenes[chain![chain!.length - 1]] : scene;
          const kind = nodeKind(kindSource);
          const kindStyle = KIND_STYLES[kind];
          const KindIcon = kindStyle.icon;

          return (
          <div
            key={scene.id}
            style={{
              left: scene.visualPosition?.x ?? 0,
              top: scene.visualPosition?.y ?? 0,
              width: "240px",
            }}
            onMouseDown={(e) => handleMouseDown(e, scene.id)}
            className={cn(
              "absolute p-4 rounded-xl border bg-card shadow-xl cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 group",
              currentSceneId === scene.id ? "border-primary ring-2 ring-primary bg-primary/5" : "border-border",
              scene.isAiGenerated && "border-destructive/60 bg-destructive/5 ring-destructive/30 ring-2 ring-offset-2 ring-offset-background",
              linkingSourceId === scene.id && "ring-4 ring-primary ring-offset-4 ring-offset-background",
              linkingSourceId && linkingSourceId !== scene.id && "hover:border-primary hover:bg-primary/10",
              isCollapsed && "shadow-[6px_6px_0_-2px_hsl(var(--card)),6px_6px_0_-1px_hsl(var(--border))]"
            )}
          >
            <div className="flex items-center gap-1 mb-1">
              <span className={cn("text-[9px] font-bold uppercase tracking-[0.12em] flex items-center gap-1", kindStyle.className)}>
                <KindIcon className="w-3 h-3" /> {kindStyle.label}
              </span>
              {isCollapsed && (
                <button
                  className="ml-auto text-[9px] font-bold uppercase tracking-wider text-primary flex items-center gap-1 hover:underline"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); toggleChain(scene.id); }}
                  title="Expand this run into individual scenes"
                >
                  <Layers className="w-3 h-3" /> {runLength} lines
                </button>
              )}
              {!isCollapsed && chains.get(scene.id) && chains.get(scene.id)!.length >= MIN_COLLAPSE && (
                <button
                  className="ml-auto text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1 hover:text-primary hover:underline"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); toggleChain(scene.id); }}
                  title="Collapse this run back into one card"
                >
                  <Layers className="w-3 h-3" /> collapse
                </button>
              )}
            </div>

            <div className="flex justify-between items-start mb-2">
              <div className={cn(
                "text-[10px] font-bold uppercase tracking-wider flex items-center gap-1",
                scene.isAiGenerated ? "text-destructive" : "text-primary"
              )}>
                {scene.isAiGenerated && <Sparkles className="w-3 h-3" />}
                {scene.title || "Untitled Node"}
              </div>
              <div className="flex items-center gap-1">
                 {onPlayFrom && (
                   <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onPlayFrom(scene.id); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Play from here"
                   >
                     <Play className="w-3 h-3 text-primary" />
                   </Button>
                 )}
                 <Button
                  variant="ghost" 
                  size="icon" 
                  className={cn(
                    "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity",
                    linkingSourceId === scene.id && "opacity-100 text-primary bg-primary/10"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLinkingSourceId(scene.id);
                  }}
                  title="Link to another scene"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  disabled={scene.id === "start"} title="Remove scene"
                  onClick={(e) => {
                    e.stopPropagation();
                    const updated = { ...scenes };
                    if (scene.id === "start") return;
                    delete updated[scene.id];
                    onUpdateScenes(updated);
                  }}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>
              </div>
            </div>

            <Textarea 
              value={scene.dialogue}
              onChange={(e) => updateDialogue(scene.id, e.target.value)}
              onKeyDown={(e) => handleSplitScene(e, scene.id)}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-[11px] h-16 bg-background/50 border-none resize-none leading-tight mb-3 focus-visible:ring-1 focus-visible:ring-primary"
              placeholder="Enter dialogue..."
              title="Press Enter to split into two scenes"
            />

            {/* A collapsed run previews the lines it swallowed, then shows the
                branching that belongs to the LAST scene in the run. */}
            {isCollapsed && (
              <div className="mb-3 space-y-0.5 border-l-2 border-primary/30 pl-2">
                {chain!.slice(1, 4).map(memberId => (
                  <div
                    key={memberId}
                    className="text-[9px] text-muted-foreground truncate cursor-pointer hover:text-primary"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); toggleChain(scene.id); onSelectScene(memberId); }}
                    title={scenes[memberId]?.dialogue}
                  >
                    {scenes[memberId]?.dialogue || <span className="italic">(empty line)</span>}
                  </div>
                ))}
                {runLength > 4 && (
                  <div className="text-[9px] text-muted-foreground/70 italic">
                    +{runLength - 4} more…
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              {(kindSource.choices || []).map((c, i) => (
                <div key={i} className="flex items-center gap-1 group/choice">
                  <div className="flex-1 text-[9px] bg-secondary/30 px-2 py-1 rounded border border-border/50 truncate">
                    {c.text}
                    {c.condition && (
                      <span className="ml-1 text-primary/80" title={`Only if: ${c.condition}`}>· if {c.condition}</span>
                    )}
                    {c.effect && (
                      <span className="ml-1 text-amber-500/80" title={`Sets: ${c.effect}`}>· {c.effect}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 opacity-0 group-hover/choice:opacity-100"
                    onClick={(e) => { e.stopPropagation(); removeChoice(kindSource.id, i); }}
                  >
                    <X className="w-2 h-2" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-6 text-[9px] gap-1 text-muted-foreground hover:text-primary mt-2 border border-dashed"
                onClick={(e) => { e.stopPropagation(); addNewChoice(kindSource.id); }}
              >
                <Plus className="w-3 h-3" /> New Branch
              </Button>
            </div>
            {scene.isAiGenerated && (
              <div className="mt-2 text-[8px] font-bold text-destructive/80 italic text-center uppercase tracking-tighter">
                Additional AI Generated Content
              </div>
            )}
          </div>
          );
        })}
      </div>

      <div className="absolute bottom-4 right-4 text-[10px] text-muted-foreground bg-background/50 px-3 py-1.5 rounded-full backdrop-blur border">
        {Math.round(scale * 100)}% | Shift + Drag to Pan | Ctrl + Scroll to Zoom
      </div>
    </div>
    </>
  );
}
