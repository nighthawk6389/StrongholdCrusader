import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { GameActions } from '../game/Game';
import type { PhaseName } from '../sim/clock';
import { RATION_LEVELS, TAX_LEVELS } from '../sim/economy';
import {
  BUILDABLE,
  STRUCTURE_DEFS,
  costText,
  type BuildCategory,
  type StructureStatus,
} from '../sim/structures';
import { useHud, type EcoSnapshot } from './store';

// ------------------------------------------------------------------ icons

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />
    </svg>
  );
}

const ICON_PATHS: Record<string, ReactNode> = {
  funds: <path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  timber: (
    <g fill="currentColor">
      <rect x="3" y="6" width="18" height="4" rx="1" />
      <rect x="3" y="11" width="18" height="4" rx="1" opacity="0.8" />
      <rect x="3" y="16" width="18" height="4" rx="1" opacity="0.6" />
    </g>
  ),
  concrete: (
    <g fill="currentColor">
      <rect x="3" y="12" width="8" height="8" rx="1" />
      <rect x="13" y="12" width="8" height="8" rx="1" opacity="0.8" />
      <rect x="8" y="4" width="8" height="7" rx="1" opacity="0.65" />
    </g>
  ),
  food: (
    <g fill="currentColor">
      <circle cx="12" cy="14" r="7" />
      <path d="M12 7c0-2 1-3.5 3-4" stroke="currentColor" strokeWidth="2" fill="none" />
    </g>
  ),
  people: (
    <g fill="currentColor">
      <circle cx="9" cy="7.5" r="3.2" />
      <path d="M3 20c0-4 2.7-6.5 6-6.5s6 2.5 6 6.5z" />
      <circle cx="17" cy="9" r="2.6" opacity="0.7" />
      <path d="M14.5 20c.3-2.8 1.5-5 4-5 2.3 0 3.5 2 3.5 5z" opacity="0.7" />
    </g>
  ),
  build: (
    <path d="M14 4l6 6-2 2-2-2-7 7.5a2 2 0 0 1-3-3L13 7l-1-1z" fill="currentColor" />
  ),
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="icon">
      {ICON_PATHS[name]}
    </svg>
  );
}

const PHASE_LABEL: Record<PhaseName, string> = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

function Btn(props: {
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn ${props.active ? 'active' : ''} ${props.className ?? ''}`}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

const fmt = (n: number): string => Math.floor(n).toString();

function moraleColor(m: number): string {
  if (m >= 70) return 'var(--good)';
  if (m >= 50) return 'var(--accent)';
  if (m >= 30) return 'var(--warn)';
  return 'var(--red)';
}

function formatDuration(sec: number): string {
  if (!isFinite(sec)) return '∞';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ------------------------------------------------------------------ top bar

function TopBar({ game }: { game: GameActions }) {
  const s = useHud();
  const [timeOpen, setTimeOpen] = useState(false);
  const night = s.phase === 'night' || s.phase === 'dusk';
  return (
    <div className="topbar">
      <div className="panel clock">
        <span className={`phase-icon ${s.phase}`}>{night ? <MoonIcon /> : <SunIcon />}</span>
        <span className="clock-time">{s.clock}</span>
        <span className="clock-sub">
          Day {s.day} · {PHASE_LABEL[s.phase]}
        </span>
      </div>
      <div className="panel speed">
        <Btn onClick={() => game.togglePause()} active={s.paused} title="Pause (P)">
          {s.paused ? '▶' : '❚❚'}
        </Btn>
        {[1, 2, 3].map((v) => (
          <Btn key={v} onClick={() => game.setSpeed(v)} active={!s.paused && s.speed === v}>
            {v}×
          </Btn>
        ))}
      </div>
      <ResourceBar game={game} />
      <div className="spacer" />
      <div className="panel forces" title="Your soldiers vs hostile soldiers">
        <span className="dot blue" /> {s.playerUnits}
        <span className="vs">vs</span>
        <span className="dot red" /> {s.enemyUnits}
      </div>
      <div className="panel menu">
        <div className="dropdown">
          <Btn onClick={() => setTimeOpen(!timeOpen)} active={timeOpen} title="Jump the day/night clock (test)">
            Time
          </Btn>
          {timeOpen && (
            <div className="dropdown-menu panel">
              {(['dawn', 'day', 'dusk', 'night'] as PhaseName[]).map((p) => (
                <Btn
                  key={p}
                  onClick={() => {
                    game.skipToPhase(p);
                    setTimeOpen(false);
                  }}
                >
                  {PHASE_LABEL[p]}
                </Btn>
              ))}
            </div>
          )}
        </div>
        {s.isTouch && (
          <Btn onClick={() => game.toggleFullscreen()} title="Fullscreen">
            ⛶
          </Btn>
        )}
        <Btn onClick={() => game.showHelp()} title="Controls">
          ?
        </Btn>
      </div>
      {s.debug && (
        <div className="panel debug">
          {s.fps} fps · sim {s.simMs} ms · {s.quality}
        </div>
      )}
    </div>
  );
}

function ResourceBar({ game }: { game: GameActions }) {
  const eco = useHud((s) => s.eco);
  const moraleOpen = useHud((s) => s.moraleOpen);
  const food = eco.produce + eco.meat;
  const trendArrow = eco.trend > 0.05 ? '▲' : eco.trend < -0.05 ? '▼' : '■';
  return (
    <div className="panel resources">
      <span className="res" title="Funds">
        <Icon name="funds" />
        {fmt(eco.funds)}
      </span>
      <span className="res" title={`Timber (materials ${fmt(eco.timber + eco.concrete)}/${eco.materialsCap})`}>
        <Icon name="timber" />
        {fmt(eco.timber)}
      </span>
      <span className="res" title="Concrete">
        <Icon name="concrete" />
        {fmt(eco.concrete)}
      </span>
      <span
        className={`res ${eco.foodSeconds < 60 && eco.rationLevel > 0 ? 'warn' : ''}`}
        title={`Food: produce ${fmt(eco.produce)}, meat ${fmt(eco.meat)} (${fmt(food)}/${eco.foodCap})`}
      >
        <Icon name="food" />
        {fmt(food)}
      </span>
      <span className="res" title={`Population ${eco.population} / housing ${eco.housing}, ${eco.idle} idle`}>
        <Icon name="people" />
        {eco.population}/{eco.housing}
        {eco.idle > 0 && <span className="idle">({eco.idle} idle)</span>}
      </span>
      <button
        type="button"
        className={`morale-pill ${moraleOpen ? 'open' : ''}`}
        onClick={() => game.setMoraleOpen(!moraleOpen)}
        title="Morale: above 50 people arrive, below 50 they leave"
      >
        <span className="morale-label">Morale</span>
        <span className="morale-value" style={{ color: moraleColor(eco.morale) }}>
          {fmt(eco.morale)}
        </span>
        <span className="morale-trend" style={{ color: eco.trend >= 0 ? 'var(--good)' : 'var(--red)' }}>
          {trendArrow}
        </span>
      </button>
      {moraleOpen && <MoralePanel game={game} />}
    </div>
  );
}

function Segmented(props: {
  options: { key: string; name: string }[];
  value: number;
  onChange: (i: number) => void;
}) {
  return (
    <div className="segmented">
      {props.options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          className={`seg ${props.value === i ? 'active' : ''}`}
          onClick={() => props.onChange(i)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}

function MoralePanel({ game }: { game: GameActions }) {
  const eco: EcoSnapshot = useHud((s) => s.eco);
  return (
    <div className="panel popover morale-panel">
      <div className="popover-head">
        <strong>Morale {fmt(eco.morale)}</strong>
        <span className="muted">
          {eco.trend >= 0 ? '+' : ''}
          {eco.trend.toFixed(2)}/s · {eco.morale >= 50 ? 'people are arriving' : 'people are leaving'}
        </span>
        <Btn className="close" onClick={() => game.setMoraleOpen(false)}>
          ✕
        </Btn>
      </div>
      <div className="meter">
        <div className="meter-fill" style={{ width: `${eco.morale}%`, background: moraleColor(eco.morale) }} />
        <div className="meter-mid" />
      </div>
      <ul className="factors">
        {eco.factors.map((f) => (
          <li key={f.key}>
            <span>{f.label}</span>
            <span className={f.value > 0 ? 'pos' : f.value < 0 ? 'neg' : 'muted'}>
              {f.value > 0 ? '+' : ''}
              {f.value}
            </span>
          </li>
        ))}
      </ul>
      <div className="control-group">
        <div className="control-label">
          Rations <span className="muted">· food lasts {formatDuration(eco.foodSeconds)}</span>
        </div>
        <Segmented options={RATION_LEVELS} value={eco.rationLevel} onChange={(i) => game.setRations(i)} />
      </div>
      <div className="control-group">
        <div className="control-label">
          Taxes{' '}
          <span className="muted">
            · {eco.taxPerMin >= 0 ? '+' : ''}${Math.round(eco.taxPerMin)}/min
          </span>
        </div>
        <Segmented options={TAX_LEVELS} value={eco.taxLevel} onChange={(i) => game.setTax(i)} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ build menu

const CATEGORIES: { key: BuildCategory; name: string }[] = [
  { key: 'core', name: 'Core' },
  { key: 'industry', name: 'Industry' },
  { key: 'food', name: 'Food' },
];

function BuildMenu({ game }: { game: GameActions }) {
  const eco = useHud((s) => s.eco);
  const [cat, setCat] = useState<BuildCategory>('core');
  const items = BUILDABLE.filter((k) => STRUCTURE_DEFS[k].category === cat);
  return (
    <div className="panel build-menu">
      <div className="build-tabs">
        {CATEGORIES.map((c) => (
          <Btn key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
            {c.name}
          </Btn>
        ))}
        <div className="spacer" />
        <Btn className="close" onClick={() => game.setBuildOpen(false)}>
          ✕
        </Btn>
      </div>
      <div className="build-grid">
        {items.map((k) => {
          const def = STRUCTURE_DEFS[k];
          const afford =
            (def.cost.timber ?? 0) <= eco.timber &&
            (def.cost.concrete ?? 0) <= eco.concrete &&
            (def.cost.funds ?? 0) <= eco.funds;
          return (
            <button
              key={k}
              type="button"
              className={`build-card ${afford ? '' : 'cant'}`}
              onClick={() => game.startPlacing(k)}
              title={def.description}
            >
              <span className="build-name">{def.name}</span>
              <span className="build-cost">{costText(def.cost)}</span>
              <span className="build-desc">{def.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bottom context panels

const STATUS_TEXT: Record<StructureStatus, string> = {
  ok: 'Working',
  noWorker: 'Waiting for a worker (needs idle civilians)',
  noTrees: 'No trees in range',
  storageFull: 'Storage full: build another store',
  paused: 'Paused',
};

function PlacementPanel({ game }: { game: GameActions }) {
  const placing = useHud((s) => s.placing)!;
  const isTouch = useHud((s) => s.isTouch);
  return (
    <div className="bottombar">
      <div className="panel selection">
        <div className="sel-label">
          Placing <strong>{placing.name}</strong> · <span className="muted">{placing.cost}</span>
        </div>
        <div className={`place-status ${placing.valid ? 'ok' : 'bad'}`}>
          {!placing.hasSpot
            ? isTouch
              ? 'Tap the ground to position it'
              : 'Move the cursor over the ground'
            : placing.valid
              ? isTouch
                ? 'Looks good: tap Place to build'
                : 'Click to build · right-click or Esc to stop'
              : placing.reason}
        </div>
        <div className="row">
          {isTouch && (
            <Btn className="primary" disabled={!placing.valid} onClick={() => game.confirmPlacing()}>
              ✓ Place
            </Btn>
          )}
          <Btn onClick={() => game.cancelPlacing()}>✕ Done</Btn>
        </div>
      </div>
    </div>
  );
}

function BuildingPanel({ game }: { game: GameActions }) {
  const b = useHud((s) => s.building)!;
  return (
    <div className="bottombar">
      <div className="panel selection building-panel">
        <div className="sel-label">
          <strong>{b.name}</strong>
          {b.jobs > 0 && (
            <span className={`badge ${b.status === 'ok' ? 'ok' : 'bad'}`}>{STATUS_TEXT[b.status]}</span>
          )}
        </div>
        <div className="muted small">{b.description}</div>
        {b.jobs > 0 && (
          <div className="small">
            Workers {b.workers}/{b.jobs}
          </div>
        )}
        {b.storage && <div className="small">{b.storage}</div>}
        <div className="row">
          {b.jobs > 0 && <Btn onClick={() => game.toggleSelectedActive()}>{b.active ? '❚❚ Pause' : '▶ Resume'}</Btn>}
          {b.canDemolish && (
            <Btn className="danger" onClick={() => game.demolishSelected()} title={`Refund: ${b.refund}`}>
              Demolish
            </Btn>
          )}
          <Btn onClick={() => game.deselectStructure()}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

function RtsPanel({ game }: { game: GameActions }) {
  const s = useHud();
  if (s.placing) return <PlacementPanel game={game} />;
  if (s.buildOpen || s.moraleOpen) return null; // these panels need the room (especially on phones)
  if (s.building) return <BuildingPanel game={game} />;
  return (
    <div className="bottombar">
      <div className="panel selection">
        {s.selectionCount > 0 ? (
          <>
            <div className="sel-label">
              <strong>{s.selectionCount}</strong> selected · <span className="muted">{s.selectionLabel}</span>
            </div>
            <div className="row">
              <Btn onClick={() => game.takeControl()} className="primary" title="Take direct control (F)">
                Take control{!s.isTouch && <kbd>F</kbd>}
              </Btn>
              <Btn onClick={() => game.deselect()} title="Deselect (Esc)">
                Deselect
              </Btn>
              <Btn onClick={() => game.selectAll()} title="Select all soldiers (Ctrl+A)">
                All
              </Btn>
              {s.isTouch && (
                <Btn onClick={() => game.setSelectMode(!s.selectMode)} active={s.selectMode} title="Drag to box-select">
                  ▢ Box
                </Btn>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="sel-label muted">
              {s.isTouch
                ? 'Tap a soldier or building · Build to expand your economy'
                : 'Select soldiers or buildings · B to build · F to take control of a soldier'}
            </div>
            <div className="row">
              <Btn onClick={() => game.selectAll()} title="Select all soldiers (Ctrl+A)">
                Soldiers
              </Btn>
              {s.isTouch && (
                <Btn onClick={() => game.setSelectMode(!s.selectMode)} active={s.selectMode} title="Drag to box-select">
                  ▢ Box
                </Btn>
              )}
              <Btn onClick={() => game.centerOnBase()} title="Center on base (H)">
                Base
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ control mode

function ControlOverlay({ game }: { game: GameActions }) {
  const s = useHud();
  const hold = (on: boolean) => (e: ReactPointerEvent) => {
    e.preventDefault();
    game.setFire(on);
  };
  return (
    <>
      <div className={`crosshair ${s.aiming ? 'aiming' : ''}`} />
      <div className="control-top">
        <div className="panel control-status">
          <span className="muted">Controlling</span> <strong>{s.controlledName}</strong>
          <div className="hpbar">
            <div className="hpfill" style={{ width: `${Math.max(0, s.controlledHp) * 100}%` }} />
          </div>
        </div>
        <Btn onClick={() => game.exitControl()} className="exit" title="Return to command view (Esc)">
          ✕ Exit
        </Btn>
      </div>
      {s.isTouch ? (
        <div className="touch-controls">
          <div className="move-hint">Drag here to move</div>
          <div className="action-btns">
            <Btn onClick={() => game.toggleAim()} active={s.aiming} className="round aim">
              Aim
            </Btn>
            <button
              type="button"
              className="btn round fire"
              onPointerDown={hold(true)}
              onPointerUp={hold(false)}
              onPointerLeave={hold(false)}
              onPointerCancel={hold(false)}
            >
              Fire
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="panel control-hint">
            WASD move · mouse look · <b>LMB</b> fire · <b>RMB</b> aim · <b>Esc</b> exit
          </div>
          {!s.pointerLocked && (
            <button type="button" className="panel lock-prompt" onClick={() => game.requestPointerLock()}>
              Click to aim with the mouse
            </button>
          )}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ help & misc

function Help({ game }: { game: GameActions }) {
  const s = useHud();
  return (
    <div className="modal-backdrop" onClick={() => game.dismissHelp()}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>Prototype M1: economy</h2>
        <p className="muted">
          Grow your outpost. Civilians arrive while <b>morale</b> is above 50 and there's free housing. Build lumber
          camps, a quarry, orchards and ranches. Workers carry goods to your depots and ration store, so build stores
          near producers. Set <b>rations</b> and <b>taxes</b> from the morale panel. Work slows at night.
        </p>
        {s.isTouch ? (
          <ul>
            <li>
              <b>Build</b> → pick a building → <b>tap the ground</b> to position → <b>✓ Place</b>.
            </li>
            <li>
              <b>Tap</b> a building to see its status, pause it or demolish it. Tap <b>Morale</b> for rations and taxes.
            </li>
            <li>
              <b>Tap</b> a soldier to select, <b>double-tap</b> for the squad, <b>tap ground</b> to move. Drag pans, pinch
              zooms, twist rotates.
            </li>
            <li>
              <b>Take control</b> of a soldier: left thumb moves, right thumb aims, hold <b>Fire</b>.
            </li>
          </ul>
        ) : (
          <ul>
            <li>
              <b>B</b> or <b>Build</b> → pick a building → <b>click</b> to place (repeat), <b>right-click/Esc</b> to stop.
            </li>
            <li>
              <b>Click</b> a building for status, pause or demolish. Click <b>Morale</b> for rations and taxes.
            </li>
            <li>
              <b>Drag</b> to box-select soldiers, <b>right-click</b> to move. <b>WASD</b>/edges pan, <b>wheel</b> zoom,{' '}
              <b>Q/E</b> rotate.
            </li>
            <li>
              <b>F</b> takes direct control of a soldier: WASD + mouse, <b>LMB</b> fire, <b>RMB</b> aim, <b>Esc</b> exit.
            </li>
          </ul>
        )}
        <div className="row end">
          <Btn className="primary" onClick={() => game.dismissHelp()}>
            Deploy
          </Btn>
        </div>
      </div>
    </div>
  );
}

function PortraitHint() {
  const isTouch = useHud((s) => s.isTouch);
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const check = () => setPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  if (!isTouch || !portrait || dismissed) return null;
  return (
    <div className="panel portrait-hint" onClick={() => setDismissed(true)}>
      Rotate your phone to landscape for the best view ✕
    </div>
  );
}

export function Hud({ game }: { game: GameActions }) {
  const mode = useHud((s) => s.mode);
  const toast = useHud((s) => s.toast);
  const showHelp = useHud((s) => s.showHelp);
  const buildOpen = useHud((s) => s.buildOpen);
  const placing = useHud((s) => s.placing);
  return (
    <div className="hud">
      <TopBar game={game} />
      {mode === 'rts' ? (
        <>
          {buildOpen && <BuildMenu game={game} />}
          {!placing && (
            <button
              type="button"
              className={`btn build-fab ${buildOpen ? 'active' : ''}`}
              onClick={() => game.setBuildOpen(!buildOpen)}
              title="Build (B)"
            >
              <Icon name="build" size={18} /> Build
            </button>
          )}
          <RtsPanel game={game} />
        </>
      ) : (
        <ControlOverlay game={game} />
      )}
      {toast && <div className="toast panel">{toast}</div>}
      {showHelp && <Help game={game} />}
      <PortraitHint />
    </div>
  );
}
