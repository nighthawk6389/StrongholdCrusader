import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from './game/Game';
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

if (mode === 'hold' || mode === 'sandbox') {
  const game = new Game(canvas, inputOverlay, mode);
  game.start();
  root.render(
    <StrictMode>
      <Hud game={game} />
    </StrictMode>,
  );
  // Expose for debugging in the console during development.
  (window as unknown as { game: Game }).game = game;
} else {
  const start = (m: GameMode): void => {
    params.set('mode', m);
    location.search = params.toString();
  };
  root.render(
    <StrictMode>
      <MainMenu onStart={start} />
    </StrictMode>,
  );
}
