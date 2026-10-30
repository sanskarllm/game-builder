import { Bone, Dices, Download, Save, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Group, SectionHeader } from '../components/ui';
import { FitCamera, Turntable, Viewport } from '../components/Viewport';
import { downloadBlob, exportGLB } from '../lib/exporters';
import { buildFromSpec, disposeObject } from '../lib/modelSpec';
import { slugify, uid } from '../lib/random';
import { generateModel, PROMPT_EXAMPLES, type GenerationResult } from '../lib/textTo3d';
import { useStore, type Asset3D } from '../store';

export function TextTo3D() {
  const assets = useStore((s) => s.assets);
  const addAsset = useStore((s) => s.addAsset);
  const deleteAsset = useStore((s) => s.deleteAsset);
  const sendToRig = useStore((s) => s.sendToRig);

  const [prompt, setPrompt] = useState('a glowing blue crystal');
  const [seed, setSeed] = useState(0);
  const [result, setResult] = useState<GenerationResult>(() => generateModel('a glowing blue crystal'));
  const [name, setName] = useState(result.name);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);

  const model = useMemo(() => buildFromSpec(result.spec, { name: result.name }), [result]);
  useEffect(() => () => disposeObject(model), [model]);

  const run = (text: string, variation: number) => {
    const r = generateModel(text, variation);
    setResult(r);
    setName(r.name);
    setSeed(variation);
    setSavedId(null);
  };

  const save = (): Asset3D => {
    const asset: Asset3D = {
      id: savedId ?? uid('asset'),
      name: name || result.name,
      prompt,
      seed,
      spec: result.spec,
      fit: result.fit,
      createdAt: Date.now(),
    };
    addAsset(asset);
    setSavedId(asset.id);
    return asset;
  };

  const load = (a: Asset3D) => {
    setPrompt(a.prompt);
    setSeed(a.seed);
    setName(a.name);
    setSavedId(a.id);
    setResult({ ...generateModel(a.prompt, a.seed), spec: a.spec, fit: a.fit, name: a.name });
  };

  const download = async (spec: Asset3D['spec'], assetName: string) => {
    const m = buildFromSpec(spec, { merge: true, name: assetName });
    downloadBlob(await exportGLB(m), `${slugify(assetName)}.glb`);
    disposeObject(m);
  };

  return (
    <div className="section">
      <SectionHeader title="Text to 3D" subtitle="Describe a prop, creature or character and get a game-ready model you can save, rig and export." />
      <div className="workspace">
        <aside className="panel">
          <form
            className="group"
            onSubmit={(e) => {
              e.preventDefault();
              run(prompt, 0);
            }}
          >
            <label className="field">
              <span>Prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. three red mushrooms, golden sword, a knight with a sword…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    run(prompt, 0);
                  }
                }}
              />
            </label>
            <div className="row">
              <button className="btn primary" type="submit" disabled={!prompt.trim()}>
                <Wand2 size={16} /> Generate
              </button>
              <button className="btn" type="button" onClick={() => run(prompt, seed + 1)}>
                <Dices size={16} /> Variation
              </button>
            </div>
          </form>

          <Group title="Try">
            <div className="chips">
              {PROMPT_EXAMPLES.map((p) => (
                <button
                  key={p}
                  className="chip"
                  onClick={() => {
                    setPrompt(p);
                    run(p, 0);
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </Group>

          <Group title="Interpretation">
            <dl className="kv">
              {result.interpretation.map((i) => (
                <div key={i.label} style={{ display: 'contents' }}>
                  <dt>{i.label}</dt>
                  <dd>{i.value}</dd>
                </div>
              ))}
            </dl>
            <div className="note">
              <strong>Offline procedural engine.</strong> Understands ~40 objects and humanoids, colours, materials (metal, wood, glass,
              glowing…), sizes and counts. The generator lives behind <code>generateModel()</code> so an AI 3D provider can be swapped in later.
            </div>
          </Group>

          <Group title="Save to library">
            <label className="field">
              <span>Asset name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="row">
              <button className="btn primary" onClick={save}>
                <Save size={16} /> {savedId ? 'Update' : 'Save'}
              </button>
              <button className="btn" onClick={() => download(result.spec, name || result.name)}>
                <Download size={16} /> .glb
              </button>
              <button className="btn" onClick={() => sendToRig({ kind: 'asset', id: save().id })} title="Rig this model">
                <Bone size={16} /> Rig
              </button>
            </div>
          </Group>

          <Group title={`Library (${assets.length})`}>
            {assets.length === 0 && <div className="muted">Saved assets appear here and can be added to game projects.</div>}
            <div className="list">
              {assets.map((a) => (
                <div key={a.id} className={`list-item ${a.id === savedId ? 'active' : ''}`} onClick={() => load(a)}>
                  <Sparkles size={16} className="muted" />
                  <div className="grow">
                    <div className="title">{a.name}</div>
                    <div className="sub">“{a.prompt}”</div>
                  </div>
                  <button
                    className="btn icon small"
                    title="Download .glb"
                    onClick={(e) => {
                      e.stopPropagation();
                      download(a.spec, a.name);
                    }}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    className="btn icon small danger"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAsset(a.id);
                      if (a.id === savedId) setSavedId(null);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Group>
        </aside>

        <div className="viewport">
          <div className="viewport-overlay">
            <span className="tag accent">{result.name}</span>
            <button className={`btn small ${spin ? 'primary' : ''}`} onClick={() => setSpin(!spin)}>
              Turntable
            </button>
          </div>
          <Viewport camera={[3, 2.4, 4.2]} target={[0, 0.6, 0]}>
            <FitCamera object={model} />
            <Turntable enabled={spin}>
              <primitive object={model} />
            </Turntable>
          </Viewport>
        </div>
      </div>
    </div>
  );
}
