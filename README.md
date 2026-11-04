# Game Forge — AI game assistant & game builder, powered by Meta AI

Game Forge turns a one-line idea into a playable branching game, then lets you
edit everything with an AI copilot. **Every AI feature runs on Meta AI models**:
**Muse Spark** (Meta Model API) for writing, art, music and 3D design, and
Meta's **SAM 3D Body** to turn a picture of a person into a 3D model.

| Feature | What Meta AI does |
|---|---|
| **New game with Meta AI** | Writes the title, characters, locations, soundtrack and every branching scene (dialogue + choices) |
| **Forge Assistant** | Chat copilot that reviews your story, brainstorms, and *edits the project directly*. Every change can be undone |
| **Write this scene** | Rewrites one scene's dialogue, cast and choices from your direction |
| **2D art** | Paints backgrounds and draws characters as vector art (SVG) |
| **Music** | Composes looping melodies that play in the game |
| **3D assets** | Designs buildings, people and props from 3D shapes; export as `.glb` for Unity, Godot, Unreal or Blender |
| **3D from an image** | **SAM 3D Body** rebuilds a person from a photo or drawing as a posed 3D body mesh, on your own GPU. Optional **SAM 3D Objects** does any object on a cloud GPU |

Also: drag-to-arrange scene chart, live preview, full-screen playtest, upload
your own images and audio, autosave, undo, and **Export → Playable game
(.html)**, a single file anyone can open in a browser.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Get the code](#2-get-the-code)
3. [Run Game Forge](#3-run-game-forge)
4. [Connect Meta AI (Muse Spark)](#4-connect-meta-ai-muse-spark)
5. [Set up SAM 3D Body (image → 3D person)](#5-set-up-sam-3d-body-image--3d-person)
6. [Using Game Forge](#6-using-game-forge)
7. [Optional: SAM 3D Objects on a cloud GPU](#7-optional-sam-3d-objects-on-a-cloud-gpu)
8. [Files and licences](#8-files-and-licences)

---

## 1. What you need

**For Game Forge itself** (any Windows, Mac or Linux computer):

- [Node.js](https://nodejs.org) 18 or newer (the LTS version is fine)
- A modern browser (Chrome, Edge or Firefox)
- A **Meta Model API key** for Muse Spark: https://dev.meta.ai/api-keys/
  (public preview for developers in the US)

**For SAM 3D Body** (optional, turns pictures of people into 3D):

- Windows 10/11 (the one-click installer is for Windows)
- An **NVIDIA GPU** — RTX 20-series or newer, **8 GB+ VRAM** (it peaks at about
  7.2 GB), with a recent driver (570 or newer for CUDA 12.8)
- **16 GB+ RAM**, with about 8 GB free while it runs
- **About 12 GB of free disk**: ~6 GB for Python and PyTorch, 2.7 GB for the
  SAM 3D Body weights, ~1.3 GB for MoGe2
- [git](https://git-scm.com)
- A free [Hugging Face](https://huggingface.co/join) account with access to
  the model (step 5 shows how)

## 2. Get the code

```bash
git clone https://github.com/sanskarllm/game-builder.git
cd game-builder
```

No git? On GitHub click **Code → Download ZIP**, then unzip it. (SAM 3D Body's
installer still needs git, so installing it is recommended.)

Tip: keep the folder **outside OneDrive / Dropbox** if you can.

## 3. Run Game Forge

**Windows:** double-click **`start-game-forge.bat`**. It starts the server and
opens http://localhost:5173 in your browser. Keep that window open while you
work.

**Any system:**

```bash
node server.js
```

Then open http://localhost:5173. Nothing to `npm install`: there are no
dependencies.

To stop it, close the window or press **Ctrl+C**.

## 4. Connect Meta AI (Muse Spark)

1. Create a key at https://dev.meta.ai/api-keys/
2. In Game Forge, click the **Meta AI** tab (top right).
3. Leave **Provider** on **Meta Model API · Muse Spark** and the model on
   `muse-spark-1.1` (type `muse-spark-1.3` if your account has it).
4. Paste your key into **API key** and click **Test connection**. You should see
   "Game Forge is connected to Meta AI".

The key is stored in that browser only and sent only to your local Game Forge
server, which forwards it to Meta.

**Prefer to keep the key out of the browser?** Copy `.env.example` to `.env`,
put the key after `MODEL_API_KEY=`, and restart Game Forge.

**No Meta Model API access?** The Provider list also has Meta Llama options:
Meta Llama API (llama.com), Groq, Together AI, or Llama running on your own PC
with [Ollama](https://ollama.com) (`ollama pull llama3.2`, no key needed).

## 5. Set up SAM 3D Body (image → 3D person)

You only do this once. Everything installs into `%USERPROFILE%\sam3d`, outside
the project folder.

1. **Get access to the model.** Sign in to Hugging Face, open
   https://huggingface.co/facebook/sam-3d-body-dinov3 and accept the terms.
   Approval is usually quick.
2. **Run the installer.** Open the `sam3d-service` folder and double-click
   **`install-body.bat`**. It:
   - checks for an NVIDIA GPU and git
   - installs [uv](https://docs.astral.sh/uv/) (a Python manager) if needed
   - creates a Python 3.11 environment in `%USERPROFILE%\sam3d\.venv`
   - installs PyTorch for CUDA 12.8 (about 3 GB) and the other packages
   - checks that PyTorch can see your GPU ("GPU OK: …")
3. **Sign in to Hugging Face when asked.** The installer shows
   `How would you like to log in?`. Press **Enter** for "Log in with your
   browser" and approve it in the page that opens. (Or choose "Paste an access
   token" and paste a **Read** token from
   https://huggingface.co/settings/tokens.) Type tokens only into that window.
4. **Wait for the download.** It fetches the 2.7 GB checkpoint and ends with
   **"All set."** Press any key to close it.

## 6. Using Game Forge

- **Build a game:** click **New game with Meta AI**, describe your idea (or pick
  an example), choose genre, tone and length, then **Build my game**. Leave
  "Also paint backgrounds and characters" ticked for art (slower) or untick it
  for a quick first draft.
- **Edit:** click any scene in the **Scene chart** (drag to rearrange). The
  **Edit** tab changes the title, background, characters (L/C/R), music,
  dialogue (`Speaker: text`, one per line) and choices. **Write this scene**
  lets Muse Spark rewrite it.
- **Forge Assistant:** the **Assistant** tab is a chat. Ask for feedback or
  changes ("add a twist where the mentor betrays the hero"). Changes it makes
  are listed under its reply; **Undo** (top bar) reverts them.
- **Assets:** the left panel lists characters, backgrounds and music. Click one
  to use it in the current scene. Hover for **Draw/Paint/Compose with Meta AI**,
  **Make 3D**, and delete. **Upload** adds your own images or audio.
- **3D:** switch to **3D Assets**. **Model a … with Meta AI** builds a model
  from shapes. **From image · SAM 3D** turns a picture into a mesh: pick
  **SAM 3D Body · people** and upload one person (photo or drawing; a
  transparent-background PNG works best). Or hover a character and click the
  **cube** icon. Set the height in metres, rotate it if it lies down, then
  **Export .glb**.
- **Play:** **Play build** opens the full-screen player.
- **Share:** **Export → Playable game (.html)** saves one file that runs in any
  browser. **Export → Project file (.json)** saves everything for later;
  **Import project…** loads it back.

Your work autosaves in the browser. 3D meshes are stored in the browser's
IndexedDB and included in project exports.

SAM 3D Body gives a **posed human body without clothes, hair or texture**: a
base to dress in Blender or a stand-in for testing.

## 7. Optional: SAM 3D Objects on a cloud GPU

SAM 3D Objects reconstructs **any object** (textured mesh) but needs **Linux and
a 32 GB+ NVIDIA GPU** (A100, L40S, RTX 6000 Ada, H100…), so it runs on a
rented cloud GPU. Setup steps are in
[`sam3d-service/README.md`](sam3d-service/README.md#sam-3d-objects-on-a-cloud-gpu-linux-32-gb).
Then in Game Forge → **Meta AI** → **SAM 3D**, enter the server's URL and token.

## 8. Files and licences

| Path | What it is |
|---|---|
| `start-game-forge.bat` | Windows launcher for Game Forge |
| `server.js` | Local web server; forwards AI calls to Meta (keeps keys server-side) |
| `public/` | The editor: `app.js` (UI), `ai.js` (every Meta AI prompt), `player.js` (game runtime, also used by exported games), `viewer3d.js` (3D viewer + GLB export), `sample.js` (starter game) |
| `.env.example` | Optional server settings (API key, model, SAM 3D service URL) |
| `sam3d-service/server.py` | SAM 3D service (Body and Objects) that returns `.glb` meshes |
| `sam3d-service/install-body.bat`, `start-body.bat` | One-click SAM 3D Body install and start |
| `sam3d-service/sam-3d-body/` | Meta's SAM 3D Body code, bundled unchanged |

- **SAM 3D Body** code in `sam3d-service/sam-3d-body/` is © Meta and
  redistributed under the **SAM License**
  ([`LICENSE`](sam3d-service/sam-3d-body/LICENSE),
  [`NOTICE.md`](sam3d-service/sam-3d-body/NOTICE.md)). The model weights are
  not in this repo; they download from Hugging Face under the same licence.
- Using Muse Spark is subject to Meta's Model API terms; Meta Llama models to
  the Llama licence.
