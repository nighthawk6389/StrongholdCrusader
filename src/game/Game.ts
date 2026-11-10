import * as THREE from 'three';
import { TICK_SEC, formatHour, type PhaseName } from '../sim/clock';
import { createM0Scenario, ENEMY } from '../sim/scenario';
import type { Sim } from '../sim/sim';
import { UNIT_TYPES } from '../sim/unitTypes';
import { GameRenderer, detectQuality } from '../render/GameRenderer';
import { InputController } from '../input/InputController';
import { setHud } from '../ui/store';

const MAX_STEPS_PER_FRAME = 8;
const NO_SELECTION: ReadonlySet<number> = new Set();

/** Public actions the HUD can call. */
export interface GameActions {
  setSpeed(speed: number): void;
  togglePause(): void;
  takeControl(): void;
  exitControl(): void;
  selectAll(): void;
  deselect(): void;
  setSelectMode(on: boolean): void;
  skipToPhase(phase: PhaseName): void;
  setFire(on: boolean): void;
  toggleAim(): void;
  toggleFullscreen(): void;
  dismissHelp(): void;
  showHelp(): void;
  requestPointerLock(): void;
  centerOnBase(): void;
}

export class Game implements GameActions {
  readonly sim: Sim;
  readonly player: number;
  readonly renderer: GameRenderer;
  readonly input: InputController;
  readonly selected = new Set<number>();
  controlled = -1;

  private speed = 1;
  private paused = false;
  private acc = 0;
  private last = 0;
  private hudTimer = 0;
  private frames = 0;
  private fpsTimer = 0;
  private simMsAcc = 0;
  private simSteps = 0;
  private toastTimer = 0;
  private readonly basePos: { x: number; z: number };

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    const scenario = createM0Scenario(Number(new URLSearchParams(location.search).get('seed')) || 1337);
    this.sim = scenario.sim;
    this.player = scenario.player;
    this.basePos = scenario.playerBase;
    const quality = detectQuality();
    this.renderer = new GameRenderer(canvas, this.sim, quality);
    this.renderer.rts.jumpTo(scenario.playerBase.x + 8, scenario.playerBase.z + 2);
    this.input = new InputController(canvas, overlay, this);

    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    let seenHelp = false;
    try {
      seenHelp = localStorage.getItem('m0-help-seen') === '1';
    } catch {
      /* storage unavailable */
    }
    setHud({
      isTouch,
      quality: quality.name,
      debug: new URLSearchParams(location.search).has('debug'),
      showHelp: !seenHelp,
    });
    window.addEventListener('resize', () => this.renderer.resize());
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) this.acc += dt * this.speed;

    this.input.update(dt);

    const t0 = performance.now();
    let steps = 0;
    while (this.acc >= TICK_SEC && steps < MAX_STEPS_PER_FRAME) {
      if (this.controlled >= 0) {
        const c = this.input.controlIntent();
        this.sim.enqueue({ type: 'control', owner: this.player, id: this.controlled, ...c });
      }
      this.sim.step();
      this.acc -= TICK_SEC;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    if (steps > 0) {
      this.simMsAcc += performance.now() - t0;
      this.simSteps += steps;
    }

    // Drop dead units from selection / control.
    const u = this.sim.units;
    for (const id of this.selected) if (!u.isAlive(id)) this.selected.delete(id);
    if (this.controlled >= 0 && !u.isAlive(this.controlled)) {
      this.toast('Your unit was killed');
      this.exitControl();
    }

    this.renderer.render({
      alpha: this.paused ? 1 : this.acc / TICK_SEC,
      dt,
      selected: this.controlled >= 0 ? NO_SELECTION : this.selected,
      controlled: this.controlled,
      events: this.sim.drainEvents(),
    });

    this.frames++;
    this.fpsTimer += dt;
    this.hudTimer += dt;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) setHud({ toast: null });
    }
    if (this.hudTimer > 0.2) {
      this.hudTimer = 0;
      this.pushHud();
    }
    if (this.fpsTimer >= 1) {
      setHud({
        fps: Math.round(this.frames / this.fpsTimer),
        simMs: this.simSteps ? +(this.simMsAcc / this.simSteps).toFixed(2) : 0,
      });
      this.frames = 0;
      this.fpsTimer = 0;
      this.simMsAcc = 0;
      this.simSteps = 0;
    }
  }

  private pushHud(): void {
    const info = this.sim.cycle;
    const u = this.sim.units;
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      if (u.owner[i] === this.player) mine++;
      else if (u.owner[i] === ENEMY) theirs++;
    }
    const counts = new Map<string, number>();
    let canControl = false;
    for (const id of this.selected) {
      const t = UNIT_TYPES[u.kind[id]];
      counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
      if (t.controllable) canControl = true;
    }
    const label = [...counts.entries()].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
    const c = this.controlled;
    setHud({
      clock: formatHour(info.hour),
      phase: info.phase,
      day: info.day + 1,
      selectionCount: this.selected.size,
      selectionLabel: label,
      canControl,
      playerUnits: mine,
      enemyUnits: theirs,
      controlledHp: c >= 0 ? u.hp[c] / UNIT_TYPES[u.kind[c]].hp : 1,
      controlledName: c >= 0 ? UNIT_TYPES[u.kind[c]].name : '',
      aiming: this.renderer.ots.aiming,
    });
  }

  toast(msg: string): void {
    setHud({ toast: msg });
    this.toastTimer = 2.5;
  }

  // ---------------------------------------------------------------- orders / selection

  issueMove(x: number, z: number): void {
    if (this.selected.size === 0) return;
    this.sim.enqueue({ type: 'move', owner: this.player, ids: [...this.selected], x, z });
    this.renderer.fx.moveMarker(x, z);
  }

  select(ids: number[], additive: boolean): void {
    if (!additive) this.selected.clear();
    for (const id of ids) {
      if (this.sim.units.isAlive(id) && this.sim.units.owner[id] === this.player) this.selected.add(id);
    }
    this.pushHud();
  }

  selectAll(): void {
    const u = this.sim.units;
    const ids: number[] = [];
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === this.player) ids.push(i);
    this.select(ids, false);
  }

  deselect(): void {
    this.selected.clear();
    this.pushHud();
  }

  setSelectMode(on: boolean): void {
    setHud({ selectMode: on });
  }

  // ---------------------------------------------------------------- direct control

  takeControl(): void {
    if (this.controlled >= 0) return;
    const u = this.sim.units;
    let pick = -1;
    for (const id of this.selected) {
      if (UNIT_TYPES[u.kind[id]].controllable) {
        pick = id;
        break;
      }
    }
    if (pick < 0) {
      this.toast('Select a unit first');
      return;
    }
    this.controlled = pick;
    this.selected.clear();
    this.selected.add(pick);
    // Face "up the screen" from the RTS view so the player keeps their bearings.
    this.renderer.ots.yaw = this.renderer.rts.yaw + Math.PI;
    this.renderer.ots.pitch = -0.08;
    this.renderer.ots.aiming = false;
    this.renderer.director.startSwoop();
    this.input.enterControl();
    setHud({ mode: 'control' });
    this.pushHud();
  }

  exitControl(): void {
    if (this.controlled < 0) return;
    const id = this.controlled;
    this.sim.enqueue({ type: 'release', owner: this.player, id });
    this.controlled = -1;
    const u = this.sim.units;
    if (u.isAlive(id)) this.renderer.rts.lookAtSoft(u.x[id], u.z[id]);
    this.renderer.director.startSwoop();
    this.renderer.ots.aiming = false;
    this.input.exitControl();
    setHud({ mode: 'rts', aiming: false });
  }

  setFire(on: boolean): void {
    this.input.fireHeld = on;
  }

  toggleAim(): void {
    this.renderer.ots.aiming = !this.renderer.ots.aiming;
    setHud({ aiming: this.renderer.ots.aiming });
  }

  requestPointerLock(): void {
    this.input.lockPointer();
  }

  // ---------------------------------------------------------------- time / misc

  setSpeed(speed: number): void {
    this.speed = speed;
    this.paused = false;
    setHud({ speed, paused: false });
  }

  togglePause(): void {
    this.paused = !this.paused;
    setHud({ paused: this.paused });
  }

  skipToPhase(phase: PhaseName): void {
    this.sim.skipToPhase(phase);
    this.pushHud();
  }

  centerOnBase(): void {
    this.renderer.rts.lookAtSoft(this.basePos.x + 6, this.basePos.z);
  }

  toggleFullscreen(): void {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(
        () => {
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          o.lock?.('landscape').catch(() => undefined);
        },
        () => this.toast('Fullscreen not available here'),
      );
    } else {
      document.exitFullscreen?.();
    }
  }

  dismissHelp(): void {
    setHud({ showHelp: false });
    try {
      localStorage.setItem('m0-help-seen', '1');
    } catch {
      /* storage unavailable */
    }
  }

  showHelp(): void {
    setHud({ showHelp: true });
  }

  /** Interpolated position of a unit (used by input for picking). */
  unitScreenAnchor(id: number, out: THREE.Vector3): THREE.Vector3 {
    return this.renderer.units.unitPosition(id, 1, out).setY(out.y + 0.55);
  }
}
