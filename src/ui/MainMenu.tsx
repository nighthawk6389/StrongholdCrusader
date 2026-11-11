import { useState } from 'react';
import { agoText, type SaveMeta } from '../game/saveSlot';
import { DEFAULT_SEED, TRAIL, trailSetup, type MatchSetup } from '../game/setup';
import { OPPONENTS, PERSONALITIES, type Difficulty, type OpponentKey } from '../sim/ai';
import { MAPS, MAP_KEYS, type MapKey } from '../sim/maps';
import { SettingsPanel } from './SettingsPanel';

const DIFFS: { key: Difficulty; name: string }[] = [
  { key: 'easy', name: 'Easy' },
  { key: 'normal', name: 'Normal' },
  { key: 'hard', name: 'Hard' },
];

const DIFF_NAME: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/** One line describing a saved game for the Continue card. */
function savedText(m: SaveMeta): string {
  if (m.mode === 'hold') return 'Hold the Line';
  if (m.mode === 'sandbox') return 'Sandbox';
  if (m.trail !== undefined && m.trail !== null && TRAIL[m.trail]) return `Commander's Trail ${m.trail + 1}: ${TRAIL[m.trail].title}`;
  const who = PERSONALITIES[m.opponent ?? 'sarge']?.name ?? 'AI';
  const map = MAPS[m.map ?? 'basin']?.name ?? '';
  return `Skirmish vs ${who} (${m.difficulty}) · ${map}`;
}

export function MainMenu({
  onStart,
  saved,
  onContinue,
  trailDone,
}: {
  onStart: (setup: MatchSetup) => void;
  saved: SaveMeta | null;
  onContinue: () => void;
  /** Trail stages cleared so far. */
  trailDone: number;
}) {
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [opponent, setOpponent] = useState<OpponentKey>('sarge');
  const [map, setMap] = useState<MapKey>('basin');
  const [settings, setSettings] = useState(false);
  const next = Math.min(trailDone, TRAIL.length - 1);
  const finished = trailDone >= TRAIL.length;
  const foe = PERSONALITIES[opponent];
  // Every new skirmish gets a fresh layout of the chosen map (Play again keeps it).
  const skirmish = (): void =>
    onStart({ mode: 'skirmish', difficulty: diff, seed: 1 + Math.floor(Math.random() * 999_998), opponent, map, trail: null });
  const simple = (mode: 'hold' | 'sandbox'): void =>
    onStart({ mode, difficulty: 'normal', seed: DEFAULT_SEED, opponent: 'sarge', map: 'basin', trail: null });
  return (
    <div className="menu-screen">
      <div className="menu-card panel">
        <div className="menu-top">
          <div className="menu-kicker">Prototype · M7</div>
          <button type="button" className="btn menu-settings" onClick={() => setSettings(true)} title="Settings">
            ⚙ Settings
          </button>
        </div>
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
                {savedText(saved)} · {saved.label} · saved {agoText(saved.savedAt)}
              </span>
              <span className="muted small">Starting a new game below replaces it.</span>
            </div>
            <button type="button" className="btn primary start-btn" onClick={onContinue}>
              Continue
            </button>
          </div>
        )}
        <div className="menu-modes">
          <div className="mode-card primary trail-card">
            <span className="mode-title">Commander's Trail</span>
            <span className="mode-desc">
              {finished
                ? 'You beat every commander on the trail. Replay any stage.'
                : `Six commanders, each tougher than the last, each on their own ground. Stage ${next + 1} of ${TRAIL.length}.`}
            </span>
            <div className="trail-stages">
              {TRAIL.map((s, k) => {
                const locked = k > trailDone;
                const done = k < trailDone;
                return (
                  <button
                    key={s.title}
                    type="button"
                    className={`trail-stage ${done ? 'done' : ''} ${k === next && !finished ? 'next' : ''}`}
                    disabled={locked}
                    onClick={() => onStart(trailSetup(k))}
                    title={locked ? 'Win the stage before to unlock' : s.brief}
                  >
                    <span className="trail-num">{done ? '✓' : locked ? '🔒' : k + 1}</span>
                    <span className="trail-title">{s.title}</span>
                    <span className="trail-sub">
                      {PERSONALITIES[s.opponent].name} · {MAPS[s.map].name} · {DIFF_NAME[s.difficulty]}
                    </span>
                  </button>
                );
              })}
            </div>
            {!finished && <span className="mode-desc trail-brief">{TRAIL[next].brief}</span>}
            <button type="button" className="btn primary start-btn" onClick={() => onStart(trailSetup(next))}>
              {finished ? 'Replay the last stage' : trailDone === 0 ? 'Start the trail' : `Play stage ${next + 1}: ${TRAIL[next].title}`}
            </button>
          </div>
          <div className="mode-card skirmish-card">
            <span className="mode-title">Skirmish</span>
            <span className="menu-label">Opponent</span>
            <div className="segmented opponent-picker">
              {OPPONENTS.map((k) => (
                <button key={k} type="button" className={`seg ${opponent === k ? 'active' : ''}`} onClick={() => setOpponent(k)}>
                  {PERSONALITIES[k].name}
                  <span className="seg-sub">{PERSONALITIES[k].title}</span>
                </button>
              ))}
            </div>
            <span className="mode-desc">{foe.blurb}</span>
            <span className="menu-label">Map</span>
            <div className="segmented map-picker">
              {MAP_KEYS.map((k) => (
                <button key={k} type="button" className={`seg ${map === k ? 'active' : ''}`} onClick={() => setMap(k)}>
                  {MAPS[k].name}
                </button>
              ))}
            </div>
            <span className="mode-desc">{MAPS[map].blurb} A new layout every game.</span>
            <span className="menu-label">Difficulty</span>
            <div className="segmented diff-picker">
              {DIFFS.map((d) => (
                <button key={d.key} type="button" className={`seg ${diff === d.key ? 'active' : ''}`} onClick={() => setDiff(d.key)}>
                  {d.name}
                </button>
              ))}
            </div>
            <button type="button" className="btn primary start-btn" onClick={skirmish}>
              Start skirmish vs {foe.name}
            </button>
          </div>
          <button type="button" className="mode-card" onClick={() => simple('hold')}>
            <span className="mode-title">Hold the Line</span>
            <span className="mode-desc">
              Survive six escalating waves (two at night) behind your walls. Engineers will try to blow them open.
            </span>
          </button>
          <button type="button" className="mode-card" onClick={() => simple('sandbox')}>
            <span className="mode-title">Sandbox</span>
            <span className="mode-desc">No pressure. Build, experiment with walls, skirmish with a hostile patrol.</span>
          </button>
        </div>
        <p className="menu-foot muted">Best in landscape on phones · desktop: mouse + keyboard</p>
      </div>
      {settings && <SettingsPanel onClose={() => setSettings(false)} />}
    </div>
  );
}
