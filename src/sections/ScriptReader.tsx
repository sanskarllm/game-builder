import { Clapperboard, Download, Play, Save, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { StoryPlayer } from '../components/StoryPlayer';
import { Group, SectionHeader } from '../components/ui';
import { downloadJSON } from '../lib/exporters';
import { SAMPLE_SCREENPLAY, SAMPLE_STORY, storyToGame, type Environment, type StoryBlueprint } from '../lib/gameBlueprint';
import { slugify } from '../lib/random';
import { useStore } from '../store';

const ENV_COLOR: Record<Environment, string> = {
  forest: '#3f7a43', castle: '#7a7a88', village: '#b5533c', city: '#5a6170', cave: '#5a4d44', dungeon: '#4f4c58',
  desert: '#c8a86a', snow: '#dfe8ef', sea: '#2f6fb0', space: '#56ccf2', interior: '#9a7452', field: '#8fbf5f',
};

const OBJECTIVE_ICON: Record<string, string> = { defeat: '⚔', collect: '◆', talk: '💬', explore: '🧭' };

function BlueprintView({ bp }: { bp: StoryBlueprint }) {
  const byId = new Map(bp.characters.map((c) => [c.id, c]));
  return (
    <>
      <div className="card">
        <div className="row spread">
          <h3 style={{ margin: 0 }}>{bp.title}</h3>
          <div className="row">
            <span className="tag accent">{bp.genre}</span>
            <span className="tag">{bp.format}</span>
            <span className="tag">{bp.levels.length} levels</span>
          </div>
        </div>
        {bp.logline && <p style={{ marginTop: 8 }}>{bp.logline}</p>}
        <div className="row" style={{ marginTop: 10 }}>
          {bp.mechanics.map((m) => (
            <span key={m} className="tag">
              {m}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Cast</h3>
        {bp.characters.length === 0 && <p>No named characters found — the player will be a generic hero.</p>}
        <div className="grid-cards">
          {bp.characters.map((c) => (
            <div key={c.id} className="list-item" style={{ cursor: 'default' }}>
              <span className="swatch" style={{ background: c.color }} />
              <div className="grow">
                <div className="title">{c.name}</div>
                <div className="sub">
                  {c.lines} lines · {c.mentions} mentions
                </div>
              </div>
              <span className={`tag ${c.role}`}>{c.role}</span>
            </div>
          ))}
        </div>
      </div>

      {bp.levels.map((l) => (
        <div key={l.id} className="card level-card">
          <div className="env-strip" style={{ background: ENV_COLOR[l.environment] }} />
          <header>
            <span className="level-num">{l.index + 1}</span>
            <div className="grow" style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}>{l.name}</h3>
              <div className="muted" style={{ fontSize: 12 }}>
                {l.environment} · {l.time}
              </div>
            </div>
            <span className="tag accent">
              {OBJECTIVE_ICON[l.objective.type]} {l.objective.description}
            </span>
          </header>
          {l.narration.length > 0 && <p>{l.narration.join(' ')}</p>}
          <div className="row">
            {l.npcs.map((id) => (
              <span key={id} className="tag ally">
                NPC: {byId.get(id)?.name}
              </span>
            ))}
            {l.enemies.map((e) => (
              <span key={e.name} className="tag enemy">
                {e.count > 1 ? `${e.count}× ` : ''}
                {e.name}
              </span>
            ))}
            {l.items.map((i) => (
              <span key={i} className="tag">
                ◆ {i}
              </span>
            ))}
            {l.mechanics.map((m) => (
              <span key={m} className="tag">
                {m}
              </span>
            ))}
          </div>
          {l.dialogue.length > 0 && (
            <div>
              {l.dialogue.slice(0, 4).map((d, i) => (
                <div key={i} className="dialogue-line">
                  <b>{d.speaker}:</b> {d.text}
                </div>
              ))}
              {l.dialogue.length > 4 && <div className="dialogue-line">…{l.dialogue.length - 4} more lines</div>}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function ScriptReader() {
  const stories = useStore((s) => s.stories);
  const addStory = useStore((s) => s.addStory);
  const deleteStory = useStore((s) => s.deleteStory);

  const [text, setText] = useState(SAMPLE_STORY);
  const [bp, setBp] = useState<StoryBlueprint | null>(null);
  const [tab, setTab] = useState<'blueprint' | 'play'>('blueprint');
  const savedIds = new Set(stories.map((s) => s.id));

  const convert = () => {
    setBp(storyToGame(text));
    setTab('blueprint');
  };

  return (
    <div className="section">
      <SectionHeader
        title="Script → Game"
        subtitle="Paste a screenplay or a story. Scenes become levels, characters become the player, NPCs and bosses, and the plot becomes objectives."
        actions={
          bp && (
            <>
              <button className="btn" onClick={() => downloadJSON(bp, `${slugify(bp.title)}_blueprint.json`)}>
                <Download size={16} /> Blueprint JSON
              </button>
              <button className="btn primary" onClick={() => addStory(bp)} disabled={savedIds.has(bp.id)}>
                <Save size={16} /> {savedIds.has(bp.id) ? 'Saved' : 'Save story'}
              </button>
            </>
          )
        }
      />
      <div className="workspace wide-panel">
        <aside className="panel">
          <Group
            title="Script or story"
            action={
              <div className="row">
                <button className="btn small" onClick={() => setText(SAMPLE_STORY)}>
                  Story sample
                </button>
                <button className="btn small" onClick={() => setText(SAMPLE_SCREENPLAY)}>
                  Screenplay sample
                </button>
              </div>
            }
          >
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 340, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
            <button className="btn primary block" onClick={convert} disabled={!text.trim()}>
              <Wand2 size={16} /> Turn into a game
            </button>
            <div className="note">
              Screenplays: scene headings (<code>INT.</code>/<code>EXT.</code>) become levels and <code>CHARACTER</code> cues become speakers.
              Prose: chapters and location changes split levels, quoted lines become dialogue. Fights become combat, searches become item
              hunts, conversations become talk objectives.
            </div>
          </Group>

          <Group title={`Saved stories (${stories.length})`}>
            {stories.length === 0 && <div className="muted">Saved blueprints can be attached to a game project.</div>}
            <div className="list">
              {stories.map((s) => (
                <div key={s.id} className={`list-item ${bp?.id === s.id ? 'active' : ''}`} onClick={() => setBp(s)}>
                  <Clapperboard size={16} className="muted" />
                  <div className="grow">
                    <div className="title">{s.title}</div>
                    <div className="sub">
                      {s.genre} · {s.levels.length} levels
                    </div>
                  </div>
                  <button
                    className="btn icon small danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteStory(s.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Group>
        </aside>

        <div className="content">
          {bp ? (
            <>
              <div className="tabs">
                <button className={tab === 'blueprint' ? 'active' : ''} onClick={() => setTab('blueprint')}>
                  Game blueprint
                </button>
                <button className={tab === 'play' ? 'active' : ''} onClick={() => setTab('play')}>
                  <Play size={13} style={{ verticalAlign: -2 }} /> Play prototype
                </button>
              </div>
              {tab === 'blueprint' ? <BlueprintView bp={bp} /> : <StoryPlayer blueprint={bp} />}
            </>
          ) : (
            <div className="empty">
              <Clapperboard size={28} />
              <b>Your story, playable</b>
              <span>Paste a script on the left (or use a sample) and press “Turn into a game”.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
