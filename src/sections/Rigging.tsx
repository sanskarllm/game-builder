import { useFrame } from '@react-three/fiber';
import { Download, FileJson, ScanLine, Upload } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Group, SectionHeader, Segmented, Slider } from '../components/ui';
import { Viewport } from '../components/Viewport';
import { applyPose, autoRig, detectFit, type TestPose } from '../lib/autoRig';
import { downloadBlob, downloadJSON, exportGLB, loadModelFile } from '../lib/exporters';
import { buildHumanoid } from '../lib/humanoid';
import { buildFromSpec } from '../lib/modelSpec';
import { slugify } from '../lib/random';
import { BONE_NAMES, boneMap, FIT_FIELDS, JOINTS, TARGET_INFO, type JointId, type RigFit, type RigTarget } from '../lib/skeletons';
import { useStore } from '../store';

interface Source {
  key: string;
  name: string;
  object: THREE.Object3D;
  fit: RigFit;
  origin: THREE.Vector3;
  /** Landmarks came from the generator rather than being guessed. */
  exact: boolean;
}

function PoseDriver(props: { bones: Partial<Record<JointId, THREE.Bone>>; pose: TestPose }) {
  useFrame(({ clock }) => applyPose(props.bones, props.pose, clock.elapsedTime));
  return null;
}

const JOINT_LABEL = (id: JointId) =>
  id
    .replace('.L', ' (L)')
    .replace('.R', ' (R)')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase());

export function Rigging() {
  const characters = useStore((s) => s.characters);
  const assets = useStore((s) => s.assets);
  const rigSource = useStore((s) => s.rigSource);

  const [upload, setUpload] = useState<{ name: string; object: THREE.Object3D } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(() =>
    rigSource ? `${rigSource.kind}:${rigSource.id}` : characters[0] ? `character:${characters[0].id}` : assets[0] ? `asset:${assets[0].id}` : '',
  );
  const [target, setTarget] = useState<RigTarget>('unity');
  const [pose, setPose] = useState<TestPose>('walk');
  const [xray, setXray] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (rigSource) setSelected(`${rigSource.kind}:${rigSource.id}`);
  }, [rigSource]);

  const source = useMemo<Source | null>(() => {
    const [kind, id] = selected.split(':');
    if (kind === 'character') {
      const c = characters.find((x) => x.id === id);
      if (!c) return null;
      const { spec, fit } = buildHumanoid(c);
      return { key: selected, name: c.name, object: buildFromSpec(spec, { merge: true, name: c.name }), fit, origin: new THREE.Vector3(), exact: true };
    }
    if (kind === 'asset') {
      const a = assets.find((x) => x.id === id);
      if (!a) return null;
      const object = buildFromSpec(a.spec, { merge: true, name: a.name });
      if (a.fit) return { key: selected, name: a.name, object, fit: a.fit, origin: new THREE.Vector3(), exact: true };
      return { key: selected, name: a.name, object, ...detectFit(object), exact: false };
    }
    if (kind === 'upload' && upload) return { key: selected, name: upload.name, object: upload.object, ...detectFit(upload.object), exact: false };
    return null;
  }, [selected, characters, assets, upload]);

  const [fit, setFit] = useState<RigFit | null>(source?.fit ?? null);
  useEffect(() => setFit(source?.fit ?? null), [source]);
  const deferredFit = useDeferredValue(fit);

  const rig = useMemo(() => (source && deferredFit ? autoRig(source.object, deferredFit, target, source.origin) : null), [source, deferredFit, target]);
  useEffect(() => () => rig?.meshes.forEach((m) => m.geometry.dispose()), [rig]);

  const helper = useMemo(() => {
    if (!rig) return null;
    const h = new THREE.SkeletonHelper(rig.armature);
    const mat = h.material as THREE.LineBasicMaterial;
    mat.depthTest = false;
    mat.transparent = true;
    h.renderOrder = 10;
    return h;
  }, [rig]);

  useEffect(() => {
    rig?.meshes.forEach((m) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mt) => ((mt as THREE.MeshStandardMaterial).wireframe = xray));
    });
  }, [rig, xray]);

  const onUpload = async (file: File) => {
    setUploadError(null);
    try {
      const object = await loadModelFile(file);
      setUpload({ name: file.name.replace(/\.[^.]+$/, ''), object });
      setSelected(`upload:${Date.now()}`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportRig = async () => {
    if (!rig || !source) return;
    setPose('bind');
    applyPose(rig.bones, 'bind');
    rig.armature.name = source.name;
    downloadBlob(await exportGLB(rig.armature), `${slugify(source.name)}_${target}.glb`);
  };

  const h = source?.fit.headTopY ?? 1.8;
  const info = TARGET_INFO[target];

  return (
    <div className="section">
      <SectionHeader
        title="Rigging"
        subtitle="Generate a humanoid skeleton named for Unity Mecanim, the Unreal mannequin or Mixamo, skin the mesh and export."
        actions={
          <>
            <button className="btn" disabled={!rig} onClick={() => downloadJSON(boneMap(target), `bone-map_${target}.json`)}>
              <FileJson size={16} /> Bone map
            </button>
            <button className="btn primary" disabled={!rig} onClick={exportRig}>
              <Download size={16} /> Export rigged .glb
            </button>
          </>
        }
      />
      <div className="workspace">
        <aside className="panel">
          <Group title="Source model">
            <select value={selected.startsWith('upload') ? 'upload' : selected} onChange={(e) => setSelected(e.target.value === 'upload' ? `upload:${Date.now()}` : e.target.value)}>
              <option value="" disabled>
                Choose a model…
              </option>
              {characters.length > 0 && (
                <optgroup label="Characters">
                  {characters.map((c) => (
                    <option key={c.id} value={`character:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {assets.length > 0 && (
                <optgroup label="Text-to-3D assets">
                  {assets.map((a) => (
                    <option key={a.id} value={`asset:${a.id}`}>
                      {a.name}
                      {a.fit ? ' (humanoid)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {upload && <option value="upload">Uploaded: {upload.name}</option>}
            </select>
            <input ref={fileRef} type="file" accept=".glb,.gltf,.obj,.fbx" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
            <button className="btn block" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Upload .glb / .gltf / .obj / .fbx
            </button>
            {uploadError && <div className="error">{uploadError}</div>}
            <div className="note">
              Models should stand upright (+Y), face the camera (+Z) and ideally be in a T- or A-pose. Generated characters provide exact joint
              positions; other models are fitted automatically and can be tuned below.
            </div>
          </Group>

          <Group title="Target skeleton">
            <Segmented<RigTarget>
              value={target}
              onChange={setTarget}
              options={[
                { value: 'unity', label: 'Unity' },
                { value: 'unreal', label: 'Unreal' },
                { value: 'mixamo', label: 'Mixamo' },
              ]}
            />
            <ol className="steps">
              {info.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Group>

          {fit && source && (
            <Group
              title="Fit skeleton"
              action={
                <button
                  className="btn small"
                  onClick={() => setFit(source.exact ? source.fit : detectFit(source.object).fit)}
                  title={source.exact ? 'Reset to generator landmarks' : 'Re-run auto detection'}
                >
                  <ScanLine size={13} /> {source.exact ? 'Reset' : 'Auto-fit'}
                </button>
              }
            >
              {FIT_FIELDS.map((f) => (
                <Slider
                  key={f.key}
                  label={f.label}
                  value={fit[f.key]}
                  min={0}
                  max={f.kind === 'angle' ? 80 : f.kind === 'width' ? h * 0.8 : h * 1.1}
                  step={f.kind === 'angle' ? 1 : h / 400}
                  format={(v) => (f.kind === 'angle' ? `${v.toFixed(0)}°` : `${((v / h) * 100).toFixed(1)}%`)}
                  onChange={(v) => setFit({ ...fit, [f.key]: v })}
                />
              ))}
            </Group>
          )}

          {rig && (
            <Group title={`Bones (${rig.skeleton.bones.length})`}>
              <table className="bone-table">
                <tbody>
                  {JOINTS.filter((j) => BONE_NAMES[target][j.id]).map((j) => (
                    <tr key={j.id}>
                      <td>{JOINT_LABEL(j.id)}</td>
                      <td>{BONE_NAMES[target][j.id]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Group>
          )}
        </aside>

        <div className="viewport">
          {source && rig && helper ? (
            <>
              <div className="viewport-overlay">
                <div className="row">
                  <span className="tag accent">{info.short}</span>
                  <span className="tag">
                    {rig.skeleton.bones.length} bones · {rig.vertexCount.toLocaleString()} verts
                  </span>
                </div>
                <div className="row">
                  <Segmented<TestPose>
                    value={pose}
                    onChange={setPose}
                    options={[
                      { value: 'bind', label: 'Bind' },
                      { value: 'armsDown', label: 'Arms down' },
                      { value: 'walk', label: 'Walk' },
                      { value: 'wave', label: 'Wave' },
                    ]}
                  />
                  <button className={`btn small ${xray ? 'primary' : ''}`} onClick={() => setXray(!xray)}>
                    X-ray
                  </button>
                </div>
              </div>
              <Viewport key={source.key} camera={[source.origin.x + h * 1.1, source.origin.y + h * 0.9, source.origin.z + h * 1.9]} target={[source.origin.x, source.origin.y + h * 0.5, source.origin.z]}>
                <primitive object={rig.armature} />
                <primitive object={helper} />
                <PoseDriver bones={rig.bones} pose={pose} />
              </Viewport>
            </>
          ) : (
            <div className="empty" style={{ margin: 24 }}>
              <b>No model selected</b>
              <span>Save a character, save a text-to-3D asset, or upload a model to rig it.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
