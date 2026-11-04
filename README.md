# Game Forge — AI game assistant & game builder, powered by Meta AI

Game Forge turns a one-line idea into a playable branching game, then lets you
edit everything with an AI copilot. **Every AI feature runs on Meta AI models**:
**Muse Spark** on Meta Model API by default, with Meta Llama as an alternative.

| Feature | What Meta AI does |
|---|---|
| **New game with Meta AI** | Writes the title, characters, locations, soundtrack list and every branching scene (dialogue + choices) as structured JSON |
| **Forge Assistant** | Chat copilot that reviews your story, brainstorms, and *edits the project directly* (adds/edits/deletes scenes, characters, backgrounds, music). Every change is undoable |
| **Write this scene** | Rewrites one scene's dialogue, cast and choice text from your direction |
| **2D art** | Paints backgrounds and draws characters as SVG vector art |
| **Music** | Composes loopable melodies (note sequences) that play in-game via WebAudio |
| **3D assets** | Designs buildings, people and props from 3D primitives, shown in a three.js viewer and exportable as `.glb` (Unity / Godot / Unreal / Blender) |
| **3D from an image** | Meta's **SAM 3D Objects** reconstructs a full mesh from one cut-out image, or from any Game Forge character (**Make 3D**). Needs a 32 GB+ Linux GPU, see `sam3d-service/README.md` |

Other tools: drag-to-arrange scene chart with unreachable-scene warnings, live
scene preview, full-screen playtest, upload your own images/audio, autosave,
undo, and **Export → Playable game (.html)** — a single self-contained file
anyone can open in a browser.

## Run it

Requires Node.js 18+ (no `npm install` needed).

```bash
cd game-forge
node server.js
```

Open http://localhost:5173

## Connect Meta AI (Muse Spark)

1. Create an API key at https://dev.meta.ai/api-keys/
2. Either paste it in the app (**Meta AI** tab, top right), or copy
   `.env.example` to `.env`, set `MODEL_API_KEY=...`, and restart the server
   (keeps the key off the browser entirely).
3. Click **Test connection**.

Default: model `muse-spark-1.1` on `https://api.meta.ai/v1` (OpenAI-compatible
Chat Completions). You can type `muse-spark-1.3` in the Model box if your
account has it. Muse Spark is a reasoning model, so Game Forge gives it a
larger output budget and asks for `reasoning_effort: low` on quick tasks
(`medium` when writing a whole game).

The other presets run Meta Llama instead: Meta Llama API (llama.com), Groq,
Together AI, or Llama on your own machine with Ollama.

## SAM 3D (image → 3D)

**SAM 3D Body** (people) runs on your own NVIDIA GPU. On Windows, double-click
`sam3d-service/install-body.bat` once, then `sam3d-service/start-body.bat`
whenever you use Game Forge. It answers on `http://127.0.0.1:8000`, which Game
Forge uses by default. Measured on an RTX 5070: about 0.8 s per image, 4.5 GB
VRAM at rest, 7.2 GB peak.

**SAM 3D Objects** (any object) needs Linux and a 32 GB+ GPU, so it runs on a
cloud GPU; see `sam3d-service/README.md`, then put its URL and token in the
**Meta AI** tab (or `SAM3D_URL` / `SAM3D_TOKEN` in `.env`).

Generated meshes are kept in the browser's IndexedDB and included in project
exports.

## Files

- `server.js` — static server + `/api/chat` proxy to the Meta AI endpoint (avoids CORS, keeps the key server-side)
- `public/ai.js` — every Meta AI prompt and the response parsing/validation
- `public/app.js` — editor UI (Preact + htm from CDN, no build step)
- `public/player.js` — game runtime, shared by the editor preview and exported games
- `public/viewer3d.js` — three.js viewer + GLB export
- `public/sample.js` — starter project "The Lantern Keeper"
- `sam3d-service/` — FastAPI service for SAM 3D Body / SAM 3D Objects (returns `.glb`); `install-body.bat` + `start-body.bat` set up SAM 3D Body on Windows in one click
- `sam3d-service/sam-3d-body/` — Meta's SAM 3D Body code, bundled under the SAM License
