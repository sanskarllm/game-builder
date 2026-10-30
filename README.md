# Game Builder

A browser app for building game assets and turning stories into games. The left panel has five tools:

| Section | What it does |
| --- | --- |
| **Create Game** | Create game projects (genre, perspective, target engine), pick the characters, props and story they use, and export a `.zip` bundle for Unity, Unreal or Godot. |
| **Characters** | Build T-posed humanoids: proportion presets (Realistic, Heroic, Slender, Chibi), height/build/head/limb sliders, outfits, hair and colours. |
| **Text to 3D** | Type a prompt (`golden sword`, `three pine trees`, `a knight with a sword`) and get a model. It reads objects, colours, materials, sizes and counts. Save to a library or download `.glb`. |
| **Rigging** | Auto-generates a humanoid skeleton named for **Unity Mecanim Humanoid**, the **Unreal mannequin** or **Mixamo**, skins the mesh, lets you test-pose it (walk, wave, arms down) and exports a rigged `.glb` plus a bone-map JSON. Works on generated characters and uploaded `.glb/.gltf/.obj/.fbx` files. |
| **Script → Game** | Paste a screenplay or prose story. Scenes become levels, characters become the player, NPCs and bosses, and the plot becomes objectives (defeat, collect, talk, explore). Play the result as a top-down prototype in the browser or export the blueprint JSON. |

Everything runs locally in the browser. There is no backend or API key, and your work is saved to `localStorage`.

## Getting started

```bash
npm install
npm run dev
```

Other scripts: `npm run build`, `npm test` (vitest), `npm run typecheck`.

## Using the exports in an engine

- **Unreal Engine 5**: import the rigged `.glb` as a Skeletal Mesh. Bones follow the mannequin names (`root`, `pelvis`, `spine_01`, `upperarm_l`…), so you can retarget mannequin animations with an IK Retargeter.
- **Unity**: import the `.glb` with a glTF package (UnityGLTF or glTFast), or convert it to FBX in Blender. Then set *Rig → Animation Type → Humanoid*. Bone names match Unity's auto-mapping (`Hips`, `Spine`, `LeftUpperArm`…).
- **Godot 4**: imports `.glb` natively. The Unity-style names match Godot's `SkeletonProfileHumanoid`.
- **Mixamo naming** (`mixamorig:Hips`…) lets Mixamo animation clips bind directly.

## Project layout

```
src/
  lib/
    modelSpec.ts      JSON model description → three.js meshes (primitives, merge, instances)
    humanoid.ts       parametric character generator + exact joint landmarks
    textTo3d.ts       prompt parser + procedural templates (the generateModel() seam for an AI provider)
    skeletons.ts      canonical humanoid joints and Unity / Unreal / Mixamo bone names
    autoRig.ts        skeleton fitting, distance-based skin weights, test poses
    scriptParser.ts   screenplay / prose → scenes, characters, dialogue
    gameBlueprint.ts  scenes → levels, roles, objectives, enemies, items
    storyGame.ts      canvas runtime that plays a blueprint
    projectExport.ts  engine bundle (.zip) export
  sections/           one React component per sidebar section
  components/         sidebar, 3D viewport, story player, form controls
```

## Current limits and next steps

- Text to 3D uses offline procedural templates (about 40 object types, plus humanoids). An AI text-to-3D service can be added behind `generateModel()` in `src/lib/textTo3d.ts`.
- Script reading uses heuristics. Plugging in an LLM would give richer quests and branching dialogue, using the same `StoryBlueprint` shape.
- Auto-rigging expects upright, front-facing (+Z) humanoids in a T- or A-pose. It has no finger bones yet, and the export is glTF only (no direct FBX).
