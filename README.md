# Script&Sprite Story Studio

A separate studio that starts with a story or chapter, discovers its cast and locations, and turns them into consistent visual designs. It uses Meta Model API for Muse Spark and Muse Image, with local workers for SAM 3, SAM 3D Body and SAM 3D Objects. It does not change or deploy privacybyai.com.

## Start

Double-click **Start-Studio.cmd**, then open http://127.0.0.1:8977. Node.js 22 or newer is required (24.16.0 was used here). No npm installation is needed. **Stop-Studio.cmd** stops the launcher-owned server. Finish or cancel active jobs before stopping. Closing the browser alone leaves the server running.

Alternatively, open a terminal in this folder and run `node server.mjs`. Ctrl+C stops that terminal-owned server.

## Use

1. Open Settings and enter your **Meta Model API key**. The default model names are `muse-spark-1.3` and `muse-image-1.0`; your account must have access. Optional remembered credentials use Windows DPAPI encryption for your Windows user.
2. In **Story & cast**, paste the actual story or import a UTF-8 `.txt` / `.md` chapter (up to 80,000 characters). Pick the art direction, add optional design notes and save locally.
3. Select **Discover characters & scenes**. Muse Spark extracts the cast, aliases, locations and ordered scene notes. Character profiles distinguish story facts from proposed visual additions. Short source quotations are checked against your text. Review the breakdown before creating artwork.
4. Open a character's design, edit its image prompt if needed, and generate the base image with Muse Image. Generate up to eight selected designs at a time. Each completed image is saved immediately.
5. Use **Create expression** on a generated character to add a separate emotion/pose design. Its generation includes the original image as a reference. Refinement edits the current design and retains its previous source in local history.
6. For local cutouts, use an installed SAM 3 environment and approved weights. For a **single human character**, SAM 3D Body can export a plain body-shape GLB without loading optional detector/FOV models. For general objects, use the separate SAM 3D Objects route. Both 3D adapters need real model validation on this PC.
7. Choose a scene in the story breakdown to compose only its illustrated cast and location. Drag the foreground layers to adjust the layout. Export a scene PNG or a project ZIP containing the original story, cast/scene breakdown, images and optional 3D files.

Re-analysis matches canonical names and aliases and preserves existing images, manual prompts and design profiles. A changed story marks its old breakdown as stale until re-analysed. Existing designs are not automatically deleted when a character disappears from a chapter. A previous design kept during re-analysis should be reviewed against the new story facts.

The scene board is a composition tool; this version does not export a playable branching visual novel. SAM 3D Body exports body geometry, not clothing, hair, textures or a game-ready rig. Meshes can need cleanup, UV/material work, retopology and rigging.

## Prepared low-memory route

This PC was detected as RTX 5070 with 12 GB VRAM and approximately 32 GB system RAM. The app defaults to the **experimental stage-offloading profile**, processes jobs serially, and starts a fresh Python worker per local job so its GPU allocation is released when it exits. Compilation is disabled. The selected inputs pass into WSL through a pipe; no Windows-drive mount is required.

The community fork reports around 12 GB peak GPU memory. That claim has **not been verified on this PC**, and it leaves little margin for the display and other programs. Its old CUDA 12.1 / Torch 2.5 dependencies need compatibility work for the RTX 50 series. A smaller input alone does not solve model-weight memory or unsupported CUDA kernels.

See **public/setup.md** for exact source revisions, model access, setup state and the remaining validation steps. The preparation script downloads source only. It does not install the old dependency stack, download gated weights, call Meta, or start a rented GPU.

## Data and network behavior

- Projects, prompts, jobs, images and layouts persist in `data/`. Back up this whole folder while the studio is stopped.
- The server listens only on `127.0.0.1`. Local mutations require a per-session token and same-origin requests. Do not expose this development server to the internet.
- The only AI API host in the application is `api.meta.ai`. There is no MCP endpoint and no OpenAI client or fallback. The UI has no third-party CDN, analytics or remote font calls.
- Story analysis sends the saved story, design notes and existing cast names to Meta. Generation sends prompts, style guidance and optionally the selected reference image. Composition sends the selected scene summary and relevant asset descriptions/IDs for a structured layout.
- Local SAM workers use offline model loading. They need already-downloaded checkpoints and their dependencies. Setup downloads from GitHub/package registries/Hugging Face are separate from model inference.
- API keys are not returned by the state endpoint or included in exports. Session-only keys disappear on restart. Encrypted saved keys require the same Windows account.
- Cancelling an API request stops waiting locally; Meta may already have processed and charged for it. There are no automatic paid retries.

## Validation and limits

`npm test` runs 14 tests covering persistence across restart, partial failures, cancellation, Meta request formats, story citations, alias matching, unchanged artwork on re-analysis, scene asset requirements, expression references, local request protection, key encryption and ZIP export. These tests use mock provider responses, not paid generation.

Real Meta image generation and local SAM model inference still require your credentials/model access and have not been claimed as tested. A preflight result is not proof of successful model inference.

Source code is in `server.mjs`, `lib/`, `public/`, `workers/` and `scripts/`. `runtime/` is disposable downloaded source, not personal project data. The distributable ZIP excludes all credentials, user data and model downloads.
