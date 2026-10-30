import { Bone, FolderPlus, Loader2, PackageOpen, PersonStanding, ScrollText, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Group, SectionHeader } from '../components/ui';
import { downloadBlob } from '../lib/exporters';
import { exportProjectBundle, ENGINE_RIG } from '../lib/projectExport';
import { slugify, uid } from '../lib/random';
import { TARGET_INFO } from '../lib/skeletons';
import { useStore, type Engine, type GameProject, type SectionId } from '../store';

const GENRES = ['Action', 'Adventure', 'RPG', 'Platformer', 'Shooter', 'Puzzle', 'Horror', 'Visual Novel', 'Strategy', 'Simulation'];
const PERSPECTIVES = ['3D third-person', '3D first-person', 'Top-down', '2D side-scroller', 'Isometric'];
const ENGINES: { value: Engine; label: string }[] = [
  { value: 'unity', label: 'Unity' },
  { value: 'unreal', label: 'Unreal Engine' },
  { value: 'godot', label: 'Godot' },
];

function newProject(): GameProject {
  return {
    id: uid('proj'),
    name: 'My New Game',
    genre: 'Adventure',
    perspective: '3D third-person',
    engine: 'unity',
    description: '',
    characterIds: [],
    assetIds: [],
    storyId: null,
    createdAt: Date.now(),
  };
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function CreateGame() {
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeProjectId);
  const characters = useStore((s) => s.characters);
  const assets = useStore((s) => s.assets);
  const stories = useStore((s) => s.stories);
  const { addProject, updateProject, deleteProject, setActiveProject, setSection } = useStore.getState();

  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === activeId) ?? null;
  const update = (patch: Partial<GameProject>) => project && updateProject(project.id, patch);

  const pipeline: { section: SectionId; title: string; text: string; icon: typeof Bone; cta: string }[] = [
    { section: 'characters', title: 'Characters', text: 'Shape heroes, NPCs and villains with proportion presets, outfits and colours.', icon: PersonStanding, cta: 'Design a character' },
    { section: 'text3d', title: 'Text to 3D', text: 'Type “golden sword” or “three pine trees” and get props for your levels.', icon: Sparkles, cta: 'Generate props' },
    { section: 'rigging', title: 'Rigging', text: `Auto-rig characters with ${project ? TARGET_INFO[ENGINE_RIG[project.engine]].short : 'Unity / Unreal'} bone names so engine animations just work.`, icon: Bone, cta: 'Rig a model' },
    { section: 'script', title: 'Script → Game', text: 'Turn a screenplay or story into levels, objectives, NPC dialogue and a playable prototype.', icon: ScrollText, cta: 'Read a script' },
  ];

  const doExport = async () => {
    if (!project) return;
    setExporting(true);
    setError(null);
    try {
      const blob = await exportProjectBundle(
        project,
        characters.filter((c) => project.characterIds.includes(c.id)),
        assets.filter((a) => project.assetIds.includes(a.id)),
        stories.find((s) => s.id === project.storyId) ?? null,
      );
      downloadBlob(blob, `${slugify(project.name)}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="section">
      <SectionHeader
        title="Create Game"
        subtitle="Set up a game project, collect the assets you build, and export an engine-ready bundle."
        actions={
          <button className="btn primary" onClick={() => addProject(newProject())}>
            <FolderPlus size={16} /> New project
          </button>
        }
      />
      <div className="workspace">
        <aside className="panel">
          <Group title={`Projects (${projects.length})`}>
            {projects.length === 0 && <div className="muted">No projects yet.</div>}
            <div className="list">
              {projects.map((p) => (
                <div key={p.id} className={`list-item ${p.id === activeId ? 'active' : ''}`} onClick={() => setActiveProject(p.id)}>
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="sub">
                      {p.genre} · {ENGINES.find((e) => e.value === p.engine)?.label}
                    </div>
                  </div>
                  <button
                    className="btn icon small danger"
                    title="Delete project"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete project “${p.name}”? Assets stay in your library.`)) deleteProject(p.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Group>

          {project && (
            <>
              <Group title="Project">
                <label className="field">
                  <span>Name</span>
                  <input type="text" value={project.name} onChange={(e) => update({ name: e.target.value })} />
                </label>
                <label className="field">
                  <span>Genre</span>
                  <select value={project.genre} onChange={(e) => update({ genre: e.target.value })}>
                    {GENRES.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Perspective</span>
                  <select value={project.perspective} onChange={(e) => update({ perspective: e.target.value })}>
                    {PERSPECTIVES.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Target engine</span>
                  <select value={project.engine} onChange={(e) => update({ engine: e.target.value as Engine })}>
                    {ENGINES.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Pitch</span>
                  <textarea value={project.description} placeholder="One or two sentences about the game…" onChange={(e) => update({ description: e.target.value })} />
                </label>
              </Group>
            </>
          )}
        </aside>

        <div className="content">
          {!project ? (
            <div className="empty">
              <FolderPlus size={28} />
              <b>Start your first game</b>
              <span>Create a project, then build characters, props and levels with the tools on the left.</span>
              <button className="btn primary" onClick={() => addProject(newProject())}>
                Create project
              </button>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="row spread">
                  <div>
                    <h3 style={{ fontSize: 20, marginBottom: 4 }}>{project.name}</h3>
                    <p>
                      {project.genre} · {project.perspective} · {ENGINES.find((e) => e.value === project.engine)?.label}
                    </p>
                  </div>
                  <div className="row" style={{ gap: 28 }}>
                    <div className="stat">
                      <b>{project.characterIds.length}</b>
                      <span>characters</span>
                    </div>
                    <div className="stat">
                      <b>{project.assetIds.length}</b>
                      <span>assets</span>
                    </div>
                    <div className="stat">
                      <b>{stories.find((s) => s.id === project.storyId)?.levels.length ?? 0}</b>
                      <span>levels</span>
                    </div>
                  </div>
                </div>
                {project.description && <p style={{ marginTop: 10 }}>{project.description}</p>}
              </div>

              <div className="grid-cards">
                {pipeline.map(({ section, title, text, icon: Icon, cta }) => (
                  <div key={section} className="card pipeline-card">
                    <div className="icon-badge">
                      <Icon size={18} />
                    </div>
                    <h3 style={{ margin: 0 }}>{title}</h3>
                    <p>{text}</p>
                    <button className="btn small" onClick={() => setSection(section)}>
                      {cta} →
                    </button>
                  </div>
                ))}
              </div>

              <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                <div className="card group">
                  <h3>Characters in this game</h3>
                  {characters.length === 0 && <p>Build characters in the Characters section.</p>}
                  {characters.map((c) => (
                    <label key={c.id} className="check">
                      <input type="checkbox" checked={project.characterIds.includes(c.id)} onChange={() => update({ characterIds: toggle(project.characterIds, c.id) })} />
                      <span className="swatch" style={{ background: c.shirt }} />
                      {c.name}
                    </label>
                  ))}
                </div>
                <div className="card group">
                  <h3>3D assets in this game</h3>
                  {assets.length === 0 && <p>Generate props in the Text to 3D section.</p>}
                  {assets.map((a) => (
                    <label key={a.id} className="check">
                      <input type="checkbox" checked={project.assetIds.includes(a.id)} onChange={() => update({ assetIds: toggle(project.assetIds, a.id) })} />
                      {a.name}
                    </label>
                  ))}
                </div>
                <div className="card group">
                  <h3>Story</h3>
                  {stories.length === 0 ? (
                    <p>Turn a script into levels in the Script → Game section.</p>
                  ) : (
                    <select value={project.storyId ?? ''} onChange={(e) => update({ storyId: e.target.value || null })}>
                      <option value="">No story</option>
                      {stories.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} ({s.levels.length} levels)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="row spread">
                  <div>
                    <h3>Export to {ENGINES.find((e) => e.value === project.engine)?.label}</h3>
                    <p>
                      A .zip with rigged character .glb files ({TARGET_INFO[ENGINE_RIG[project.engine]].label} bones), prop .glb files, the
                      story blueprint and a project manifest with import notes.
                    </p>
                  </div>
                  <button className="btn primary" onClick={doExport} disabled={exporting}>
                    {exporting ? <Loader2 size={16} className="spin" /> : <PackageOpen size={16} />} Export bundle
                  </button>
                </div>
                {error && <div className="error">{error}</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
