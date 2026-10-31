# Validation — 31 October 2026

Passed:
- 14 automated Node tests: Meta-only request formatting, structured output validation, story citation validation, alias matching, preservation of edited designs during re-analysis, story-specific scene requirements, expression image references, same-origin/token protection, DPAPI encryption, persisted story/assets/scenes after restart, cancelled jobs, partial failure retention and ZIP format.
- Browser: story editor and local save/reload, missing Meta key opening Settings, cast-to-design navigation, editable design prompts preserved on reload, source facts/suggested additions displayed separately, and Body settings present. Cast rendering used a clearly labelled isolated QA fixture, not an AI result. Earlier image import checks also passed. No browser console warnings/errors observed during these flows.
- Real Windows-to-WSL preflight through the local app: Python 3.12.3, SAM source found, PyTorch absent. No mounted Windows drive was needed.
- Windows launcher started the server on 127.0.0.1:8977.
- Pinned SAM 3, official SAM 3D Body and experimental SAM 3D Objects sources prepared under /home/sanskar/script-sprite-models in PCMClawUbuntu.

Not yet validated:
- Real Meta generation: API key/model access not yet configured at validation time. Provider integration tests use mocks.
- Real SAM cutout, Body reconstruction or Objects reconstruction: approved weights are not yet available, dependencies are not installed, and RTX 5070 compatibility still needs work. The Body adapter uses the official single-image estimator with optional detector/segmentor/FOV models disabled and exports a geometry-only GLB; no memory or successful-inference claim has been made for it.
- The community fork's ~12 GB peak memory claim has not been reproduced here.

The studio is prepared for configuration and manual asset work. Local model inference is not ready to claim as working. No GPU rental was started, and privacybyai.com was not deployed or changed.
