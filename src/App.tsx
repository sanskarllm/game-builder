import { Sidebar } from './components/Sidebar';
import { Characters } from './sections/Characters';
import { CreateGame } from './sections/CreateGame';
import { Rigging } from './sections/Rigging';
import { ScriptReader } from './sections/ScriptReader';
import { TextTo3D } from './sections/TextTo3D';
import { useStore } from './store';

export default function App() {
  const section = useStore((s) => s.section);
  return (
    <div className="app">
      <Sidebar />
      <main style={{ minWidth: 0 }}>
        {section === 'game' && <CreateGame />}
        {section === 'characters' && <Characters />}
        {section === 'text3d' && <TextTo3D />}
        {section === 'rigging' && <Rigging />}
        {section === 'script' && <ScriptReader />}
      </main>
    </div>
  );
}
