import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from './game/Game';
import { clearGame, readGame, readMeta, type SaveMeta } from './game/saveSlot';
import type { GameMode } from './sim/scenario';
import { Hud } from './ui/Hud';
import { MainMenu } from './ui/MainMenu';
import './ui/hud.css';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud-root') as HTMLElement;
const inputOverlay = document.getElementById('input-overlay') as HTMLElement;

const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const root = createRoot(hudRoot);

/** The autosave belongs to this link's game (same mode, opponent difficulty and map seed)? */
function matches(meta: SaveMeta): boolean {
  const diff = params.get('difficulty') ?? 'normal';
  const seed = Number(params.get('seed')) || 1337;
  return meta.mode === mode && meta.seed === seed && (mode !== 'skirmish' || meta.difficulty === diff);
}

if (mode === 'hold' || mode === 'sandbox' || mode === 'skirmish') {
  // Coming back to the same game (reload, or the browser dropped the tab while you were away): resume it.
  const meta = readMeta();
  const resume = meta && matches(meta) ? readGame() : null;
  const game = new Game(canvas, inputOverlay, mode, resume);
  game.start();
  root.render(
    <StrictMode>
      <Hud game={game} />
    </StrictMode>,
  );
  // Expose for debugging in the console during development.
  (window as unknown as { game: Game }).game = game;
} else {
  const start = (m: GameMode, difficulty?: string): void => {
    clearGame(); // a new game replaces the saved one
    params.set('mode', m);
    if (difficulty) params.set('difficulty', difficulty);
    location.search = params.toString();
  };
  const saved = readMeta();
  const resume = (): void => {
    if (!saved) return;
    params.set('mode', saved.mode);
    params.set('difficulty', saved.difficulty);
    if (saved.seed !== 1337) params.set('seed', String(saved.seed));
    else params.delete('seed');
    location.search = params.toString();
  };
  root.render(
    <StrictMode>
      <MainMenu onStart={start} saved={saved} onContinue={resume} />
    </StrictMode>,
  );
}
