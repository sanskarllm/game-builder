import { Bone, Copy, Download, Plus, RotateCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ColorField, Group, SectionHeader, Segmented, Slider } from '../components/ui';
import { Turntable, Viewport } from '../components/Viewport';
import { downloadBlob, exportGLB } from '../lib/exporters';
import { buildHumanoid, CHARACTER_PRESETS, defaultCharacter, type CharacterParams, type HairStyle, type Outfit } from '../lib/humanoid';
import { buildFromSpec, disposeObject } from '../lib/modelSpec';
import { slugify, uid } from '../lib/random';
import { useStore } from '../store';

export function Characters() {
  const characters = useStore((s) => s.characters);
  const saveCharacter = useStore((s) => s.saveCharacter);
  const deleteCharacter = useStore((s) => s.deleteCharacter);
  const sendToRig = useStore((s) => s.sendToRig);

  const [draft, setDraft] = useState<CharacterParams>(() => characters[0] ?? defaultCharacter());
  const [spin, setSpin] = useState(false);
  const set = (patch: Partial<CharacterParams>) => setDraft((d) => ({ ...d, ...patch }));

  const model = useMemo(() => buildFromSpec(buildHumanoid(draft).spec, { name: draft.name }), [draft]);
  useEffect(() => () => disposeObject(model), [model]);

  const saved = characters.find((c) => c.id === draft.id);
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(draft);

  const save = () => {
    const c = draft.id ? draft : { ...draft, id: uid('char'), createdAt: Date.now() };
    saveCharacter(c);
    setDraft(c);
    return c;
  };

  const exportStatic = async () => {
    const m = buildFromSpec(buildHumanoid(draft).spec, { merge: true, name: draft.name });
    downloadBlob(await exportGLB(m), `${slugify(draft.name)}.glb`);
    disposeObject(m);
  };

  return (
    <div className="section">
      <SectionHeader
        title="Characters"
        subtitle="Design T-posed humanoids with clean proportions — ready for the rigging step."
        actions={
          <>
            <button className="btn" onClick={() => setDraft(defaultCharacter())}>
              <Plus size={16} /> New
            </button>
            <button className="btn primary" onClick={save} disabled={!dirty}>
              <Save size={16} /> {dirty ? 'Save character' : 'Saved'}
            </button>
          </>
        }
      />
      <div className="workspace">
        <aside className="panel">
          <label className="field">
            <span>Name</span>
            <input type="text" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </label>

          <Group title="Proportion preset">
            <div className="chips">
              {Object.entries(CHARACTER_PRESETS).map(([name, preset]) => (
                <button key={name} className="chip" onClick={() => set(preset)}>
                  {name}
                </button>
              ))}
            </div>
          </Group>

          <Group title="Body">
            <Slider label="Height" value={draft.height} min={1} max={2.4} onChange={(height) => set({ height })} format={(v) => `${v.toFixed(2)} m`} />
            <Slider label="Build" value={draft.build} min={0.7} max={1.5} onChange={(build) => set({ build })} />
            <Slider label="Head size" value={draft.headScale} min={0.7} max={2} onChange={(headScale) => set({ headScale })} />
            <Slider label="Leg length" value={draft.legLength} min={0.7} max={1.2} onChange={(legLength) => set({ legLength })} />
            <Slider label="Arm length" value={draft.armLength} min={0.75} max={1.2} onChange={(armLength) => set({ armLength })} />
          </Group>

          <Group title="Style">
            <label className="field">
              <span>Outfit</span>
              <Segmented<Outfit>
                value={draft.outfit}
                onChange={(outfit) => set({ outfit })}
                options={[
                  { value: 'casual', label: 'Casual' },
                  { value: 'armor', label: 'Armor' },
                  { value: 'robe', label: 'Robe' },
                ]}
              />
            </label>
            <label className="field">
              <span>Hair</span>
              <Segmented<HairStyle>
                value={draft.hairStyle}
                onChange={(hairStyle) => set({ hairStyle })}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'short', label: 'Short' },
                  { value: 'long', label: 'Long' },
                  { value: 'mohawk', label: 'Mohawk' },
                ]}
              />
            </label>
            <div className="colors">
              <ColorField label="Skin" value={draft.skin} onChange={(skin) => set({ skin })} />
              <ColorField label="Hair" value={draft.hair} onChange={(hair) => set({ hair })} />
              <ColorField label="Top" value={draft.shirt} onChange={(shirt) => set({ shirt })} />
              <ColorField label="Pants" value={draft.pants} onChange={(pants) => set({ pants })} />
              <ColorField label="Shoes" value={draft.shoes} onChange={(shoes) => set({ shoes })} />
            </div>
          </Group>

          <Group title="Use it">
            <button className="btn primary block" onClick={() => sendToRig({ kind: 'character', id: save().id })}>
              <Bone size={16} /> Save & rig for Unity / Unreal
            </button>
            <div className="row">
              <button className="btn" onClick={exportStatic}>
                <Download size={16} /> Static .glb
              </button>
              <button className="btn" onClick={() => setDraft({ ...draft, id: '', name: `${draft.name} copy` })}>
                <Copy size={16} /> Duplicate
              </button>
            </div>
          </Group>

          <Group title={`Saved characters (${characters.length})`}>
            {characters.length === 0 && <div className="muted">Nothing saved yet.</div>}
            <div className="list">
              {characters.map((c) => (
                <div key={c.id} className={`list-item ${c.id === draft.id ? 'active' : ''}`} onClick={() => setDraft(c)}>
                  <span className="swatch" style={{ background: c.shirt }} />
                  <div className="grow">
                    <div className="title">{c.name}</div>
                    <div className="sub">
                      {c.height.toFixed(2)} m · {c.outfit}
                    </div>
                  </div>
                  <button
                    className="btn icon small danger"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCharacter(c.id);
                      if (c.id === draft.id) setDraft(defaultCharacter());
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
            <span className="tag accent">T-pose · {draft.height.toFixed(2)} m</span>
            <button className={`btn small ${spin ? 'primary' : ''}`} onClick={() => setSpin(!spin)}>
              <RotateCw size={14} /> Turntable
            </button>
          </div>
          <Viewport camera={[0, draft.height * 0.6, draft.height * 2.1]} target={[0, draft.height * 0.5, 0]}>
            <Turntable enabled={spin}>
              <primitive object={model} />
            </Turntable>
          </Viewport>
        </div>
      </div>
    </div>
  );
}
