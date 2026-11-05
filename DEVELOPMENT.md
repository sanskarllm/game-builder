# Game Forge development baseline

Reviewed 5 November 2026. Source: C:\Users\aires\OneDrive\Desktop\new site\game-forge

## Run and verify

- Node 18+; Node 24.16.0 was available during review.
- Run `npm start`, then open http://localhost:5173.
- Run `npm test` for the HTTP regression test. No npm dependencies or build step.
- Browser libraries, fonts and icons load from external CDNs, so the editor is not fully offline.

## Architecture

- server.js: static server bound to 127.0.0.1 by default; proxies chat, image and model-list calls; manages/proxies optional SAM Python services.
- public/app.js: Preact/htm editor, scene chart, asset management, undo, project save/open and generation workflows. This is the largest module, about 109 KB.
- public/ai.js: provider settings, AI prompts, structured story normalization and assistant edits.
- public/player.js: shared 2D visual novel player, synthesized audio and browser save slots.
- public/coder.js: generated 3D HTML, prompts and injected FORGE model/story/music runtime.
- public/viewer3d.js: Three.js preview and GLB export.
- public/pack.js: ZIP asset pack export.
- sam3d-service/server.py: optional FastAPI image-to-mesh service; bundled Meta Body implementation is third-party code.

## Data and boundaries

Projects autosave under gf.project in localStorage. Large GLB payloads live in IndexedDB; project exports include meshes. Settings, including a key entered in the editor, live in browser storage. A server-side .env key is an alternative. No .env file was present in the reviewed root; the started server reported no configured server key. Browser-stored credentials were not inspected.

Generated 3D HTML runs in an iframe with allow-scripts and allow-pointer-lock, without same-origin permission. This does not itself block network requests: coder.js currently tells the model there is no network, but no network-blocking CSP was found. Review this mismatch before treating generated code as network-isolated.

## Completed maintenance

- Static serving now returns 400 for malformed percent encoding and NUL paths instead of allowing URL parsing errors to escape.
- Replaced the string-prefix directory check with a path-relative boundary check, rejecting traversal into sibling directories whose names begin with public.
- Added test/server.test.cjs and npm test. The integration test starts an isolated server and checks malformed URLs, encoded traversal, ordinary assets, missing files and status after invalid requests.

## Verification and limits

- All eight public JavaScript files and server.js passed node --check.
- npm test passed on Windows, including traversal with encoded forward and backward separators.
- The server started successfully. The test's HTTP requests passed.
- The browser tool timed out on both 127.0.0.1:5173 and localhost:5173; visual rendering and interactive flows remain unverified.
- No paid AI requests, GPU setup or large model downloads were performed. Provider/model availability described in README remains unverified.
- This folder has no Git repository. No commit or deployment was made. The review server was stopped.

## Next development work

1. Establish Git version history and a baseline snapshot before broader changes.
2. Check 2D editor/playback, project save/open, GLB persistence and HTML/ZIP export round trips in a local browser.
3. Review generated-code network access and document/enforce the intended policy.
4. Harden imported/AI project validation and test malformed arrays, duplicate IDs and broken links.
5. Verify provider endpoints/models with the configured account, then smoke-test generation and optional SAM health/reconstruction.
6. Split app.js by feature after behavior is covered; preserve the current no-build workflow unless requirements change.
