import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from './game/Game';
import { Hud } from './ui/Hud';
import './ui/hud.css';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud-root') as HTMLElement;
const inputOverlay = document.getElementById('input-overlay') as HTMLElement;

const game = new Game(canvas, inputOverlay);
game.start();

createRoot(hudRoot).render(
  <StrictMode>
    <Hud game={game} />
  </StrictMode>,
);

// Expose for debugging in the console during development.
(window as unknown as { game: Game }).game = game;
