# Game Forge — AI game assistant & game builder, powered by Meta AI

Game Forge is a visual novel maker with two modes. **2D Novel** turns a
one-line idea into a branching story with 2D art, and lets you edit everything
with an AI copilot. **3D Novel** is a sandbox-style 3D story game: the dialogue
box only shows what people say, and you move the story on by doing things in
the world, like clicking a person to talk, the pan to cook or a door to go to
another room. **Every AI feature runs on Meta AI models**: **Muse Spark** (Meta
Model API) for writing, music and 3D design, **Muse Image** for 2D art, **Muse Wonder** to build the
3D novel, and Meta's **SAM 3D Body** to turn a picture of a person into a 3D
body.

| Feature | What Meta AI does |
|---|---|
| **3D Novel** | **Muse Wonder** makes a sandbox-style 3D story game: the dialogue box is only for reading, and you progress by clicking things in the world (a person to talk, the pan to cook, a door to change room). It decides the story, world and design itself, and can use your 3D models (SAM 3D Body people as the starting point for its characters). Play it in the app, change it by asking, save it as one `.html` |
| **New game with Meta AI** | Writes the title, characters, locations, soundtrack and every branching scene (dialogue + choices) |
| **Forge Assistant** | Chat copilot that reviews your story, brainstorms, and *edits the project directly*. Every change can be undone |
| **Write this scene** | Rewrites one scene's dialogue, cast and choices from your direction |
| **Infinity novel** | After The End, Meta AI keeps the story going: scene by scene from what the player types (Enhanced), or a whole new chapter with fixed choices (Part Two). It learns what each player enjoys from what they do |
| **2D art** | Muse Image generates widescreen backgrounds and character sprites using a Meta Model API key |
| **Music** | Composes looping melodies that play in the game |
| **3D assets** | Designs buildings, people and props from 3D shapes; export as `.glb` for Unity, Godot, Unreal or Blender |
| **3D from an image** | **SAM 3D Body** rebuilds a person from a photo or drawing as a posed 3D body mesh, on your own GPU. Optional **SAM 3D Objects** does any object on a cloud GPU |

Also: drag-to-arrange scene chart, live preview, full-screen playtest, upload
your own images and audio, autosave, undo, **Save → Save 2D novel (.html)**
and **Save 3D novel (.html)**, single files anyone can open in a browser, and **Save → Export
asset pack (.zip)** with every asset ready for Blender, Unity, Godot or Unreal.

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

**One key, every Muse model.** The same key works for all Muse models on Meta
Model API. Game Forge uses these models:

| Setting | Default | Used for |
|---|---|---|
| **Model · story, music, 3D and the assistant** | `muse-spark-1.1` (or `muse-spark-1.3`) | story, music, 3D assets and assistant responses |
| **2D Novel art** | `muse-image-1.0` | character sprites and backgrounds |
| **Model · 3D Novel code** | `muse-wonder-1.0` | building the 3D novel (Meta's strongest coding model) |

Click **List the models my key can use** to see every model your account has
and pick any of them. Muse Wonder Full is not on the API yet. Muse Wonder costs
more per token than Muse Spark.

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
5. **Start SAM 3D Body.** In Game Forge, open **3D Assets** and press **Start**
   on the **SAM 3D Body · Characters** card in the side panel. It turns
   **Running** once the model is on the GPU (about 20–30 s). Tick **Start them
   automatically when I open 3D Assets** to skip the click next time. (You can
   also double-click **`sam3d-service\start-body.bat`** and keep its window
   open.)

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
- **2D Novel:** where you write a branching story: scenes, dialogue, choices,
  characters, backgrounds and music, with 2D art.
- **3D Novel (an interactive 3D story):** click **3D Novel** on the left.
  Choose the **Prompt**: **Game Forge's + my idea** (Game Forge's short prompt
  describes a sandbox-style 3D story; **See Game Forge's prompt** shows it), or
  **My own prompt** to write your own: the kind of game, story and look you
  want. Game Forge always adds the technical details itself (your 3D models,
  how to load them, how the file runs), so your prompt only needs your ideas. Type an idea, or leave it empty and Muse Wonder decides.
  **Optional starting points** (Isometric room diorama, Cozy café or shop,
  Investigation room, Rooms to explore) add an editable description to your
  idea, for novels set in isometric cut-away rooms. **Reference images** (up
  to 4) show Muse Wonder the look you have in mind. Tick **Let it use my
  3D models** to hand it your models: SAM 3D Body people are its starting point
  for characters (**Add a person from an image** makes one). Tick **Share my 2D
  novel as inspiration** if you like; the 3D story does not have to follow it.
  Click **Build with Meta AI**: in a few minutes Muse Wonder builds a
  sandbox-style 3D world. The dialogue box only shows what people say; there
  are no choice buttons. You move the story on by doing things: click a person
  to talk, the pan to cook, a door to go to another room. Click inside to play. To change it, type what you want under
  **Change it** and click **Apply with Meta AI**. If it shows an error, **Fix
  with Meta AI** sends the error back. **Undo** goes back a version. **Save 3D
  novel (.html)** saves one file that runs in any browser, with your models
  inside. It runs sandboxed: it cannot see Game Forge, your key or your files.
- **Assets for your own 3D software:** **Save → Export asset pack (.zip)**
  saves every asset: 3D models as `.glb` (metres, Y up, standing on the ground),
  characters and backgrounds as `.svg` and `.png`, music as `.wav`, the project
  file and the playable games. A `README.txt` inside explains how to import
  into Blender, Godot, Unity and Unreal. One model: **Export .glb** in 3D
  Assets.
- **SAM 3D side panel:** in **3D Assets** the panel beside the viewer has a
  card for **SAM 3D Body** (characters) and one for **SAM 3D Objects**
  (buildings and props). Each shows **Running**, **Starting…**, **Stopped** or
  **Not installed**, with **Start** and **Stop** buttons. **Start all
  installed** starts every model this PC has. Models you start here stop when
  Game Forge closes.
- **3D:** switch to **3D Assets**. **Model a … with Meta AI** builds a model
  from shapes. **From image** turns a picture into a mesh, and the category
  picks the Meta model: **Human** uses **SAM 3D Body** (people only), and
  **Building** and **Prop** use **SAM 3D Objects**. On the **Humans** tab,
  **From image · SAM 3D Body** only makes people. Upload one person (photo or
  drawing; a transparent-background PNG works best). Or hover a character and
  click the **cube** icon. Set the height in metres, rotate it if it lies down, then
  **Export .glb**.
- **Play:** **Play build** opens the full-screen player.
- **Save your project:** click **Save** (or press **Ctrl+S**). In Chrome or Edge
  the first save asks where to put the `.gameforge.json` file, and every save
  after that updates the same file; other browsers save a copy to Downloads.
  The arrow next to **Save** has **Save project as…** (Ctrl+Shift+S),
  **Save 2D novel (.html)**, **Save 3D novel (.html)**, **Export asset pack
  (.zip)** and **Reset to sample game**. The top bar
  shows "Saved" or "Unsaved changes".
- **Open a saved project:** click **Open** (or press **Ctrl+O**) and pick a
  `.gameforge.json` file.
- **Start over:** **New project** gives you an empty game (one scene, nothing
  else) to build by hand or with Forge Assistant. If the current project has
  unsaved changes it offers to save first, and **Undo** brings the previous
  project back.
- **Share:** **Save → Save 2D novel (.html)** or **Save 3D novel (.html)** saves
  one file that runs in any browser.
- **Infinity novel (the story never has to end):** when a player reaches The End
  of a 2D novel, in **Play build** or the Community, they can keep going with
  Meta AI in one of two modes:
  - **Enhanced:** there are no set choices. The player types what they do, and
    Meta AI writes the next scene on the spot, for as long as they like.
  - **Part Two:** Meta AI writes a whole new chapter in one go, with fixed
    choices to pick from. Its ending offers Part Three, and so on.

  Every choice and typed action teaches the story what that player enjoys and
  avoids, and it steers towards that. Players can see what it has learned at
  each ending and in **☰ Menu**. Their progress and that memory are saved in
  their browser (in the Community the sandbox blocks this, so they last for that
  sitting). What Meta AI writes never changes your project. It uses 2D novels
  only, and new characters and places it invents get placeholder art.
  **Who pays:** Play build uses the key in the Meta AI tab. In the Community it
  uses that browser's key on the same computer, otherwise `MODEL_API_KEY` on the
  server, limited to 60 requests an hour per visitor. With no key, players see a
  message saying one is needed. A saved `.html` novel opened on its own simply
  ends, because it has no AI to call.
- **Community:** click **Community** in the top bar, or open
  http://localhost:5173/community.html. People can browse, search and play
  novels posted by others, and like or dislike them. To post, use **Save → Post
  to Community…** in the editor (**Suggest with Meta AI** writes the tags), or
  **Post a novel** on the Community page with a saved `.html` novel or a
  `.gameforge.json` project. **For you** learns from each person's likes and
  dislikes (tags, 2D or 3D, authors), says why it picked a novel, and **Your
  taste** shows what it has learned. Every novel runs sandboxed, so it cannot
  see your account, key or projects or send data out.
  - **Accounts:** anyone can browse and play. Liking, posting and reporting need
    a free account (username and password), one vote per account, and your taste
    profile and novels follow you to any device. There is no email, so a
    forgotten password cannot be reset.
  - **Saving in a novel:** Save, Load and Continue work in the Community. Signed
    in, saves stay with your account and follow you to any device. As a guest
    they stay in that browser. This applies to 2D novels saved or posted with
    this version of Game Forge.
  - **Reporting:** the flag on a card reports a novel, with a reason. Three
    reports from different accounts hide it until an admin looks at it
    (`COMMUNITY_HIDE_AT` changes the number).
  - **Admins:** add your username to `COMMUNITY_ADMINS` in `.env`, restart, and
    create that account on the machine running Game Forge. Admins get a
    **Moderation** tab to open a reported novel, **Keep** it, **Remove** it or
    **Ban author**, which also removes all their novels, and they can remove any
    novel.
  Novels are stored in `data/community` on the server running Game Forge, so
  people see each other's novels only when they use the same server. To let
  others in, run it on a server they can reach with `HOST=0.0.0.0`, behind
  HTTPS, so passwords are encrypted on the way (set `COMMUNITY_HTTPS=1`). Visitors from other machines get only the Community; the editor and
  the AI, key and GPU routes stay on the machine running it.
- **Saving in the game:** players can open **☰ Menu** while playing to
  **Save game** or **Load game** in three slots. The game also autosaves, so the
  title screen offers **Continue**. This works in **Play build** and in exported
  `.html` games; saves stay in the player's browser.

Your work also autosaves in the browser. 3D meshes are stored in the browser's
IndexedDB and included in project exports.

SAM 3D Body gives a **posed human body without clothes, hair or texture**: a
base to dress in Blender or a stand-in for testing.

## 7. Optional: SAM 3D Objects on a cloud GPU

SAM 3D Objects reconstructs **any object** (textured mesh) but needs **Linux and
a 32 GB+ NVIDIA GPU** (A100, L40S, RTX 6000 Ada, H100…), so it runs on a
rented cloud GPU. Setup steps are in
[`sam3d-service/README.md`](sam3d-service/README.md#sam-3d-objects-on-a-cloud-gpu-linux-32-gb).
Then in Game Forge → **Meta AI** → **SAM 3D**, enter the server's URL and token.

On a Linux machine that has such a GPU, you can start Objects from the side
panel instead: put `SAM3D_OBJECTS_REPO` (the sam-3d-objects folder) and
`SAM3D_OBJECTS_PYTHON` (its Python) in `.env`, restart Game Forge, and press
**Start** on the **SAM 3D Objects** card. It runs on port 8001.

## 8. Files and licences

| Path | What it is |
|---|---|
| `start-game-forge.bat` | Windows launcher for Game Forge |
| `server.js` | Local web server; forwards AI calls to Meta (keeps keys server-side) |
| `community.js` | Community server: accounts, novels, likes and dislikes, taste profiles, reports and moderation, saves, sandboxed playback |
| `infinity.js` | Infinity novels: prompts, checks on what Meta AI writes, and key handling for continuing a story |
| `public/` | The editor: `app.js` (UI), `ai.js` (every Meta AI prompt), `coder.js` (3D Novel: what Muse Wonder is told, and the `FORGE` runtime with your models, `dressBody`, the optional 2D story and music), `pack.js` (asset pack .zip), `player.js` (2D novel player, also used by exported 2D novels), `viewer3d.js` (3D viewer + GLB export), `sample.js` (starter game) |
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
