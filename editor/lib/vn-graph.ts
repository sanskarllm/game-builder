/**
 * @fileOverview Shape of the story graph.
 *
 * A "linear run" is a maximal chain of scenes where each step has exactly one
 * way out and the next scene exactly one way in — plain dialogue with no
 * branching. Both the story map (which folds runs into one card) and the
 * script view (which types a run as a screenplay) work off these.
 */

import type { SceneNode } from "./vn-types";

export function inDegrees(scenes: Record<string, SceneNode>): Map<string, number> {
  const counts = new Map<string, number>();
  Object.keys(scenes).forEach(id => counts.set(id, 0));
  Object.values(scenes).forEach(s =>
    (s.choices || []).forEach(c => {
      if (scenes[c.nextNodeId]) counts.set(c.nextNodeId, (counts.get(c.nextNodeId) || 0) + 1);
    }),
  );
  return counts;
}

/** The single scene this one flows into, or null when it branches or ends. */
export function soleChild(scenes: Record<string, SceneNode>, id: string): string | null {
  const choices = scenes[id]?.choices || [];
  return choices.length === 1 && scenes[choices[0].nextNodeId] ? choices[0].nextNodeId : null;
}

/** The single scene that flows into this one, or null. */
export function soleParent(scenes: Record<string, SceneNode>, id: string): string | null {
  const parents = Object.values(scenes).filter(s => (s.choices || []).some(c => c.nextNodeId === id));
  return parents.length === 1 ? parents[0].id : null;
}

/** Group every scene into linear runs. Returns head id → chain (head first). */
export function buildChains(scenes: Record<string, SceneNode>): Map<string, string[]> {
  const counts = inDegrees(scenes);

  // A scene continues a run when its only parent's only exit is this scene.
  const isContinuation = (id: string) => {
    if ((counts.get(id) || 0) !== 1) return false;
    const parent = soleParent(scenes, id);
    return !!parent && (scenes[parent].choices || []).length === 1;
  };

  const chains = new Map<string, string[]>();
  const claimed = new Set<string>();

  Object.keys(scenes).forEach(id => {
    if (claimed.has(id) || isContinuation(id)) return;
    const chain = [id];
    claimed.add(id);
    let cursor = soleChild(scenes, id);
    while (cursor && !claimed.has(cursor) && isContinuation(cursor)) {
      chain.push(cursor);
      claimed.add(cursor);
      cursor = soleChild(scenes, cursor);
    }
    chains.set(id, chain);
  });

  // Scenes inside a pure cycle have no natural head — give each its own run.
  Object.keys(scenes).forEach(id => {
    if (!claimed.has(id)) {
      chains.set(id, [id]);
      claimed.add(id);
    }
  });

  return chains;
}

/** The run containing a scene, head first. Always includes the scene itself. */
export function chainContaining(scenes: Record<string, SceneNode>, id: string): string[] {
  if (!scenes[id]) return [];
  for (const chain of buildChains(scenes).values()) {
    if (chain.includes(id)) return chain;
  }
  return [id];
}
