import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { audio } from './audio/AudioEngine';
import { Game } from './game/Game';
import { clearGame, metaSetup, readGame, readMeta } from './game/saveSlot';
import { sameMatch, setupFromParams, setupQuery, trailCleared, type MatchSetup } from './game/setup';
import { Hud } from './ui/Hud';
import { MainMenu } from './ui/MainMenu';
import './ui/hud.css';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud-root') as HTMLElement;
const inputOverlay = document.getElementById('input-overlay') as HTMLElement;

/**
 * Something threw that nobody caught: say so plainly and offer a way out, instead of a frozen screen.
 * (The game autosaves every 30 seconds, so a reload lands close to where you were.)
 */
let crashed = false;
function showCrash(detail: string): void {
  if (crashed) return;
  crashed = true;
  document.getElementById('boot')?.remove();
  const box = document.createElement('div');
  box.className = 'crash';
  box.innerHTML = `<div class="panel modal">
    <h2>Something went wrong</h2>
    <p>Garrison Zero hit an unexpected error. Your game saves itself every 30 seconds, so reloading should put
    you back close to where you were.</p>
    <pre class="crash-detail"></pre>
    <div class="row end">
      <button type="button" class="btn" data-act="menu">Main menu</button>
      <button type="button" class="btn primary" data-act="reload">Reload</button>
    </div>
  </div>`;
  (box.querySelector('.crash-detail') as HTMLElement).textContent = `${detail}\nv${__APP_VERSION__} · ${__BUILD_ID__}`;
  box.querySelector('[data-act="reload"]')!.addEventListener('click', () => location.reload());
  box.querySelector('[data-act="menu"]')!.addEventListener('click', () => {
    location.search = '';
  });
  document.body.appendChild(box);
}
window.addEventListener('error', (e) => {
  // Only our own code: browser extensions and cross-origin scripts aren't our business.
  if (e.filename && !e.filename.startsWith(location.origin)) return;
  showCrash(e.message || 'Unknown error');
});

/** Fade out the loading splash once the first frame is on screen. */
function hideBoot(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const boot = document.getElementById('boot');
      if (!boot) return;
      boot.classList.add('gone');
      setTimeout(() => boot.remove(), 400);
    }),
  );
}

// Offline play and installing to the home screen (production builds only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

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
  hideBoot();
  // Expose for debugging in the console during development.
  (window as unknown as { game: Game; audio: typeof audio }).game = game;
  (window as unknown as { audio: typeof audio }).audio = audio;
} else {
  const start = (s: MatchSetup): void => {
    clearGame(); // a new game replaces the saved one
    go(setupQuery(s));
  };
  const saved = readMeta();
  // Read the slot again on Continue: it may have changed since this menu was drawn.
  const resume = (): void => {
    const now = readMeta();
    if (now) go(setupQuery(metaSetup(now)));
  };
  // Back to the menu with the browser's back button or gesture: browsers often show the copy of this page
  // they kept from before, with an out-of-date Continue card. Load it afresh instead.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  root.render(
    <StrictMode>
      <MainMenu onStart={start} saved={saved} onContinue={resume} trailDone={trailCleared()} />
    </StrictMode>,
  );
  hideBoot();
}
