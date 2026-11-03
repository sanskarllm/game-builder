"use client";

import { useState } from "react";
import { SceneNode, ProjectAssets, CharacterPosition, Hotspot, Variable } from "@/lib/vn-types";
import { resolveStagingStatic } from "@/lib/vn-vars";
import { ExpressionBuilder } from "./ExpressionBuilder";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sparkles, Wand2, PlusCircle, X, UserPlus, Trash2, Music, AlertTriangle, MousePointerClick, Clock } from "lucide-react";


import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface NarrativePanelProps {
  scene?: SceneNode;
  assets: ProjectAssets;
  scenes: Record<string, SceneNode>;
  onUpdate: (node: SceneNode) => void;
  onUpdateScenes?: (scenes: Record<string, SceneNode>) => void;
  onSelectScene?: (id: string) => void;
  onDelete?: () => void;
  onRefine?: (scene: SceneNode) => Promise<void>;
  onNotice: (message: string) => void;
  /** Declared story values, offered as subjects in the condition builder. */
  variables?: Variable[];
  /** Whether the in-game clock is switched on, for the time-gating warning. */
  clockEnabled?: boolean;
}

const POSITIONS: CharacterPosition[] = ["far-left", "left", "center", "right", "far-right"];

export function NarrativePanel({
  scene,
  assets,
  scenes,
  onUpdate,
  onUpdateScenes,
  onSelectScene,
  onDelete,
  onRefine,
  onNotice,
  variables,
  clockEnabled
}: NarrativePanelProps) {
  const [isRefining, setIsRefining] = useState(false);


  if (!scene) {
    return (
      <aside className="w-80 border-l bg-card/50 flex items-center justify-center p-6">
        <p className="text-muted-foreground italic text-sm">Select a scene to edit properties</p>
      </aside>
    );
  }

  /**
   * The cast actually on stage here. A scene that doesn't declare one inherits
   * it from the scene before, so the panel edits what the author SEES; the
   * first edit pins it explicitly to this scene.
   */
  const stagedCharacters = resolveStagingStatic(scenes, scene.id).characters;

  const handleFieldChange = (key: keyof SceneNode, value: any) => {
    onUpdate({ ...scene, [key]: value });
  };

  const handleRefine = async () => {
    if (!onRefine) return;
    setIsRefining(true);
    try { await onRefine(scene); }
    catch (err) { onNotice(err instanceof Error ? err.message : "Could not refine dialogue."); }
    finally { setIsRefining(false); }
  };

  const handleSplitScene = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && onUpdateScenes && onSelectScene) {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const fullText = textarea.value;

      const before = fullText.substring(0, start).trim();
      const after = fullText.substring(start).trim();

      if (after.length === 0) return;

      const newId = `scene-${Date.now()}`;
      const updatedScenes = { ...scenes };

      // Update current scene
      updatedScenes[scene.id] = {
        ...scene,
        dialogue: before,
        choices: [{ text: "Next", nextNodeId: newId }]
      };

      // Create new scene
      updatedScenes[newId] = {
        ...scene,
        id: newId,
        title: `${scene.title} (Part 2)`,
        dialogue: after,
        visualPosition: {
          x: (scene.visualPosition?.x || 0),
          y: (scene.visualPosition?.y || 0) + 180
        },
        choices: scene.choices,
        isAiGenerated: false
      };

      onUpdateScenes(updatedScenes);
      setTimeout(() => onSelectScene(newId), 10);
      onNotice("Scene split at the cursor.");
    }
  };

  const addSceneCharacter = () => {
    if (assets.characters.length === 0) return;
    const newCharacters = [...stagedCharacters, { characterId: assets.characters[0].id, position: "center" as CharacterPosition }];
    handleFieldChange('characters', newCharacters);
  };

  const updateSceneCharacter = (index: number, field: 'characterId' | 'position', value: any) => {
    const newCharacters = [...stagedCharacters];
    newCharacters[index] = { ...newCharacters[index], [field]: value };
    handleFieldChange('characters', newCharacters);
  };

  const removeSceneCharacter = (index: number) => {
    const newCharacters = [...stagedCharacters];
    newCharacters.splice(index, 1);
    handleFieldChange('characters', newCharacters);
  };

  const addChoice = () => {
    const choices = [...scene.choices, { text: "Next Option", nextNodeId: scene.id }];
    handleFieldChange('choices', choices);
  };

  const removeChoice = (index: number) => {
    const choices = [...scene.choices];
    choices.splice(index, 1);
    handleFieldChange('choices', choices);
  };

  return (
    <aside className="w-80 xl:w-96 border-l bg-card/50 overflow-x-hidden overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-headline text-xl">Node Properties</h2>
        </div>
        {onDelete && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {scene.isAiGenerated && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/30">
          <Sparkles className="h-4 w-4" />
          <AlertTitle className="text-xs">AI Generated Path</AlertTitle>
          <AlertDescription className="text-[10px]">
            This scene was added by AI to create a branch. You can edit it or delete it if it doesn't fit your story.
          </AlertDescription>
          {onDelete && (
            <Button 
              variant="destructive" 
              size="sm" 
              className="w-full h-7 mt-2 text-[10px] font-bold"
              onClick={onDelete}
            >
              Remove Extra Scene
            </Button>
          )}
        </Alert>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Scene Title</Label>
          <Input 
            value={scene.title} 
            onChange={(e) => handleFieldChange('title', e.target.value)}
            className="bg-background"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label>Dialogue</Label>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 text-[10px] text-primary hover:text-primary gap-1"
              onClick={handleRefine}
              disabled={!onRefine || isRefining || !scene.dialogue} title={onRefine ? "Refine this line using Meta" : "Configure your Meta key in Story & assets to refine dialogue"}
            >
              <Wand2 className="w-3 h-3" /> AI REFINE
            </Button>
          </div>
          <Textarea 
            value={scene.dialogue} 
            onChange={(e) => handleFieldChange('dialogue', e.target.value)}
            onKeyDown={handleSplitScene}
            className="bg-background min-h-[100px] resize-none"
            placeholder="Write dialogue... Press Enter to split node."
          />
          <p className="text-[9px] text-muted-foreground italic">Tip: Use Enter to split this scene in two.</p>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Current Speaker</Label>
            <Select 
              value={scene.speakerId} 
              onValueChange={(v) => handleFieldChange('speakerId', v)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="No speaker" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Narrator)</SelectItem>
                {stagedCharacters.map((sc, i) => {
                   const asset = assets.characters.find(c => c.id === sc.characterId);
                   return asset ? (
                     <SelectItem key={`${sc.characterId}-${i}`} value={sc.characterId}>
                       {asset.name} (Pos: {sc.position})
                     </SelectItem>
                   ) : null;
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
             <div className="flex justify-between items-center">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Characters in Scene</Label>
                <Button variant="outline" size="icon" className="h-6 w-6" onClick={addSceneCharacter}>
                  <UserPlus className="w-4 h-4" />
                </Button>
             </div>
             
             {stagedCharacters.map((sc, idx) => (
               <div key={idx} className="p-3 border rounded-lg bg-background/50 space-y-2 relative group">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeSceneCharacter(idx)}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                  
                  <div className="space-y-1">
                    <Label className="text-[10px]">Character</Label>
                    <Select 
                      value={sc.characterId} 
                      onValueChange={(v) => updateSceneCharacter(idx, 'characterId', v)}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {assets.characters.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px]">Position</Label>
                    <Select 
                      value={sc.position} 
                      onValueChange={(v) => updateSceneCharacter(idx, 'position', v)}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map(p => (
                          <SelectItem key={p} value={p}>{p.replace('-', ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
               </div>
             ))}
          </div>

          <div className="space-y-2">
            <Label>Background</Label>
            <Select 
              value={scene.backgroundId} 
              onValueChange={(v) => handleFieldChange('backgroundId', v)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select background" />
              </SelectTrigger>
              <SelectContent>
                {assets.backgrounds.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Music className="w-4 h-4 text-muted-foreground" />
              <Label>Background Music</Label>
            </div>
            <Select 
              value={scene.musicId || "none"} 
              onValueChange={(v) => handleFieldChange('musicId', v === 'none' ? "" : v)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="No music" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Silence)</SelectItem>
                {assets.music.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground italic">Music continues playing if the next scene has the same track.</p>
          </div>
        </div>

        <Separator />

        {/* Invisible buttons (hotspots) drawn on the Stage Preview */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-muted-foreground" />
            <Label>Invisible Buttons</Label>
          </div>
          {(scene.hotspots || []).length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">
              Use "Draw Invisible Button" above the Stage Preview, then drag a rectangle on the stage.
            </p>
          ) : (
            (scene.hotspots || []).map((h, idx) => (
              <div key={h.id} className="p-3 border rounded-lg bg-background/50 space-y-2 relative group">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    const hotspots = [...(scene.hotspots || [])];
                    hotspots.splice(idx, 1);
                    handleFieldChange('hotspots', hotspots);
                  }}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>

                <div className="space-y-1">
                  <Label className="text-[10px]">Label</Label>
                  <Input
                    className="h-7 text-xs"
                    value={h.label}
                    onChange={(e) => {
                      const hotspots = [...(scene.hotspots || [])];
                      hotspots[idx] = { ...h, label: e.target.value };
                      handleFieldChange('hotspots', hotspots);
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px]">On Click</Label>
                  <Select
                    value={h.action}
                    onValueChange={(v) => {
                      const hotspots = [...(scene.hotspots || [])];
                      hotspots[idx] = { ...h, action: v as Hotspot["action"] };
                      handleFieldChange('hotspots', hotspots);
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="goto">Go to scene</SelectItem>
                      <SelectItem value="advanceTime">Advance time</SelectItem>
                      <SelectItem value="none">Do nothing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {h.action === "goto" && (
                  <div className="space-y-1">
                    <Label className="text-[10px]">Target Scene</Label>
                    <Select
                      value={h.targetNodeId || ""}
                      onValueChange={(v) => {
                        const hotspots = [...(scene.hotspots || [])];
                        hotspots[idx] = { ...h, targetNodeId: v };
                        handleFieldChange('hotspots', hotspots);
                      }}
                    >
                      <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Pick a scene..." /></SelectTrigger>
                      <SelectContent>
                        {Object.values(scenes).map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {h.action === "advanceTime" && (
                  <div className="space-y-1">
                    <Label className="text-[10px]">Minutes to Advance</Label>
                    <Input
                      className="h-7 text-xs"
                      type="number"
                      value={h.advanceMinutes ?? 60}
                      onChange={(e) => {
                        const hotspots = [...(scene.hotspots || [])];
                        hotspots[idx] = { ...h, advanceMinutes: Number(e.target.value) || 0 };
                        handleFieldChange('hotspots', hotspots);
                      }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <Label className="text-[10px] text-muted-foreground">Show outline at play time</Label>
                  <Switch
                    className="scale-75"
                    checked={!!h.showOutline}
                    onCheckedChange={(v) => {
                      const hotspots = [...(scene.hotspots || [])];
                      hotspots[idx] = { ...h, showOutline: v };
                      handleFieldChange('hotspots', hotspots);
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <Separator />

        {/* Scene clock action */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <Label>Time Change</Label>
            </div>
            <Switch
              className="scale-75"
              checked={!!scene.time}
              onCheckedChange={(v) =>
                handleFieldChange('time', v ? { mode: "advance", value: 60 } : undefined)
              }
            />
          </div>
          {scene.time && (
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={scene.time.mode}
                onValueChange={(v) => handleFieldChange('time', { ...scene.time!, mode: v as "set" | "advance" })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="advance">Advance by</SelectItem>
                  <SelectItem value="set">Set clock to</SelectItem>
                </SelectContent>
              </Select>
              {scene.time.mode === "set" ? (
                <Input
                  className="h-8 text-xs"
                  type="time"
                  value={`${String(Math.floor((scene.time.value % 1440) / 60)).padStart(2, "0")}:${String(scene.time.value % 60).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [hh, mm] = e.target.value.split(":").map(Number);
                    if (!isNaN(hh) && !isNaN(mm)) handleFieldChange('time', { ...scene.time!, value: hh * 60 + mm });
                  }}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    value={scene.time.value}
                    onChange={(e) => handleFieldChange('time', { ...scene.time!, value: Number(e.target.value) || 0 })}
                  />
                  <span className="text-[10px] text-muted-foreground">min</span>
                </div>
              )}
            </div>
          )}
          <p className="text-[9px] text-muted-foreground italic">
            Applied when this scene is entered. Enable the clock in Story controls.
          </p>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <Label>Branching Choices</Label>
            <Button variant="outline" size="icon" className="h-6 w-6" onClick={addChoice}>
              <PlusCircle className="w-4 h-4" />
            </Button>
          </div>
          {scene.choices.map((choice, i) => (
            <div key={i} className="flex gap-2 items-start p-2 border rounded-md bg-background group relative">
              <div className="flex-1 space-y-2">
                <Input 
                  placeholder="Choice text" 
                  value={choice.text} 
                  onChange={(e) => {
                    const newChoices = [...scene.choices];
                    newChoices[i].text = e.target.value;
                    handleFieldChange('choices', newChoices);
                  }}
                  className="h-7 text-xs"
                />
                <Select
                   value={choice.nextNodeId}
                   onValueChange={(v) => {
                    const newChoices = [...scene.choices];
                    newChoices[i].nextNodeId = v;
                    handleFieldChange('choices', newChoices);
                   }}
                >
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Target Node" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(scenes).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Story-value gate and side effect for this choice. */}
                <ExpressionBuilder
                  mode="condition"
                  value={choice.condition || ""}
                  variables={variables || []}
                  clockEnabled={clockEnabled}
                  onChange={(next) => {
                    const newChoices = [...scene.choices];
                    newChoices[i] = { ...newChoices[i], condition: next };
                    handleFieldChange('choices', newChoices);
                  }}
                />
                {!!(choice.condition || "").trim() && (
                  <label className="flex items-center gap-2 text-[9px] text-muted-foreground cursor-pointer pl-9">
                    <input
                      type="checkbox"
                      checked={!!choice.showLocked}
                      onChange={(e) => {
                        const newChoices = [...scene.choices];
                        newChoices[i] = { ...newChoices[i], showLocked: e.target.checked };
                        handleFieldChange('choices', newChoices);
                      }}
                      className="accent-primary"
                    />
                    Show greyed out when locked
                  </label>
                )}
                <ExpressionBuilder
                  mode="effect"
                  value={choice.effect || ""}
                  variables={variables || []}
                  clockEnabled={clockEnabled}
                  onChange={(next) => {
                    const newChoices = [...scene.choices];
                    newChoices[i] = { ...newChoices[i], effect: next };
                    handleFieldChange('choices', newChoices);
                  }}
                />
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={() => removeChoice(i)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
