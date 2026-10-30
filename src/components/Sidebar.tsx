import { Bone, Boxes, Gamepad2, PersonStanding, ScrollText, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type SectionId } from '../store';

export const NAV: { id: SectionId; label: string; hint: string; icon: typeof Bone }[] = [
  { id: 'game', label: 'Create Game', hint: 'Projects & export', icon: Gamepad2 },
  { id: 'characters', label: 'Characters', hint: 'Build humanoids', icon: PersonStanding },
  { id: 'text3d', label: 'Text to 3D', hint: 'Prompt → model', icon: Sparkles },
  { id: 'rigging', label: 'Rigging', hint: 'Unity / Unreal bones', icon: Bone },
  { id: 'script', label: 'Script → Game', hint: 'Story into levels', icon: ScrollText },
];

export function Sidebar() {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const counts = useStore(
    useShallow((s) => ({ projects: s.projects.length, characters: s.characters.length, assets: s.assets.length, stories: s.stories.length })),
  );

  return (
    <nav className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Boxes size={18} />
        </div>
        <span>Game Builder</span>
      </div>
      <div className="nav-label">Workspace</div>
      {NAV.map(({ id, label, hint, icon: Icon }) => (
        <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => setSection(id)} title={label}>
          <Icon size={20} className="nav-icon" />
          <span className="nav-text">
            <span className="nav-title">{label}</span>
            <span className="nav-hint">{hint}</span>
          </span>
        </button>
      ))}
      <div className="sidebar-footer">
        <div>
          <span>Projects</span>
          <b>{counts.projects}</b>
        </div>
        <div>
          <span>Characters</span>
          <b>{counts.characters}</b>
        </div>
        <div>
          <span>3D assets</span>
          <b>{counts.assets}</b>
        </div>
        <div>
          <span>Stories</span>
          <b>{counts.stories}</b>
        </div>
      </div>
    </nav>
  );
}
