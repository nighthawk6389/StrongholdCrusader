import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { GameActions } from '../game/Game';
import { audio } from '../audio/AudioEngine';
import type { PhaseName } from '../sim/clock';
import { RATION_LEVELS, TAX_LEVELS } from '../sim/economy';
import {
  BUILDABLE,
  STRUCTURE_DEFS,
  costText,
  type BuildCategory,
  type StructureStatus,
} from '../sim/structures';
import { setHud, useHud, type EcoSnapshot } from './store';
import { SettingsPanel } from './SettingsPanel';

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
  steel: (
    <g fill="currentColor">
      <path d="M3 17l4-9h14l-4 9z" />
      <path d="M5 21l3-3h12l-3 3z" opacity="0.7" />
    </g>
  ),
  power: <path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor" />,
  fuel: <path d="M12 3c3.2 4.6 6 8 6 11.2a6 6 0 0 1-12 0C6 11 8.8 7.6 12 3z" fill="currentColor" />,
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
      onClick={() => {
        audio.play('click', undefined, undefined, 0.5);
        props.onClick?.();
      }}
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
          <Btn key={v} className={`x${v}`} onClick={() => game.setSpeed(v)} active={!s.paused && s.speed === v}>
            {v}×
          </Btn>
        ))}
      </div>
      <ResourceBar game={game} />
      <WavePill />
      <div className="spacer" />
      <div className="panel forces" title={s.opponent ? `Your soldiers vs ${s.opponent.name} (${s.opponent.difficulty})` : 'Your soldiers vs hostile soldiers'}>
        <span className="dot blue" /> {s.playerUnits}
        <span className="vs">vs</span>
        <span className="dot red" /> {s.enemyUnits}
        {s.opponent && <span className="opp-name">{s.opponent.name}</span>}
      </div>
      <div className="panel menu">
        <div className="dropdown time-dropdown">
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
        <Btn onClick={() => setHud({ showSettings: true })} title="Settings">
          ⚙
        </Btn>
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
      <span className="res" title="Steel (for weapons)">
        <Icon name="steel" />
        {fmt(eco.steel)}
      </span>
      {eco.fuel > 0 && (
        <span className="res" title="Fuel (vehicles, fuel trenches) from an Oil Derrick">
          <Icon name="fuel" />
          {fmt(eco.fuel)}
        </span>
      )}
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
      <PowerGauge />
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

function PowerGauge() {
  const power = useHud((s) => s.power);
  if (!power.supply && !power.demand) return null;
  const short = power.demand > power.supply;
  return (
    <span className={`res ${short ? 'warn' : ''}`} title={`Power: ${power.demand} used of ${power.supply}${short ? ' (some lights are dark)' : ''}`}>
      <Icon name="power" />
      {power.demand}/{power.supply}
    </span>
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

function NightShiftToggle({ game }: { game: GameActions }) {
  const on = useHud((s) => s.nightShift);
  return (
    <div className="control-group">
      <div className="control-label">
        Night shifts <span className="muted">· full-speed work after dark, −4 morale at night</span>
      </div>
      <Segmented
        options={[
          { key: 'off', name: 'Rest at night' },
          { key: 'on', name: 'Work through the night' },
        ]}
        value={on ? 1 : 0}
        onChange={(i) => game.setNightShift(i === 1)}
      />
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
      <NightShiftToggle game={game} />
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
  { key: 'defense', name: 'Defense' },
  { key: 'military', name: 'Military' },
  { key: 'night', name: 'Night ops' },
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
            (def.cost.steel ?? 0) <= eco.steel &&
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
  noInput: 'Waiting for steel (build a scrap yard)',
};

function PlacementPanel({ game }: { game: GameActions }) {
  const placing = useHud((s) => s.placing)!;
  const isTouch = useHud((s) => s.isTouch);
  let status: string | null;
  let ok = placing.valid;
  if (placing.wall) {
    const w = placing.wall;
    if (!w.anchored) {
      status = isTouch ? 'Tap where the line starts' : 'Drag along the ground to draw a line';
      ok = true;
    } else if (isTouch && !w.ended) {
      status = 'Now tap where it ends';
      ok = true;
    } else {
      status = w.tiles > 0 ? `${w.tiles} tile${w.tiles === 1 ? '' : 's'} ${isTouch ? '· tap Place' : '· release to build'}` : placing.reason;
    }
  } else if (!placing.hasSpot) {
    status = isTouch ? 'Tap the ground to position it' : 'Move the cursor over the ground';
    ok = true;
  } else {
    status = placing.valid ? (isTouch ? 'Looks good: tap Place to build' : 'Click to build · right-click or Esc to stop') : placing.reason;
  }
  return (
    <div className="bottombar">
      <div className="panel selection">
        <div className="sel-label">
          Placing <strong>{placing.name}</strong> · <span className="muted">{placing.cost}</span>
        </div>
        <div className={`place-status ${ok ? 'ok' : 'bad'}`}>{status}</div>
        <div className="row">
          {isTouch && (
            <Btn className="primary" disabled={!placing.valid || (!!placing.wall && !placing.wall.ended)} onClick={() => game.confirmPlacing()}>
              ✓ Place
            </Btn>
          )}
          {placing.rotatable && (
            <Btn onClick={() => game.rotatePlacement()} title="Rotate (R)">
              ⟲ Rotate{!isTouch && <kbd>R</kbd>}
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
  const eco = useHud((s) => s.eco);
  const hpFrac = b.maxHp ? b.hp / b.maxHp : 1;
  return (
    <div className="bottombar">
      <div className={`panel selection building-panel ${b.recruit || b.recipes || b.trade || b.drones || b.contracts ? 'wide' : ''}`}>
        <div className="sel-label">
          <strong>{b.name}</strong>
          {b.level > 1 && <span className="badge ok">Lv {b.level}</span>}
          {b.enemy && <span className="badge bad">Hostile</span>}
          {!b.enemy && !b.powered && <span className="badge bad">No power</span>}
          {b.jobs > 0 && !b.enemy && (
            <span className={`badge ${b.status === 'ok' ? 'ok' : 'bad'}`}>{STATUS_TEXT[b.status]}</span>
          )}
        </div>
        <div className="hp-row small">
          <div className="hpbar wide">
            <div className="hpfill" style={{ width: `${hpFrac * 100}%`, background: hpFrac < 0.35 ? 'var(--red)' : undefined }} />
          </div>
          <span className="muted">
            {b.hp}/{b.maxHp}
          </span>
        </div>
        {!b.recruit && !b.trade && !b.drones && !b.contracts && <div className="muted small">{b.description}</div>}
        {b.jobs > 0 && !b.enemy && (
          <div className="small">
            Workers {b.workers}/{b.jobs}
          </div>
        )}
        {b.storage && !b.enemy && <div className="small">{b.storage}</div>}
        {b.kind === 'armory' && !b.enemy && (
          <div className="small gear-list">
            Rifles {eco.gear[0]} · MGs {eco.gear[1]} · Scoped {eco.gear[2]} · Breach kits {eco.gear[3]} · AT launchers {eco.gear[4]}
          </div>
        )}
        {b.recipes && !b.enemy && (
          <div className="control-group">
            <div className="control-label">Producing</div>
            <Segmented
              options={b.recipes.options.map((o, i) => ({ key: String(i), name: o }))}
              value={b.recipes.selected}
              onChange={(i) => game.setRecipe(i)}
            />
          </div>
        )}
        {b.trade && (
          <div className="trade-grid">
            {b.trade.map((r) => (
              <div key={r.res} className="trade-row">
                <span className="trade-name">
                  {r.name} <span className="muted">({r.stock})</span>
                </span>
                <Btn onClick={() => game.trade(r.res, 5)} disabled={eco.funds < r.buy * 5} title={`Buy 5 for $${r.buy * 5}`}>
                  Buy 5 <span className="muted">${r.buy * 5}</span>
                </Btn>
                <Btn onClick={() => game.trade(r.res, -5)} disabled={r.stock < 5} title={`Sell 5 for $${r.sell * 5}`}>
                  Sell 5 <span className="muted">+${r.sell * 5}</span>
                </Btn>
              </div>
            ))}
          </div>
        )}
        {b.recruit && (
          <div className="recruit-grid">
            {b.recruit.map((r) => (
              <div key={r.kind} className={`recruit-card ${r.blocker ? 'cant' : ''}`} title={r.blocker ?? r.blurb}>
                <div className="recruit-name">{r.name}</div>
                <div className="recruit-cost">
                  {r.cost}
                  <span className="muted"> · {r.note ?? `${r.stock} in armory`}</span>
                </div>
                <div className="row nowrap">
                  <Btn className="primary" disabled={!!r.blocker} onClick={() => game.recruit(r.kind, 1)}>
                    +1
                  </Btn>
                  <Btn disabled={!!r.blocker} onClick={() => game.recruit(r.kind, 5)}>
                    +5
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
        {b.contracts && (
          <div className="recruit-grid">
            {b.contracts.map((ct) => (
              <div key={ct.index} className={`recruit-card ${ct.blocker ? 'cant' : ''}`} title={ct.blocker ?? ct.blurb}>
                <div className="recruit-name">{ct.name}</div>
                <div className="recruit-cost">
                  {ct.cost}
                  <span className="muted"> · {ct.blurb}</span>
                </div>
                <Btn className="primary" disabled={!!ct.blocker} onClick={() => game.hire(ct.index)}>
                  Hire
                </Btn>
              </div>
            ))}
          </div>
        )}
        {b.contracts && b.contracts.every((ct) => ct.blocker) && <div className="muted small">{b.contracts[0].blocker}</div>}
        {b.turret && (
          <div className="small">
            {b.turret.crewed ? '✓ Crewed: the gun fires on its own' : '✗ No crew: send a soldier up the tower (via stairs and walls)'} · belt {b.turret.ammo}/
            {b.turret.mag}
          </div>
        )}
        {b.drones && (
          <>
            <div className="small">
              Drones up {b.drones.count}/{b.drones.cap}
              {!b.powered && <span className="muted"> · needs power to launch and recharge</span>}
            </div>
            <div className="recruit-grid">
              {b.drones.options.map((d) => (
                <div key={d.kind} className={`recruit-card ${d.blocker ? 'cant' : ''}`} title={d.blocker ?? d.blurb}>
                  <div className="recruit-name">{d.name}</div>
                  <div className="recruit-cost">{d.cost}</div>
                  <div className="muted small drone-blurb">{d.blurb}</div>
                  <Btn className="primary" disabled={!!d.blocker} onClick={() => game.launchDrone(d.kind)}>
                    Launch
                  </Btn>
                </div>
              ))}
            </div>
          </>
        )}
        {b.recruit && b.recruit.every((r) => r.blocker) && (
          <div className="muted small">{b.recruit[0].blocker}: weapons come from an Arms Factory (needs steel).</div>
        )}
        {b.burning && <div className="small badge bad">🔥 Burning</div>}
        {b.upgrade && !b.enemy && (
          <div className="upgrade-row">
            <Btn className="primary" disabled={!!b.upgrade.blocker} onClick={() => game.upgradeSelected()} title={b.upgrade.blocker ?? b.upgrade.description}>
              ⬆ {b.upgrade.name}
            </Btn>
            <span className="small muted">
              {b.upgrade.description} · {b.upgrade.cost}
              {b.upgrade.blocker && b.upgrade.blocker !== 'Fully upgraded' ? ` · ${b.upgrade.blocker}` : ''}
            </span>
          </div>
        )}
        <div className="row">
          {b.ignite && (
            <Btn className="danger" onClick={() => game.igniteSelected()} title="Set it alight (needs one of your soldiers nearby)">
              🔥 Ignite
            </Btn>
          )}
          {b.controllable && (
            <Btn className="primary" onClick={() => game.takeControl()} title="Aim it yourself (F)">
              Take control{!useHud.getState().isTouch && <kbd>F</kbd>}
            </Btn>
          )}
          {b.rally !== null && (
            <Btn onClick={() => game.startOrder('rally')} title="New units head to a spot you pick (right-click the ground works too)">
              ⚑ {b.rally ? 'Move rally point' : 'Set rally point'}
              {!useHud.getState().isTouch && <kbd>Y</kbd>}
            </Btn>
          )}
          {b.rally && <Btn onClick={() => game.clearRally()}>Clear rally</Btn>}
          {b.jobs > 0 && !b.enemy && <Btn onClick={() => game.toggleSelectedActive()}>{b.active ? '❚❚ Pause' : '▶ Resume'}</Btn>}
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

const TARGETING: Record<'flare' | 'rally' | 'patrol' | 'attackMove', { title: string; note: string; where: string }> = {
  flare: { title: 'Flare', note: '$15 · lights an area for 30 s', where: 'where to fire it (near your soldiers)' },
  rally: { title: 'Rally point', note: 'new units from this building head there', where: 'the ground where they should gather' },
  patrol: { title: 'Patrol', note: 'back and forth from where they are, fighting on the way', where: 'the other end of the beat' },
  attackMove: { title: 'Attack-move', note: 'they stop to fight anything on the way', where: 'where to go' },
};

/** Overview map (top right): tap or drag to look somewhere; ⚠ jumps to the latest attack. */
function Minimap({ game }: { game: GameActions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const alertAt = useHud((s) => s.alertAt);
  const isTouch = useHud((s) => s.isTouch);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number): void => {
      raf = requestAnimationFrame(loop);
      if (t - last < 140) return;
      last = t;
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) game.drawMinimap(ctx, c.width, c.height);
      setNow(useHud.getState().simTime);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  const jump = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    game.minimapJump((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const recent = now - alertAt < 30;
  return (
    <div className="minimap panel">
      <canvas
        ref={ref}
        width={192}
        height={192}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) jump(e);
        }}
      />
      {recent && (
        <button type="button" className="minimap-alert" onClick={() => game.jumpToAlert()} title="Look at the latest attack (Tab)">
          ⚠{!isTouch && <kbd>Tab</kbd>}
        </button>
      )}
    </div>
  );
}

/** Phones: control groups. Tap to select (or, when empty, to save the current selection); hold to save. */
function GroupButtons({ game }: { game: GameActions }) {
  const groups = useHud((s) => s.groups);
  const count = useHud((s) => s.selectionCount);
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  if (!count && groups.every((g) => g === 0)) return null;
  return (
    <div className="group-buttons">
      {groups.map((g, k) => (
        <button
          key={k}
          type="button"
          className={`btn group-btn ${g ? 'filled' : ''}`}
          onPointerDown={() => {
            held.current = false;
            hold.current = window.setTimeout(() => {
              held.current = true;
              game.groupAssign(k + 1);
            }, 550);
          }}
          onPointerUp={() => {
            if (hold.current) clearTimeout(hold.current);
            hold.current = null;
            if (!held.current) game.groupSelect(k + 1);
          }}
          onPointerLeave={() => {
            if (hold.current) clearTimeout(hold.current);
            hold.current = null;
          }}
          title={g ? `Group ${k + 1}: ${g} (hold to replace with the selection)` : `Group ${k + 1}: tap or hold to save the selection`}
        >
          {k + 1}
          {g > 0 && <span className="group-count">{g}</span>}
        </button>
      ))}
    </div>
  );
}

function RtsPanel({ game }: { game: GameActions }) {
  const s = useHud();
  if (s.targeting) {
    const info = TARGETING[s.targeting];
    return (
      <div className="bottombar">
        <div className="panel selection">
          <div className="sel-label">
            <strong>{info.title}</strong> · <span className="muted">{info.note}</span>
          </div>
          <div className="place-status ok">
            {s.isTouch ? `Tap ${info.where}` : `Click ${info.where} · Esc cancels`}
          </div>
          <div className="row">
            <Btn onClick={() => game.cancelTargeting()}>✕ Cancel</Btn>
          </div>
        </div>
      </div>
    );
  }
  if (s.placing) return <PlacementPanel game={game} />;
  if (s.buildOpen || s.moraleOpen) return null; // these panels need the room (especially on phones)
  if (s.building) return <BuildingPanel game={game} />;
  return (
    <div className="bottombar">
      <div className="panel selection">
        {s.selectionCount > 0 ? (
          <>
            <div className="sel-label">
              <strong>{s.selectionCount}</strong> selected
              {s.selectionGroups.length <= 1 && <span className="muted"> · {s.selectionLabel}</span>}
            </div>
            {s.selectionGroups.length > 1 && (
              <div className="sel-chips" title="Tap a type to keep only those; × drops them from the selection">
                {s.selectionGroups.map((g) => (
                  <span key={g.kind} className="sel-chip">
                    <button type="button" className="sel-chip-main" onClick={() => game.selectKindOnly(g.kind)} title={`Keep only the ${g.name}s`}>
                      {g.count}× {g.name}
                    </button>
                    <button type="button" className="sel-chip-x" onClick={() => game.deselectKind(g.kind)} title={`Drop the ${g.name}s`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="muted small hint">
              {s.isTouch
                ? 'Tap ground to move · tap a wall top to man it · tap an enemy to attack'
                : 'Right-click: move · on a wall top: man it · on an enemy: attack'}
            </div>
            <div className="row">
              <Btn onClick={() => game.takeControl()} className="primary" title="Take direct control (F)">
                Take control{!s.isTouch && <kbd>F</kbd>}
              </Btn>
              <Btn
                onClick={() => game.startFlare()}
                disabled={s.flares <= 0}
                title={s.flares > 0 ? `Fire an illumination flare (V) · ${s.flares} left` : 'No flares left: one more every minute'}
              >
                🔦 Flare <span className="flare-count">{s.flares}</span>
                {!s.isTouch && <kbd>V</kbd>}
              </Btn>
              <Btn onClick={() => game.startOrder('attackMove')} title="Walk there, fighting anything on the way (X)">
                ⚔ {s.isTouch ? 'Advance' : 'Attack-move'}
                {!s.isTouch && <kbd>X</kbd>}
              </Btn>
              <Btn onClick={() => game.startOrder('patrol')} title="Walk back and forth between here and a spot you pick, fighting on the way (C)">
                ⇄ Patrol{!s.isTouch && <kbd>C</kbd>}
              </Btn>
              <Btn
                onClick={() => game.toggleHoldFire()}
                active={s.holdFire}
                title="Hold fire: they won't shoot (and give themselves away) unless you order an attack (Z)"
              >
                🤫 Hold fire{!s.isTouch && <kbd>Z</kbd>}
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
                ? 'Tap a soldier or building · Build to expand and fortify'
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
  const c = s.control;
  const hold = (on: boolean) => (e: ReactPointerEvent) => {
    e.preventDefault();
    game.setFire(on);
  };
  const scoped = !!c?.scope && s.aiming;
  const canFire = c ? (c.kind === 'drone' ? c.strike && !c.diving : c.mag > 0) : false;
  const fireLabel = c?.kind === 'drone' ? 'Dive' : 'Fire';
  const hint = (): string => {
    if (!c) return '';
    switch (c.kind) {
      case 'drone':
        return c.strike ? 'WASD fly · mouse look · LMB dive on the crosshair · Esc exit' : 'WASD fly · mouse look · spot for your troops · Esc exit';
      case 'turret':
        return 'Mouse aim · LMB fire · RMB zoom · R reload · Esc exit';
      case 'light':
        return 'Mouse to point the beam · Esc exit';
      case 'vehicle':
        return c.artillery
          ? 'WASD drive · stop to deploy · aim at the ground · LMB fire a shell · Esc exit'
          : c.dozer
            ? 'WASD drive · mouse aim · LMB fire · G push a ramp against a wall / fill a ditch · Esc exit'
            : 'WASD drive · mouse aim · LMB fire · RMB zoom · Esc exit';
      default:
        return `WASD move · LMB fire · RMB aim · R reload${c.charges ? ' · G plant charge' : ''} · V flare${c.nvgAvailable ? ' · N night vision' : ''} · T slow-mo · Esc exit`;
    }
  };
  return (
    <>
      {scoped ? <div className="scope" /> : <div className={`crosshair ${s.aiming ? 'aiming' : ''} ${c?.kind === 'light' ? 'light' : ''}`} />}
      {s.hitMarker && <div key={s.hitMarker.t} className={`hitmarker ${s.hitMarker.kind}`} />}
      {s.damage && (
        <div key={s.damage.t} className="damage-dir" style={{ transform: `rotate(${s.damage.angle}rad)` }}>
          <div className="damage-arc" />
        </div>
      )}
      {c && c.hp < 0.35 && c.kind !== 'light' && <div className="hurt-vignette" style={{ opacity: 0.35 + (0.35 - c.hp) * 1.5 }} />}
      <div className="control-top">
        <div className="panel control-status">
          <span className="muted">Controlling</span> <strong>{c?.name ?? s.controlledName}</strong>
          {c && c.squad > 0 && <span className="muted small"> · squad {c.squad}</span>}
          <div className="hpbar">
            <div className="hpfill" style={{ width: `${Math.max(0, c?.hp ?? s.controlledHp) * 100}%` }} />
          </div>
          {c?.battery !== null && c?.battery !== undefined && (
            <div className={`battery ${c.battery < 0.2 ? 'low' : ''}`}>
              <span>🔋 {c.batterySec}s</span>
              <div className="hpbar">
                <div className="hpfill battery-fill" style={{ width: `${c.battery * 100}%` }} />
              </div>
            </div>
          )}
          {c?.kind === 'turret' && !c.crewed && <div className="badge bad">Needs a soldier up top to fire</div>}
        </div>
        <Btn onClick={() => game.exitControl()} className="exit" title="Return to command view (Esc)">
          ✕ Exit
        </Btn>
      </div>
      {c && c.mag > 0 && (
        <div className={`panel ammo ${s.isTouch ? 'touch' : ''}`}>
          <span className={`ammo-count ${c.ammo <= Math.max(1, c.mag * 0.2) ? 'low' : ''}`}>{c.reload !== null ? '··' : c.ammo}</span>
          <span className="muted">/ {c.mag}</span>
          {c.charges > 0 &&
            (c.dozer ? (
              <span className="charges" title="Assault ramps left">
                ◢ {c.charges}
              </span>
            ) : (
              <span className="charges" title="Breach charges">
                💣 {c.charges}
              </span>
            ))}
          {c.reload !== null && (
            <div className="reload-bar">
              <div style={{ width: `${c.reload * 100}%` }} />
            </div>
          )}
        </div>
      )}
      {c?.plant !== null && c?.plant !== undefined && (
        <div className="panel plant-progress">
          {c.dozer ? 'Dozing…' : 'Planting charge…'}
          <div className="reload-bar">
            <div style={{ width: `${c.plant * 100}%` }} />
          </div>
        </div>
      )}
      {c?.diving && <div className="panel plant-progress">Diving…</div>}
      {c?.deploy !== null && c?.deploy !== undefined && c.deploy < 1 && (
        <div className="panel plant-progress">
          {c.deploy > 0 ? 'Deploying…' : 'Stop to deploy the gun'}
          <div className="reload-bar">
            <div style={{ width: `${c.deploy * 100}%` }} />
          </div>
        </div>
      )}
      {s.isTouch ? (
        <div className="touch-controls">
          {c?.kind !== 'turret' && c?.kind !== 'light' && <div className="move-hint">Drag here to move</div>}
          <div className="action-btns">
            <div className="side-btns">
              {c && c.mag > 0 && (
                <Btn onClick={() => game.reload()} className="round small-round">
                  Reload
                </Btn>
              )}
              {c && c.charges > 0 && c.kind === 'soldier' && (
                <Btn onClick={() => game.plantCharge()} className="round small-round">
                  Charge
                </Btn>
              )}
              {c?.dozer && (
                <Btn onClick={() => game.plantCharge()} className="round small-round" title="Push a ramp against a wall, or fill a ditch">
                  Ramp
                </Btn>
              )}
              {c?.nvgAvailable && (
                <Btn onClick={() => game.toggleNvg()} active={c.nvgOn} className="round small-round">
                  NVG
                </Btn>
              )}
            </div>
            {c?.kind !== 'light' && (
              <Btn onClick={() => game.toggleAim()} active={s.aiming} className="round aim">
                {c?.kind === 'drone' ? 'Zoom' : 'Aim'}
              </Btn>
            )}
            {canFire && (
              <button
                type="button"
                className="btn round fire"
                onPointerDown={hold(true)}
                onPointerUp={hold(false)}
                onPointerLeave={hold(false)}
                onPointerCancel={hold(false)}
              >
                {fireLabel}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="panel control-hint">{hint()}</div>
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

// ------------------------------------------------------------------ waves & results

function WavePill() {
  const wave = useHud((s) => s.wave);
  if (!wave) return null;
  const next = wave.nextIn;
  const soon = next !== null && next < 30;
  return (
    <div className={`panel wave-pill ${soon ? 'soon' : ''}`} title="Hold the Line: survive every wave">
      <span className="wave-label">Wave</span>
      <strong>
        {wave.index}/{wave.total}
      </strong>
      {next !== null ? (
        <span className="wave-next">
          <span className="lbl">next in </span>
          {formatDuration(next)}
        </span>
      ) : (
        <span className="wave-next">final wave</span>
      )}
      {wave.attackers > 0 && <span className="wave-attackers">{wave.attackers} attacking</span>}
    </div>
  );
}

function NvgOverlay() {
  const on = useHud((s) => s.nvg);
  return on ? <div className="nvg-overlay" /> : null;
}

function TauntRadio() {
  const taunt = useHud((s) => s.taunt);
  if (!taunt) return null;
  return (
    <div className="panel taunt" role="status">
      <span className="taunt-name">📻 {taunt.name}</span>
      <span className="taunt-text">“{taunt.text}”</span>
    </div>
  );
}

function TutorialCard({ game }: { game: GameActions }) {
  const t = useHud((s) => s.tutorial);
  const view = useHud((s) => s.view);
  const busy = useHud((s) => !!s.building || s.buildOpen || !!s.placing);
  const [hidden, setHidden] = useState(false);
  if (!t || t.finished) return null;
  // Small screens: tuck the card away while a panel or direct control needs the room.
  const cramped = typeof matchMedia !== 'undefined' && matchMedia('(max-height: 500px)').matches && (busy || view === 'control');
  if (hidden || cramped) {
    return (
      <button type="button" className={`panel tutorial-tab ${view === 'control' ? 'in-control' : ''}`} onClick={() => setHidden(false)}>
        📘 {t.index + 1}/{t.total}
      </button>
    );
  }
  return (
    <div className={`panel tutorial-card ${t.done ? 'done' : ''} ${view === 'control' ? 'in-control' : ''}`} role="status">
      <div className="tut-head">
        <span className="tut-step">
          Tutorial {t.index + 1}/{t.total}
        </span>
        <button type="button" className="tut-x" onClick={() => setHidden(true)} title="Hide">
          –
        </button>
      </div>
      <div className="tut-title">{t.done ? `✓ ${t.title}` : t.title}</div>
      {!t.done && <div className="tut-text">{t.text}</div>}
      <div className="tut-bar">
        <div style={{ width: `${((t.index + (t.done ? 1 : 0)) / t.total) * 100}%` }} />
      </div>
      {!t.done && (
        <button type="button" className="tut-skip" onClick={() => game.skipTutorialStep()}>
          Skip this step
        </button>
      )}
    </div>
  );
}

function ResultOverlay({ game }: { game: GameActions }) {
  const result = useHud((s) => s.result)!;
  const mode = useHud((s) => s.gameMode);
  const trail = useHud((s) => s.trail);
  const win = result.result === 'victory';
  return (
    <div className="modal-backdrop">
      <div className={`panel modal result ${win ? 'win' : 'lose'}`}>
        <h2>{win ? (mode === 'tutorial' ? 'Tutorial complete' : 'Victory') : 'Defeat'}</h2>
        <p>{result.reason}</p>
        {mode === 'tutorial' && win && (
          <p className="small">You know the basics. The Commander's Trail is next: eight commanders, each tougher than the last.</p>
        )}
        {trail && (
          <p className="small">
            {win
              ? trail.next
                ? `Commander's Trail: stage ${trail.stage + 1} cleared. Next up: ${trail.next.title}.`
                : `Commander's Trail complete: you've beaten every commander on it.`
              : `Commander's Trail stage ${trail.stage + 1}: ${trail.title}. Have another go.`}
          </p>
        )}
        <div className="row end">
          <Btn onClick={() => game.restart()}>Main menu</Btn>
          {trail?.next ? (
            <Btn className="primary" onClick={() => game.playTrail(trail.next!.stage)}>
              Next stage
            </Btn>
          ) : (
            <Btn className="primary" onClick={() => game.restart(mode)}>
              {trail && win ? 'Play again' : trail ? 'Try again' : 'Play again'}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ help & misc

function Help({ game }: { game: GameActions }) {
  const s = useHud();
  return (
    <div className="modal-backdrop" onClick={() => game.dismissHelp()}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {s.gameMode === 'hold'
            ? 'Hold the Line'
            : s.gameMode === 'tutorial'
              ? 'Tutorial'
              : s.trail
              ? `Commander's Trail ${s.trail.stage + 1}: ${s.trail.title}`
              : s.gameMode === 'skirmish'
                ? `Skirmish vs ${s.opponent?.name ?? 'AI'}`
                : 'Sandbox'}
        </h2>
        {s.opponent && (
          <p className="small">
            <b>{s.opponent.name}</b> ({s.opponent.title}, {s.opponent.difficulty}) on <b>{s.opponent.map}</b>: {s.opponent.blurb}
          </p>
        )}
        <p className="muted">
          {s.gameMode === 'hold'
            ? 'Six waves will attack from the east, two of them at night. Keep your HQ and Commander alive. '
            : s.gameMode === 'skirmish'
              ? `${s.opponent?.name} is building a fortress in the east and will attack once their army is ready. Destroy their HQ or kill their Commander, and protect yours. A Trade Post lets you sell surplus for funds; a Contracts Office hires ready-made teams. `
              : 'No waves: build at your own pace. '}
          Put troops <b>on the walls</b>: they get range and cover. Engineers can blow holes in walls and gates.
          To train more soldiers, idle civilians, weapons from the <b>Armory</b> and funds are needed. Weapons are made at an{' '}
          <b>Arms Factory</b> from steel (<b>Scrap Yard</b>).
        </p>
        <p className="muted">
          <b>At night</b> you only see enemies that are close, lit or making noise. <b>Floodlights</b> and{' '}
          <b>searchlights</b> need power from a <b>Generator</b>. <b>Flares</b> light up an area. Motion sensors and
          dogs catch sneaking troops. <b>SF Operators</b> (night-ops kits) see in the dark, fire silenced, climb walls
          and carry a demolition charge. Destroy the enemy's generators and their lights go dark.
        </p>
        <p className="muted">
          <b>Direct control:</b> take over any soldier and the rest of the selection follows you. Aim for the head: it
          does double damage (triple through a Marksman's scope). <b>Gun Towers</b> fire on their own while a soldier is
          up top, or aim them yourself. A <b>Drone Bay</b> launches recon drones (thermal eyes in the sky) and strike
          drones that dive onto a target.
        </p>
        {s.isTouch ? (
          <ul>
            <li>
              <b>Build</b> → pick → <b>tap</b> to position → <b>✓ Place</b>. Walls: tap the start, tap the end, place.
            </li>
            <li>
              Tap the <b>Barracks</b> to recruit. Tap a building for its status, or <b>Morale</b> for rations and taxes.
            </li>
            <li>
              Tap soldiers to select (double-tap for the squad). Tap ground to move, a <b>wall top</b> to man it, an{' '}
              <b>enemy</b> to attack. <b>Advance</b>, <b>Patrol</b> and <b>Hold fire</b> are in the bar; hold a{' '}
              <b>1–4</b> button to save a group.
            </li>
            <li>
              Tap the <b>map</b> (top right) to look somewhere; <b>⚠</b> jumps to where you're being attacked.
            </li>
            <li>
              <b>Take control</b> of a soldier, drone, gun tower or searchlight: left thumb moves, right thumb aims, hold{' '}
              <b>Fire</b>. Side buttons reload, plant charges and switch night vision.
            </li>
          </ul>
        ) : (
          <ul>
            <li>
              <b>B</b> builds. <b>Drag</b> to draw walls. <b>R</b> rotates gatehouses. Right-click or Esc stops placing.
            </li>
            <li>
              Click the <b>Barracks</b> to recruit. Click a building for status, or <b>Morale</b> for rations and taxes.
            </li>
            <li>
              Drag to select soldiers. <b>Right-click</b>: ground = move, wall top = man it, enemy = attack. <b>X</b>{' '}
              attack-move, <b>C</b> patrol, <b>Z</b> hold fire. <b>Ctrl+1–9</b> saves a group, <b>1–9</b> recalls it.
            </li>
            <li>
              The <b>map</b> (top right): click to look somewhere. When you're attacked you'll hear an alarm: <b>Tab</b>{' '}
              jumps there. With a Barracks or Motor Pool selected, right-click (or <b>Y</b>) sets its rally point.
            </li>
            <li>
              <b>F</b> takes direct control of a soldier, drone, gun tower or searchlight: WASD + mouse, <b>LMB</b> fire,{' '}
              <b>RMB</b> aim, <b>R</b> reload, <b>G</b> plant a charge, <b>V</b> flare, <b>N</b> night vision, <b>T</b>{' '}
              slow motion, <b>Esc</b> exit. <b>P</b> pauses.
            </li>
          </ul>
        )}
        <div className="test-tools">
          <span className="muted small">Test tools: jump the clock to</span>
          {(['dawn', 'day', 'dusk', 'night'] as PhaseName[]).map((p) => (
            <Btn key={p} onClick={() => game.skipToPhase(p)}>
              {PHASE_LABEL[p]}
            </Btn>
          ))}
        </div>
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
  const view = useHud((s) => s.view);
  const toast = useHud((s) => s.toast);
  const showHelp = useHud((s) => s.showHelp);
  const showSettings = useHud((s) => s.showSettings);
  const buildOpen = useHud((s) => s.buildOpen);
  const placing = useHud((s) => s.placing);
  const result = useHud((s) => s.result);
  const isTouch = useHud((s) => s.isTouch);
  return (
    <div className="hud">
      <TopBar game={game} />
      {view === 'rts' ? (
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
          <Minimap game={game} />
          {isTouch && !buildOpen && !placing && <GroupButtons game={game} />}
        </>
      ) : (
        <ControlOverlay game={game} />
      )}
      {toast && <div className={`toast panel ${view === 'control' ? 'low' : ''}`}>{toast}</div>}
      <NvgOverlay />
      <TauntRadio />
      <TutorialCard game={game} />
      {showHelp && <Help game={game} />}
      {showSettings && <SettingsPanel onClose={() => setHud({ showSettings: false })} />}
      {result && <ResultOverlay game={game} />}
      <PortraitHint />
    </div>
  );
}
