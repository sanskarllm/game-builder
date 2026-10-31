import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StoryBlueprint } from '../lib/gameBlueprint';
import { createStoryGame, GAME_H, GAME_W } from '../lib/storyGame';

const CAPTURED = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);

export function StoryPlayer({ blueprint }: { blueprint: StoryBlueprint }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !blueprint.levels.length) return;
    const game = createStoryGame(blueprint);
    const keys = new Set<string>();

    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (CAPTURED.has(k)) e.preventDefault();
      if (!e.repeat) game.onKey(k);
      keys.add(k);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const blur = () => keys.clear();
    const click = () => {
      canvas.focus();
      game.onKey('click');
    };
    canvas.addEventListener('keydown', down);
    canvas.addEventListener('keyup', up);
    canvas.addEventListener('blur', blur);
    canvas.addEventListener('pointerdown', click);

    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      game.update(dt, keys);
      game.draw(ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    canvas.focus();

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('keydown', down);
      canvas.removeEventListener('keyup', up);
      canvas.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', click);
    };
  }, [blueprint, run]);

  if (!blueprint.levels.length) return <div className="empty">This story produced no levels to play.</div>;

  return (
    <div className="player-wrap">
      <canvas ref={canvasRef} width={GAME_W} height={GAME_H} tabIndex={0} />
      <div className="row">
        <span className="muted">Click the game to focus it. WASD / arrows to move, E to talk, Space to attack.</span>
        <button className="btn small" onClick={() => setRun((r) => r + 1)}>
          <RotateCcw size={14} /> Restart
        </button>
      </div>
    </div>
  );
}
