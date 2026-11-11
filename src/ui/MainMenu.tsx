import { useState } from 'react';
import { agoText, type SaveMeta } from '../game/saveSlot';
import type { GameMode } from '../sim/scenario';

const MODE_NAME: Record<GameMode, string> = { skirmish: 'Skirmish vs Old Sarge', hold: 'Hold the Line', sandbox: 'Sandbox' };

const DIFFS = [
  { key: 'easy', name: 'Easy' },
  { key: 'normal', name: 'Normal' },
  { key: 'hard', name: 'Hard' },
];

export function MainMenu({
  onStart,
  saved,
  onContinue,
}: {
  onStart: (mode: GameMode, difficulty?: string) => void;
  saved: SaveMeta | null;
  onContinue: () => void;
}) {
  const [diff, setDiff] = useState('normal');
  return (
    <div className="menu-screen">
      <div className="menu-card panel">
        <div className="menu-kicker">Prototype · M5</div>
        <h1>Siege RTS</h1>
        <p className="muted">
          Build an outpost in the desert, wall it in, arm your people, and take the fight to a rival commander, by
          day and by night. Take direct control of any soldier when it counts.
        </p>
        {saved && (
          <div className="continue-card">
            <div>
              <span className="mode-title">Continue</span>
              <span className="mode-desc">
                {MODE_NAME[saved.mode]}
                {saved.mode === 'skirmish' ? ` (${saved.difficulty})` : ''} · {saved.label} · saved {agoText(saved.savedAt)}
              </span>
              <span className="muted small">Starting a new game below replaces it.</span>
            </div>
            <button type="button" className="btn primary start-btn" onClick={onContinue}>
              Continue
            </button>
          </div>
        )}
        <div className="menu-modes">
          <div className="mode-card primary skirmish-card">
            <span className="mode-title">Skirmish vs Old Sarge</span>
            <span className="mode-desc">
              A 1v1 against a methodical veteran who walls up early and pushes with steady infantry. Destroy his HQ
              or take out his Commander.
            </span>
            <div className="segmented diff-picker">
              {DIFFS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`seg ${diff === d.key ? 'active' : ''}`}
                  onClick={() => setDiff(d.key)}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <button type="button" className="btn primary start-btn" onClick={() => onStart('skirmish', diff)}>
              Start skirmish
            </button>
          </div>
          <button type="button" className="mode-card" onClick={() => onStart('hold')}>
            <span className="mode-title">Hold the Line</span>
            <span className="mode-desc">
              Survive six escalating waves (two at night) behind your walls. Engineers will try to blow them open.
            </span>
          </button>
          <button type="button" className="mode-card" onClick={() => onStart('sandbox')}>
            <span className="mode-title">Sandbox</span>
            <span className="mode-desc">No pressure. Build, experiment with walls, skirmish with a hostile patrol.</span>
          </button>
        </div>
        <p className="menu-foot muted">Best in landscape on phones · desktop: mouse + keyboard</p>
      </div>
    </div>
  );
}
