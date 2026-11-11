import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from './game/Game';
import { clearGame, metaSetup, readGame, readMeta } from './game/saveSlot';
import { sameMatch, setupFromParams, setupQuery, trailCleared, type MatchSetup } from './game/setup';
import { Hud } from './ui/Hud';
import { MainMenu } from './ui/MainMenu';
import './ui/hud.css';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud-root') as HTMLElement;
const inputOverlay = document.getElementById('input-overlay') as HTMLElement;

const params = new URLSearchParams(location.search);
const setup = setupFromParams(params);
const root = createRoot(hudRoot);

/** Keep unrelated URL flags (debug, quality, …) when switching matches. */
function go(query: string): void {
  const keep = new URLSearchParams(location.search);
  for (const k of ['mode', 'difficulty', 'seed', 'ai', 'map', 'trail']) keep.delete(k);
  const next = new URLSearchParams(query);
  keep.forEach((v, k) => next.set(k, v));
  location.search = next.toString();
}

if (setup) {
  // Coming back to the same game (reload, or the browser dropped the tab while you were away): resume it.
  const meta = readMeta();
  const resume = meta && sameMatch(metaSetup(meta), setup) ? readGame() : null;
  const game = new Game(canvas, inputOverlay, setup, resume);
  game.start();
  root.render(
    <StrictMode>
      <Hud game={game} />
    </StrictMode>,
  );
  // Expose for debugging in the console during development.
  (window as unknown as { game: Game }).game = game;
} else {
  const start = (s: MatchSetup): void => {
    clearGame(); // a new game replaces the saved one
    go(setupQuery(s));
  };
  const saved = readMeta();
  const resume = (): void => {
    if (saved) go(setupQuery(metaSetup(saved)));
  };
  root.render(
    <StrictMode>
      <MainMenu onStart={start} saved={saved} onContinue={resume} trailDone={trailCleared()} />
    </StrictMode>,
  );
}
