"use client";

import { useState } from "react";
import type {
  OverlayButton,
  OverlayCorner,
  OverlayPanelButton,
  SceneNode,
  Variable,
} from "@/lib/vn-types";
import { ExpressionBuilder } from "./ExpressionBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Pin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * @fileOverview Authoring for buttons pinned on screen for the whole novel —
 * a map, a phone, a character sheet.
 *
 * Panel buttons are placed on the image by dragging, in percentages, the same
 * convention hotspots use over the stage, so a panel behaves identically at
 * any window size.
 */

const CORNERS: { id: OverlayCorner; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

const SUGGESTED_ICONS = ["🗺️", "📱", "🎒", "📖", "⭐", "🧭", "💍", "📓"];

interface Props {
  overlays: OverlayButton[];
  scenes: Record<string, SceneNode>;
  variables: Variable[];
  clockEnabled?: boolean;
  onChange: (next: OverlayButton[]) => void;
}

export function OverlayEditor({ overlays, scenes, variables, clockEnabled, onChange }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(overlays[0]?.id ?? null);
  const selected = overlays.find(o => o.id === selectedId) || null;
  /** Which panel button is being dragged on the image. */
  const [dragId, setDragId] = useState<string | null>(null);

  const patch = (id: string, changes: Partial<OverlayButton>) =>
    onChange(overlays.map(o => (o.id === id ? { ...o, ...changes } : o)));

  const patchPanelButton = (id: string, btnId: string, changes: Partial<OverlayPanelButton>) => {
    const o = overlays.find(x => x.id === id);
    if (!o?.panel) return;
    patch(id, {
      panel: {
        ...o.panel,
        buttons: o.panel.buttons.map(b => (b.id === btnId ? { ...b, ...changes } : b)),
      },
    });
  };

  const addOverlay = () => {
    const id = `ov-${Date.now()}`;
    onChange([
      ...overlays,
      {
        id,
        label: "Map",
        icon: "🗺️",
        corner: "top-left",
        panel: { kind: "buttons", title: "Map", buttons: [] },
      },
    ]);
    setSelectedId(id);
  };

  const addPanelButton = () => {
    if (!selected?.panel) return;
    patch(selected.id, {
      panel: {
        ...selected.panel,
        buttons: [
          ...selected.panel.buttons,
          {
            id: `ovb-${Date.now()}`,
            label: "New place",
            x: 40, y: 40, w: 20, h: 15,
            action: "goto",
            targetNodeId: Object.keys(scenes)[0] || "",
            showOutline: true,
          },
        ],
      },
    });
  };

  /** Drag a placed button around the panel image, in % of its box. */
  const onImageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragId || !selected?.panel) return;
    const box = e.currentTarget.getBoundingClientRect();
    const btn = selected.panel.buttons.find(b => b.id === dragId);
    if (!btn) return;
    const x = ((e.clientX - box.left) / box.width) * 100 - btn.w / 2;
    const y = ((e.clientY - box.top) / box.height) * 100 - btn.h / 2;
    patchPanelButton(selected.id, dragId, {
      x: Math.max(0, Math.min(100 - btn.w, Math.round(x))),
      y: Math.max(0, Math.min(100 - btn.h, Math.round(y))),
    });
  };

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 max-h-[60vh]">
      {/* The buttons this novel has */}
      <div className="border-r pr-3 overflow-y-auto space-y-1">
        {overlays.length === 0 && (
          <p className="text-xs text-muted-foreground italic py-4">
            No pinned buttons yet.
          </p>
        )}
        {overlays.map(o => (
          <button
            key={o.id}
            onClick={() => setSelectedId(o.id)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors",
              o.id === selectedId ? "bg-primary/10 text-primary" : "hover:bg-muted",
            )}
          >
            <span className="text-lg leading-none">{o.icon}</span>
            <span className="flex-1 truncate">{o.label}</span>
          </button>
        ))}
        <Button variant="outline" size="sm" className="w-full gap-2 mt-2" onClick={addOverlay}>
          <Plus className="w-3 h-3" /> Add button
        </Button>
      </div>

      {/* The selected button */}
      <div className="overflow-y-auto pr-1 space-y-4">
        {!selected && (
          <p className="text-sm text-muted-foreground italic py-8 text-center">
            Select a button, or add one.
          </p>
        )}

        {selected && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={selected.label}
                  onChange={e => patch(selected.id, { label: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Corner</Label>
                <select
                  value={selected.corner}
                  onChange={e => patch(selected.id, { corner: e.target.value as OverlayCorner })}
                  className="h-8 w-full text-sm rounded-md border bg-background px-2"
                >
                  {CORNERS.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Icon — an emoji, or an image URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={selected.icon}
                  onChange={e => patch(selected.id, { icon: e.target.value })}
                  className="h-8 text-sm w-40"
                />
                <div className="flex gap-1">
                  {SUGGESTED_ICONS.map(i => (
                    <button
                      key={i}
                      title={`Use ${i}`}
                      onClick={() => patch(selected.id, { icon: i })}
                      className="w-7 h-7 rounded-md hover:bg-muted text-lg leading-none"
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <ExpressionBuilder
              mode="condition"
              value={selected.condition || ""}
              variables={variables}
              clockEnabled={clockEnabled}
              onChange={next => patch(selected.id, { condition: next })}
            />

            <Separator />

            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
                What it opens
              </Label>
              <select
                value={selected.panel?.kind || "buttons"}
                onChange={e =>
                  patch(selected.id, {
                    panel: {
                      kind: e.target.value as "buttons" | "values",
                      title: selected.panel?.title || selected.label,
                      imageUrl: selected.panel?.imageUrl,
                      buttons: selected.panel?.buttons || [],
                    },
                  })
                }
                className="h-8 text-sm rounded-md border bg-background px-2"
              >
                <option value="buttons">A map / image with buttons</option>
                <option value="values">The player's values</option>
              </select>
            </div>

            {selected.panel?.kind === "values" && (
              <p className="text-xs text-muted-foreground">
                Shows every value ticked as <strong>Show on status screen</strong> in Variables.
              </p>
            )}

            {selected.panel?.kind === "buttons" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Background image URL (optional)</Label>
                  <Input
                    value={selected.panel.imageUrl || ""}
                    placeholder="https://… — leave blank for a plain list of buttons"
                    onChange={e =>
                      patch(selected.id, { panel: { ...selected.panel!, imageUrl: e.target.value } })
                    }
                    className="h-8 text-sm"
                  />
                </div>

                {selected.panel.imageUrl ? (
                  <div
                    className="relative border rounded-lg overflow-hidden select-none"
                    onMouseMove={onImageMouseMove}
                    onMouseUp={() => setDragId(null)}
                    onMouseLeave={() => setDragId(null)}
                  >
                    <img src={selected.panel.imageUrl} alt="" className="w-full h-auto block" />
                    {selected.panel.buttons.map(b => (
                      <div
                        key={b.id}
                        onMouseDown={() => setDragId(b.id)}
                        title={`${b.label} — drag to move`}
                        className="absolute bg-primary/25 border-2 border-primary rounded cursor-grab active:cursor-grabbing grid place-items-center"
                        style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                      >
                        <span className="text-[10px] font-bold text-primary-foreground bg-primary/80 px-1 rounded truncate max-w-full">
                          {b.label}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Without an image the buttons show as a simple list.
                  </p>
                )}

                <div className="space-y-2">
                  {selected.panel.buttons.map(b => (
                    <div key={b.id} className="p-2 border rounded-md space-y-2 bg-background/60">
                      <div className="flex items-center gap-2">
                        <Input
                          value={b.label}
                          onChange={e => patchPanelButton(selected.id, b.id, { label: e.target.value })}
                          className="h-7 text-xs flex-1"
                        />
                        <select
                          value={b.action}
                          onChange={e =>
                            patchPanelButton(selected.id, b.id, {
                              action: e.target.value as OverlayPanelButton["action"],
                            })
                          }
                          className="h-7 text-xs rounded-md border bg-background px-1"
                        >
                          <option value="goto">Go to scene</option>
                          <option value="effect">Change a value</option>
                          <option value="close">Just close</option>
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() =>
                            patch(selected.id, {
                              panel: {
                                ...selected.panel!,
                                buttons: selected.panel!.buttons.filter(x => x.id !== b.id),
                              },
                            })
                          }
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>

                      {b.action === "goto" && (
                        <select
                          value={b.targetNodeId || ""}
                          onChange={e => patchPanelButton(selected.id, b.id, { targetNodeId: e.target.value })}
                          className="h-7 w-full text-xs rounded-md border bg-background px-1"
                        >
                          {Object.values(scenes).map(sc => (
                            <option key={sc.id} value={sc.id}>{sc.title}</option>
                          ))}
                        </select>
                      )}

                      <ExpressionBuilder
                        mode="condition"
                        value={b.condition || ""}
                        variables={variables}
                        clockEnabled={clockEnabled}
                        onChange={next => patchPanelButton(selected.id, b.id, { condition: next })}
                      />
                      <ExpressionBuilder
                        mode="effect"
                        value={b.effect || ""}
                        variables={variables}
                        clockEnabled={clockEnabled}
                        onChange={next => patchPanelButton(selected.id, b.id, { effect: next })}
                      />

                      {selected.panel?.imageUrl && (
                        <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                          <Switch
                            checked={!!b.showOutline}
                            onCheckedChange={v => patchPanelButton(selected.id, b.id, { showOutline: v })}
                            className="scale-75"
                          />
                          Outline it during play so the player can see it
                        </label>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="gap-2" onClick={addPanelButton}>
                    <Plus className="w-3 h-3" /> Add a button to the panel
                  </Button>
                </div>
              </div>
            )}

            <Separator />

            <div className="space-y-1">
              <Label className="text-xs">Hide on these scenes</Label>
              <div className="max-h-28 overflow-y-auto border rounded-md p-2 space-y-1">
                {Object.values(scenes).map(sc => {
                  const hidden = (selected.hiddenOnScenes || []).includes(sc.id);
                  return (
                    <label key={sc.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hidden}
                        onChange={e =>
                          patch(selected.id, {
                            hiddenOnScenes: e.target.checked
                              ? [...(selected.hiddenOnScenes || []), sc.id]
                              : (selected.hiddenOnScenes || []).filter(x => x !== sc.id),
                          })
                        }
                        className="accent-primary"
                      />
                      {sc.title}
                    </label>
                  );
                })}
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-destructive"
              onClick={() => {
                onChange(overlays.filter(o => o.id !== selected.id));
                setSelectedId(null);
              }}
            >
              <Trash2 className="w-4 h-4" /> Delete this button
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
