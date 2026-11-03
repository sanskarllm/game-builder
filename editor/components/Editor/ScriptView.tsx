"use client";

import { useMemo, useRef } from "react";
import { SceneNode, ProjectAssets } from "@/lib/vn-types";
import { chainContaining } from "@/lib/vn-graph";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, CornerDownLeft, GitBranch, FlagTriangleRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScriptViewProps {
  scenes: Record<string, SceneNode>;
  assets: ProjectAssets;
  currentSceneId: string;
  onUpdateScenes: (scenes: Record<string, SceneNode>) => void;
  onSelectScene: (id: string) => void;
}

/**
 * Screenplay view of one linear run.
 *
 * The data model is unchanged — one scene is still one line — but writing a
 * conversation here costs one keystroke per line instead of "add node, type,
 * wire, repeat": Enter appends a scene and wires the Continue choice behind
 * the scenes. Branch points and endings terminate the run and are shown as
 * a footer rather than being editable here.
 */
export function ScriptView({
  scenes,
  assets,
  currentSceneId,
  onUpdateScenes,
  onSelectScene,
}: ScriptViewProps) {
  const chain = useMemo(() => chainContaining(scenes, currentSceneId), [scenes, currentSceneId]);
  /** Focus the row we just created, so typing continues uninterrupted. */
  const pendingFocus = useRef<string | null>(null);

  const speakerName = (id: string) =>
    assets.characters.find(c => c.id === id)?.name || (id ? "???" : "Narrator");

  const patch = (id: string, changes: Partial<SceneNode>) => {
    onUpdateScenes({ ...scenes, [id]: { ...scenes[id], ...changes } });
  };

  /**
   * Append a scene after `afterId`, inheriting nothing (so staging carries
   * over) and taking over whatever that scene pointed at.
   */
  const addLineAfter = (afterId: string) => {
    const current = scenes[afterId];
    if (!current) return;
    const newId = `scene-${Date.now()}`;

    const updated: Record<string, SceneNode> = {
      ...scenes,
      [afterId]: { ...current, choices: [{ text: "Continue", nextNodeId: newId }] },
      [newId]: {
        id: newId,
        title: `${current.title} —`,
        dialogue: "",
        speakerId: current.speakerId,
        // Staging is deliberately omitted: the new line inherits the stage.
        choices: current.choices,
        visualPosition: {
          x: current.visualPosition?.x ?? 100,
          y: (current.visualPosition?.y ?? 100) + 180,
        },
      },
    };

    pendingFocus.current = newId;
    onUpdateScenes(updated);
    onSelectScene(newId);
  };

  /** Remove a line from the middle of the run, stitching its neighbours. */
  const removeLine = (id: string) => {
    if (chain.length < 2 || id === "start") return;
    const idx = chain.indexOf(id);
    const previousId = chain[idx - 1];
    const target = scenes[id];
    const updated = { ...scenes };
    delete updated[id];

    if (previousId) {
      updated[previousId] = { ...updated[previousId], choices: target.choices };
    }
    // Anything else pointing here now points where this line went.
    Object.values(updated).forEach(s => {
      if ((s.choices || []).some(c => c.nextNodeId === id)) {
        updated[s.id] = {
          ...s,
          choices: s.choices.flatMap(c =>
            c.nextNodeId === id ? (target.choices || []).map(t => ({ ...c, nextNodeId: t.nextNodeId })) : [c],
          ),
        };
      }
    });

    onUpdateScenes(updated);
    onSelectScene(previousId || chain[idx + 1] || Object.keys(updated)[0] || "");
  };

  const tail = scenes[chain[chain.length - 1]];
  const tailChoices = tail?.choices || [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-6 space-y-1">
        {chain.map((id, i) => {
          const scene = scenes[id];
          if (!scene) return null;
          const isSelected = id === currentSceneId;

          return (
            <div
              key={id}
              className={cn(
                "flex gap-3 items-start rounded-lg px-3 py-2 border border-transparent transition-colors group",
                isSelected ? "bg-primary/5 border-primary/30" : "hover:bg-muted/40",
              )}
              onClick={() => onSelectScene(id)}
            >
              <Select value={scene.speakerId || "none"} onValueChange={(v) => patch(id, { speakerId: v === "none" ? "" : v })}>
                <SelectTrigger className="w-32 shrink-0 h-8 text-[11px] uppercase tracking-wider border-none bg-transparent text-primary font-bold">
                  <SelectValue>{speakerName(scene.speakerId)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Narrator</SelectItem>
                  {assets.characters.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Textarea
                autoFocus={pendingFocus.current === id}
                ref={(el) => {
                  if (el && pendingFocus.current === id) {
                    pendingFocus.current = null;
                    el.focus();
                  }
                }}
                value={scene.dialogue}
                placeholder="Write the line…"
                onChange={(e) => patch(id, { dialogue: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addLineAfter(id);
                  }
                }}
                className="flex-1 min-h-[38px] resize-none border-none bg-transparent text-[15px] leading-relaxed focus-visible:ring-1 focus-visible:ring-primary"
              />

              <span className="text-[10px] text-muted-foreground w-6 shrink-0 pt-2 text-right tabular-nums">
                {i + 1}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 text-destructive"
                disabled={chain.length < 2 || id === "start"}
                onClick={(e) => { e.stopPropagation(); removeLine(id); }}
                title="Delete this line"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        })}

        <div className="flex items-center gap-2 pt-3 pl-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => addLineAfter(chain[chain.length - 1])}
          >
            <Plus className="w-3 h-3" /> Add line
          </Button>
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <CornerDownLeft className="w-3 h-3" /> Enter adds the next line · Shift+Enter for a line break
          </span>
        </div>

        {/* Where this run ends: a branch, or the end of the story. */}
        <div className="mt-6 mx-3 p-3 rounded-lg border border-dashed text-xs text-muted-foreground">
          {tailChoices.length > 1 ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-primary font-medium">
                <GitBranch className="w-3.5 h-3.5" /> This run ends in {tailChoices.length} choices
              </div>
              {tailChoices.map((c, i) => (
                <button
                  key={i}
                  className="block text-left hover:text-primary hover:underline"
                  onClick={() => onSelectScene(c.nextNodeId)}
                >
                  → {c.text}
                  {c.condition && <span className="text-primary/70"> (if {c.condition})</span>}
                  {c.effect && <span className="text-amber-500/80"> · {c.effect}</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-500">
              <FlagTriangleRight className="w-3.5 h-3.5" /> This run ends the story. Add a branch in Node Properties to continue it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
