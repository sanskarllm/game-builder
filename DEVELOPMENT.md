# Development

Run `npm start` with Node 18+ and open http://localhost:5173. There is no dependency installation or build step. Run `npm test` for HTTP regression coverage.

## Architecture

- `server.js`: local static server, AI proxy and optional SAM service management.
- `public/app.js`: Preact/htm editor, project state, scene chart and authoring workflows.
- `public/ai.js`: provider configuration, prompts and structured story normalization.
- `public/player.js`: 2D playback, music synthesis and player save slots.
- `public/coder.js`: generated 3D HTML and FORGE runtime injection.
- `public/viewer3d.js`: Three.js asset preview and GLB export.
- `public/pack.js`: ZIP export.
- `sam3d-service/server.py`: optional FastAPI reconstruction service. Preserve bundled third-party licenses.

Projects autosave in localStorage; large GLB data is stored in IndexedDB. Browser-entered API keys are stored in browser settings; `.env` supports server-side credentials. Never commit credentials, model weights or Python environments.

## Validation baseline (5 November 2026)

All local JavaScript syntax checks and the Windows server regression test passed. Browser automation timed out, so interactive rendering, save/export round trips, paid AI generation and GPU reconstruction remain unverified. Provider/model availability in the existing README has not been independently verified.

The regression test covers malformed URL encoding, NUL paths, encoded directory traversal, normal assets, missing files and continued server health. Backslashes are filesystem separators on Windows only.

## Follow-up work

1. Verify editor/playback and project, HTML, ZIP and GLB round trips in a local browser.
2. Review generated-code network policy: iframe sandboxing without same-origin permission does not itself block network requests, despite the current technical prompt claiming no network.
3. Harden project imports and AI output validation, especially malformed arrays, duplicate scene IDs and broken links.
4. Verify configured provider endpoints and optional SAM services.
5. Split the large editor module once behavior is covered.

Use the GitHub plugin to publish development changes to `sanskarllm/game-builder`. Compare against current remote files before updating, preserve unrelated changes and include validation details in pull requests.
