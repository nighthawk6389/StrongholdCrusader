import type { GameMode } from '../sim/scenario';

export function MainMenu({ onStart }: { onStart: (mode: GameMode) => void }) {
  return (
    <div className="menu-screen">
      <div className="menu-card panel">
        <div className="menu-kicker">Prototype · M2</div>
        <h1>Siege RTS</h1>
        <p className="muted">
          Build an outpost in the desert, wall it in, arm your people, and hold it against attacks by day and by
          night. Take direct control of any soldier when it counts.
        </p>
        <div className="menu-modes">
          <button type="button" className="mode-card primary" onClick={() => onStart('hold')}>
            <span className="mode-title">Hold the Line</span>
            <span className="mode-desc">
              Six escalating waves over about 15 minutes. Engineers will try to blow your walls. Lose your HQ or
              Commander and it's over.
            </span>
          </button>
          <button type="button" className="mode-card" onClick={() => onStart('sandbox')}>
            <span className="mode-title">Sandbox</span>
            <span className="mode-desc">
              No waves. Grow your economy, experiment with walls, and skirmish with the hostile patrol at your own
              pace.
            </span>
          </button>
        </div>
        <p className="menu-foot muted">Best in landscape on phones · desktop: mouse + keyboard</p>
      </div>
    </div>
  );
}
