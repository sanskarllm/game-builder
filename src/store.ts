import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CharacterParams } from './lib/humanoid';
import type { ModelSpec } from './lib/modelSpec';
import type { RigFit } from './lib/skeletons';
import type { StoryBlueprint } from './lib/gameBlueprint';

export type SectionId = 'game' | 'characters' | 'text3d' | 'rigging' | 'script';

export type Engine = 'unity' | 'unreal' | 'godot';

export interface GameProject {
  id: string;
  name: string;
  genre: string;
  perspective: string;
  engine: Engine;
  description: string;
  characterIds: string[];
  assetIds: string[];
  storyId: string | null;
  createdAt: number;
}

export interface Asset3D {
  id: string;
  name: string;
  prompt: string;
  seed: number;
  spec: ModelSpec;
  fit?: RigFit;
  createdAt: number;
}

export interface RigSourceRef {
  kind: 'character' | 'asset';
  id: string;
}

interface AppState {
  section: SectionId;
  projects: GameProject[];
  activeProjectId: string | null;
  characters: CharacterParams[];
  assets: Asset3D[];
  stories: StoryBlueprint[];
  rigSource: RigSourceRef | null;

  setSection(section: SectionId): void;
  addProject(project: GameProject): void;
  updateProject(id: string, patch: Partial<GameProject>): void;
  deleteProject(id: string): void;
  setActiveProject(id: string | null): void;
  saveCharacter(character: CharacterParams): void;
  deleteCharacter(id: string): void;
  addAsset(asset: Asset3D): void;
  deleteAsset(id: string): void;
  addStory(story: StoryBlueprint): void;
  deleteStory(id: string): void;
  sendToRig(ref: RigSourceRef): void;
}

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      section: 'game',
      projects: [],
      activeProjectId: null,
      characters: [],
      assets: [],
      stories: [],
      rigSource: null,

      setSection: (section) => set({ section }),
      addProject: (project) => set((s) => ({ projects: [project, ...s.projects], activeProjectId: project.id })),
      updateProject: (id, patch) => set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      deleteProject: (id) =>
        set((s) => {
          const projects = s.projects.filter((p) => p.id !== id);
          return { projects, activeProjectId: s.activeProjectId === id ? (projects[0]?.id ?? null) : s.activeProjectId };
        }),
      setActiveProject: (id) => set({ activeProjectId: id }),
      saveCharacter: (character) => set((s) => ({ characters: upsert(s.characters, character) })),
      deleteCharacter: (id) =>
        set((s) => ({
          characters: s.characters.filter((c) => c.id !== id),
          projects: s.projects.map((p) => ({ ...p, characterIds: p.characterIds.filter((x) => x !== id) })),
        })),
      addAsset: (asset) => set((s) => ({ assets: upsert(s.assets, asset) })),
      deleteAsset: (id) =>
        set((s) => ({
          assets: s.assets.filter((a) => a.id !== id),
          projects: s.projects.map((p) => ({ ...p, assetIds: p.assetIds.filter((x) => x !== id) })),
        })),
      addStory: (story) => set((s) => ({ stories: upsert(s.stories, story) })),
      deleteStory: (id) =>
        set((s) => ({
          stories: s.stories.filter((x) => x.id !== id),
          projects: s.projects.map((p) => (p.storyId === id ? { ...p, storyId: null } : p)),
        })),
      sendToRig: (ref) => set({ rigSource: ref, section: 'rigging' }),
    }),
    { name: 'game-builder', version: 1 },
  ),
);
