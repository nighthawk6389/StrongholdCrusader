import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { GameActions } from '../game/Game';
import type { PhaseName } from '../sim/clock';
import { useHud } from './store';

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

const PHASE_LABEL: Record<PhaseName, string> = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

function Btn(props: {
  onClick?: () => void;
  active?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn ${props.active ? 'active' : ''} ${props.className ?? ''}`}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

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
      <div className="spacer" />
      <div className="panel forces" title="Your forces vs hostile forces">
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

function RtsPanel({ game }: { game: GameActions }) {
  const s = useHud();
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
              <Btn onClick={() => game.selectAll()} title="Select all (Ctrl+A)">
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
                ? 'Tap a soldier to select · double-tap selects the squad · drag to pan · pinch to zoom'
                : 'Drag to select · right-click to move · F to take control · WASD/QE to move the camera'}
            </div>
            <div className="row">
              <Btn onClick={() => game.selectAll()} className="primary" title="Select all (Ctrl+A)">
                Select all
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

function Help({ game }: { game: GameActions }) {
  const s = useHud();
  return (
    <div className="modal-backdrop" onClick={() => game.dismissHelp()}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>Prototype M0: field test</h2>
        <p className="muted">
          Your walled outpost is in the west. A hostile outpost sits to the east with a patrol outside its gate.
          Day/night runs on an 8-minute cycle. Use <b>Time</b> to jump to night and see the floodlights.
        </p>
        {s.isTouch ? (
          <ul>
            <li>
              <b>Tap</b> a soldier to select. <b>Double-tap</b> selects all of that type on screen.
            </li>
            <li>
              <b>Tap the ground</b> to move the selection.
            </li>
            <li>
              <b>Drag</b> to pan, <b>pinch</b> to zoom, <b>twist</b> to rotate. <b>▢ Box</b> turns drag into box-select.
            </li>
            <li>
              <b>Take control</b> to fight over the shoulder: left thumb moves, right thumb aims, hold <b>Fire</b>.
            </li>
          </ul>
        ) : (
          <ul>
            <li>
              <b>Left-drag</b> box-select, <b>click</b> select, <b>double-click</b> selects the same type.
            </li>
            <li>
              <b>Right-click</b> move. <b>Right/middle-drag</b> rotate. <b>Wheel</b> zoom. <b>WASD</b>/edges pan,{' '}
              <b>Q/E</b> rotate.
            </li>
            <li>
              <b>F</b> takes direct control of a selected soldier: WASD + mouse, <b>LMB</b> fire, <b>RMB</b> aim, <b>Esc</b>{' '}
              exit.
            </li>
            <li>
              <b>Ctrl+1–9</b> assign group, <b>1–9</b> recall, <b>Space</b> center, <b>H</b> base, <b>P</b> pause.
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
  return (
    <div className="hud">
      <TopBar game={game} />
      {mode === 'rts' ? <RtsPanel game={game} /> : <ControlOverlay game={game} />}
      {toast && <div className="toast panel">{toast}</div>}
      {showHelp && <Help game={game} />}
      <PortraitHint />
    </div>
  );
}
