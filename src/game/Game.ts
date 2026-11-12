import * as THREE from 'three';
import { TICK_SEC, formatHour, type PhaseName } from '../sim/clock';
import { TAX_LEVELS } from '../sim/economy';
import { createScenario, ENEMY, type GameMode, type Scenario } from '../sim/scenario';
import { loadSim, saveSim } from '../sim/save';
import { clearGame, writeGame, type StoredGame } from './saveSlot';
import type { Sim, SimEvent } from '../sim/sim';
import { PRICES, RES_INFO, Res, STRUCTURE_DEFS, costText, footprint, maxHp, nextUpgrade, type ResId, type StructureKind } from '../sim/structures';
import type { Difficulty } from '../sim/ai';
import { DRONE_KINDS, RECRUITABLE, UNIT_TYPES, UnitKind, VEHICLES } from '../sim/unitTypes';
import { DRONE_COST } from '../sim/drones';
import { CONTRACTS } from '../sim/contracts';
import { audio, type Listener } from '../audio/AudioEngine';
import { getSettings, onSettings } from './settings';
import { TUTORIAL_STEPS, Tutorial } from './tutorial';
import { useHud } from '../ui/store';
import { MAPS } from '../sim/maps';
import { TRAIL, clearTrailStage, setupQuery, trailSetup, type MatchSetup } from './setup';
import { DOZER_FILL_SEC } from '../sim/combat';
import { Order, STANCE_HOLD_FIRE } from '../sim/units';
import { RALLY_KINDS } from '../sim/sim';
import { minimapTerrain } from '../render/minimap';
import { GameRenderer, detectQuality } from '../render/GameRenderer';
import { InputController } from '../input/InputController';
import { setHud, type BuildingInfo, type ControlInfo as HudControl, type PlacingInfo } from '../ui/store';

const MAX_STEPS_PER_FRAME = 8;
const NO_SELECTION: ReadonlySet<number> = new Set();
const HELP_KEY = 'm5-help-seen';
const SLOWMO_KEY = 'slowmo';
/** Real seconds between autosaves while playing. */
const AUTOSAVE_SEC = 30;
/** Structures you can take direct control of. */
const CONTROLLABLE_STRUCTURES: StructureKind[] = ['guntower', 'searchlight'];
/** Buildings whose facing matters (lights): auto-aimed away from the HQ, R turns them. */
const AIMABLE: StructureKind[] = ['floodlight', 'searchlight'];

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
  startPlacing(kind: StructureKind): void;
  cancelPlacing(): void;
  confirmPlacing(): void;
  rotatePlacement(): void;
  setRations(level: number): void;
  setTax(level: number): void;
  demolishSelected(): void;
  toggleSelectedActive(): void;
  deselectStructure(): void;
  setBuildOpen(open: boolean): void;
  setMoraleOpen(open: boolean): void;
  recruit(kind: number, count: number): void;
  hire(contract: number): void;
  setRecipe(index: number): void;
  trade(res: number, amount: number): void;
  setNightShift(on: boolean): void;
  startFlare(): void;
  cancelTargeting(): void;
  restart(mode?: GameMode): void;
  /** Start a Commander's Trail stage. */
  playTrail(stage: number): void;
  skipTutorialStep(): void;
  reload(): void;
  plantCharge(): void;
  toggleNvg(): void;
  toggleSlowMo(): void;
  flareAtCrosshair(): void;
  launchDrone(kind: number): void;
  igniteSelected(): void;
  upgradeSelected(): void;
  /** Keep only this unit type in the selection / drop it from the selection. */
  selectKindOnly(kind: number): void;
  deselectKind(kind: number): void;
  /** Next tap/click on the ground sets a rally point (selected building) or sends the selection on patrol / attack-move. */
  startOrder(kind: 'rally' | 'patrol' | 'attackMove'): void;
  clearRally(): void;
  /** Hold fire on/off for the selected soldiers. */
  toggleHoldFire(): void;
  /** Camera to the most recent "under attack" alert (repeat to cycle back through them). */
  jumpToAlert(): void;
  /** Control groups 1–9 (shared by the number keys and the phone buttons). */
  groupSelect(n: number, additive?: boolean): void;
  groupAssign(n: number): void;
  drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** Centre the camera on a minimap point (fractions of the map). */
  minimapJump(fx: number, fz: number): void;
}

export type Targeting = 'flare' | 'rally' | 'patrol' | 'attackMove';

function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

/** Bresenham line between two tiles (inclusive). */
export function tileLine(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dz = -Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx + dz;
  let x = x0;
  let z = z0;
  for (let guard = 0; guard < 512; guard++) {
    out.push([x, z]);
    if (x === x1 && z === z1) break;
    const e2 = 2 * err;
    if (e2 >= dz) {
      err += dz;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      z += sz;
    }
  }
  return out;
}

export class Game implements GameActions {
  readonly sim: Sim;
  readonly mode: GameMode;
  readonly player: number;
  readonly renderer: GameRenderer;
  readonly input: InputController;
  readonly selected = new Set<number>();
  controlled = -1;
  /** Gun tower or searchlight being aimed by hand (-1 = none). */
  controlledStruct = -1;
  /** Kind of the possessed unit (to tell a strike drone's hit from a death). */
  private controlledKind = -1;
  /** Squad members told to follow the possessed unit. */
  private followers: number[] = [];
  private slowMo = false;
  private lastHit = { unit: -1, at: 0 };
  /** Tutorial mode: the step tracker and what it watches. */
  private tutorial: Tutorial | null = null;
  private tut = { recruited: 0, moved: false, camStart: { x: 0, z: 0, yaw: 0, dist: 0 }, refresh: 0 };
  readonly seed: number;
  /** What this match is (mode, opponent, map, trail stage). */
  readonly setup: MatchSetup;
  readonly difficulty: Difficulty;
  /** Navigating away on purpose (restart / main menu): don't autosave over the cleared slot. */
  private leaving = false;
  private autosaveTimer = 0;
  private pausedForAway = false;
  private warnedStorage = false;
  /** Building being placed, its rotation, and the footprint origin currently previewed. */
  placing: StructureKind | null = null;
  placeRot = 0;
  /** Extra quarter turns the player added to a light's automatic facing. */
  private aimTurns = 0;
  /** Waiting for a click/tap to fire a flare. */
  targeting: Targeting | null = null;
  /** Control groups (number → unit ids). */
  readonly groups = new Map<number, number[]>();
  /** Recent "under attack" alerts (sim seconds), newest last. */
  private alerts: { x: number; z: number; at: number }[] = [];
  private alertCursor = -1;
  private lastAlertAt = -1e9;
  /** Per area (16-tile cells): when it last raised an alert. */
  private alertCells = new Map<number, number>();
  private miniTerrain: HTMLCanvasElement | null = null;
  private placeTile: { tx: number; tz: number } | null = null;
  /** Wall line: anchor tile and current end tile. */
  wallAnchor: { tx: number; tz: number } | null = null;
  private wallEnd: { tx: number; tz: number } | null = null;
  selectedStructure = -1;
  private lastDepartToast = -1e9;

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
  private tauntTimer = 0;
  private readonly basePos: { x: number; z: number };

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, setup: MatchSetup, resume: StoredGame | null = null) {
    const params = new URLSearchParams(location.search);
    const mode = setup.mode;
    let difficulty: Difficulty = setup.difficulty;
    let seed = setup.seed;
    let scenario: Scenario | null = null;
    let loadFailed = false;
    if (resume) {
      try {
        scenario = loadSim(resume.save);
        difficulty = resume.meta.difficulty;
        seed = resume.meta.seed;
      } catch {
        // An old or damaged save: start fresh rather than crash.
        clearGame();
        scenario = null;
        loadFailed = true;
      }
    }
    if (!scenario) scenario = createScenario(mode, seed, difficulty, { opponent: setup.opponent, map: setup.map });
    this.setup = { ...setup, difficulty, seed };
    this.seed = seed;
    this.difficulty = difficulty;
    this.sim = scenario.sim;
    this.mode = mode;
    this.player = scenario.player;
    this.basePos = scenario.playerBase;
    const quality = detectQuality();
    this.renderer = new GameRenderer(canvas, this.sim, quality);
    this.renderer.rts.jumpTo(scenario.playerBase.x + 8, scenario.playerBase.z + 2);
    this.input = new InputController(canvas, overlay, this);

    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    let seenHelp = false;
    try {
      this.slowMo = localStorage.getItem(SLOWMO_KEY) === '1';
      seenHelp = localStorage.getItem(HELP_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    const label = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[difficulty];
    setHud({
      isTouch,
      gameMode: mode,
      opponent: scenario.ai
        ? {
            name: scenario.ai.personality.name,
            difficulty: label,
            title: scenario.ai.personality.title,
            blurb: scenario.ai.personality.blurb,
            map: MAPS[setup.map].name,
          }
        : null,
      trail: setup.trail !== null ? { stage: setup.trail, title: TRAIL[setup.trail].title, next: null } : null,
      quality: quality.name,
      debug: params.has('debug'),
      showHelp: !seenHelp && getSettings().showHints && mode !== 'tutorial',
      slowMo: this.slowMo,
    });
    window.addEventListener('resize', () => this.renderer.resize());
    if (mode === 'tutorial') {
      this.tutorial = new Tutorial();
      const r = this.renderer.rts;
      this.tut.camStart = { x: r.target.x, z: r.target.z, yaw: r.yaw, dist: r.dist };
    }
    if (resume && !loadFailed) this.resumeFrom(resume);
    if (loadFailed) this.toast("Couldn't load your saved game, so here's a fresh one", 4);

    // Leaving the screen (app switch, tab change, lock screen, closing): pause and save.
    // Sound: browsers only start audio after a gesture; volumes follow the settings.
    audio.setVolumes(getSettings());
    onSettings((s) => audio.setVolumes(s));
    const unlock = (): void => audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => audio.setSuspended(document.hidden));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onLeave();
      else if (this.pausedForAway) {
        this.pausedForAway = false;
        this.toast(isTouchDevice() ? 'Paused while you were away: tap ▶ to carry on' : 'Paused while you were away: press P to carry on', 4);
      }
    });
    window.addEventListener('pagehide', () => this.onLeave());
  }

  /** Put the camera back, release anyone you were possessing, and wait paused for the player. */
  private resumeFrom(g: StoredGame): void {
    const u = this.sim.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.player) continue;
      if (u.order[i] === Order.Control || u.order[i] === Order.Follow) {
        u.order[i] = Order.Idle;
        u.vx[i] = u.vz[i] = 0;
        u.plantTimer[i] = 0;
      }
    }
    this.renderer.rts.jumpTo(g.view.x, g.view.z);
    this.renderer.rts.setView(g.view.yaw, g.view.dist);
    this.speed = g.view.speed || 1;
    this.paused = true;
    setHud({ speed: this.speed, paused: true, showHelp: false });
    this.toast(isTouchDevice() ? 'Welcome back! Paused: tap ▶ to carry on' : 'Welcome back! Paused: press P to carry on', 5);
  }

  private onLeave(): void {
    if (this.leaving || this.sim.result) return;
    if (!this.paused) {
      this.paused = true;
      this.pausedForAway = true;
      setHud({ paused: true });
    }
    this.saveNow();
  }

  /** Write the autosave slot. Returns false if nothing was saved. */
  saveNow(): boolean {
    if (this.leaving || this.sim.result) return false;
    const info = this.sim.cycle;
    const rts = this.renderer.rts;
    const ok = writeGame({
      meta: {
        mode: this.mode,
        difficulty: this.difficulty,
        seed: this.seed,
        opponent: this.setup.opponent,
        map: this.setup.map,
        trail: this.setup.trail,
        label: `Day ${info.day + 1} · ${formatHour(info.hour)}`,
        savedAt: Date.now(),
      },
      save: saveSim(this.sim, this.mode, this.seed, this.difficulty, { opponent: this.setup.opponent, map: this.setup.map }),
      view: { x: rts.target.x, z: rts.target.z, yaw: rts.yaw, dist: rts.dist, speed: this.speed },
    });
    if (!ok && !this.warnedStorage) {
      this.warnedStorage = true;
      this.toast("Couldn't save: this browser isn't letting the game store data", 4);
    }
    return ok;
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
    const slow = this.slowMo && (this.controlled >= 0 || this.controlledStruct >= 0) ? 0.5 : 1;
    if (!this.paused) this.acc += dt * this.speed * slow;
    if (!this.paused) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= AUTOSAVE_SEC) {
        this.autosaveTimer = 0;
        this.saveNow();
      }
    }

    this.input.update(dt);

    const t0 = performance.now();
    let steps = 0;
    while (this.acc >= TICK_SEC && steps < MAX_STEPS_PER_FRAME) {
      if (this.controlled >= 0) {
        const c = this.input.controlIntent();
        const aim = this.renderer.aimRay();
        this.sim.enqueue({ type: 'control', owner: this.player, id: this.controlled, ...c, ...aim });
      } else if (this.controlledStruct >= 0) {
        const c = this.input.controlIntent();
        const aim = this.renderer.aimRay();
        this.sim.enqueue({
          type: 'controlStructure',
          owner: this.player,
          id: this.controlledStruct,
          ...aim,
          fire: c.fire,
          aim: c.aim,
          reload: c.reload,
        });
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
    for (const id of this.selected) if (!u.isAlive(id) || u.owner[id] !== this.player) this.selected.delete(id);
    if (this.controlled >= 0 && !u.isAlive(this.controlled)) {
      this.toast(this.controlledKind === UnitKind.StrikeDrone ? 'Strike drone hit' : 'Your unit was killed');
      this.exitControl();
    }
    if (this.controlledStruct >= 0 && !this.sim.structureById(this.controlledStruct)) this.exitControl();

    const events = this.sim.drainEvents();
    this.handleEvents(events);
    this.playSounds(events);
    if (this.tutorial) this.updateTutorial(dt, events);
    audio.update(dt, this.sim.cycle.daylight, this.paused || !!this.sim.result);
    if (this.selectedStructure >= 0 && !this.sim.structureById(this.selectedStructure)) this.deselectStructure();
    const rs = this.selectedStructure >= 0 ? this.sim.structureById(this.selectedStructure) : undefined;
    this.renderer.setRallyMarker(rs && rs.owner === this.player && rs.rallyX !== undefined && rs.rallyZ !== undefined ? { x: rs.rallyX, z: rs.rallyZ } : null);
    this.renderer.render({
      alpha: this.paused ? 1 : this.acc / TICK_SEC,
      dt,
      gameDt: this.paused || this.sim.result ? 0 : dt * this.speed * (this.slowMo && (this.controlled >= 0 || this.controlledStruct >= 0) ? 0.5 : 1),
      selected: this.controlled >= 0 || this.controlledStruct >= 0 ? NO_SELECTION : this.selected,
      controlled: this.controlled,
      controlledStruct: this.controlledStruct,
      events,
    });

    this.frames++;
    this.fpsTimer += dt;
    this.hudTimer += dt;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) setHud({ toast: null });
    }
    if (this.tauntTimer > 0) {
      this.tauntTimer -= dt;
      if (this.tauntTimer <= 0) setHud({ taunt: null });
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
      if (!u.alive[i] || !UNIT_TYPES[u.kind[i]].armed) continue;
      if (u.owner[i] === this.player) mine++;
      else if (u.owner[i] === ENEMY) theirs++;
    }
    const counts = new Map<string, number>();
    const byKind = new Map<number, number>();
    let canControl = false;
    for (const id of this.selected) {
      const t = UNIT_TYPES[u.kind[id]];
      counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
      byKind.set(t.id, (byKind.get(t.id) ?? 0) + 1);
      if (t.controllable) canControl = true;
    }
    const selectionGroups = [...byKind.entries()]
      .map(([kind, count]) => ({ kind, name: UNIT_TYPES[kind].name, count }))
      .sort((a, b) => b.count - a.count || a.kind - b.kind);
    const label = [...counts.entries()].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
    const c = this.controlled;
    const p = this.sim.economy.player(this.player);
    const dir = this.sim.director;
    setHud({
      eco: {
        funds: p.funds,
        timber: p.stock[Res.Timber],
        concrete: p.stock[Res.Concrete],
        steel: p.stock[Res.Steel],
        fuel: p.stock[Res.Fuel],
        produce: p.stock[Res.Produce],
        meat: p.stock[Res.Meat],
        gear: [Res.Rifle, Res.MG, Res.Scoped, Res.Charges, Res.Launcher].map((r) => Math.floor(p.stock[r])),
        materialsCap: p.materialsCap,
        foodCap: p.foodCap,
        gearCap: p.gearCap,
        population: p.population,
        idle: p.idle,
        housing: p.housing,
        morale: p.morale,
        trend: p.moraleTrend / 20,
        factors: p.factors,
        rationLevel: p.rationLevel,
        taxLevel: p.taxLevel,
        foodSeconds: p.foodSeconds,
        taxPerMin: p.population * TAX_LEVELS[p.taxLevel].perMin,
      },
      wave: dir
        ? { index: dir.next, total: dir.total, nextIn: dir.nextIn(this.sim), attackers: dir.alive.size }
        : null,
      power: { supply: p.powerSupply, demand: p.powerDemand },
      nightShift: p.nightShift,
      flares: p.flares,
      nvg: this.renderer.nvg,
      targeting: this.targeting,
      placing: this.placingInfo(),
      building: this.buildingInfo(),
      clock: formatHour(info.hour),
      phase: info.phase,
      day: info.day + 1,
      selectionCount: this.selected.size,
      selectionLabel: label,
      selectionGroups,
      canControl,
      playerUnits: mine,
      enemyUnits: theirs,
      controlledHp: c >= 0 ? u.hp[c] / UNIT_TYPES[u.kind[c]].hp : 1,
      controlledName: c >= 0 ? UNIT_TYPES[u.kind[c]].name : '',
      control: this.controlInfo(),
      aiming: this.renderer.ots.aiming,
      holdFire: this.selected.size > 0 && [...this.selected].every((id) => u.stance[id] === STANCE_HOLD_FIRE),
      groups: [1, 2, 3, 4].map((n) => (this.groups.get(n) ?? []).filter((id) => u.isAlive(id) && u.owner[id] === this.player).length),
      simTime: this.sim.timeSec,
    });
  }

  private controlInfo(): HudControl | null {
    const u = this.sim.units;
    const c = this.controlled;
    const base = {
      deploy: null,
      artillery: false,
      ammo: 0,
      mag: 0,
      reload: null,
      charges: 0,
      dozer: false,
      plant: null,
      battery: null,
      batterySec: 0,
      strike: false,
      diving: false,
      crewed: false,
      nvgAvailable: false,
      nvgOn: this.renderer.nvgEnabled,
      scope: false,
      squad: 0,
    };
    if (c >= 0 && u.isAlive(c)) {
      const t = UNIT_TYPES[u.kind[c]];
      return {
        ...base,
        kind: t.fly ? 'drone' : t.vehicle ? 'vehicle' : 'soldier',
        deploy: t.artillery ? u.deploy[c] : null,
        artillery: !!t.artillery,
        name: t.name,
        hp: u.hp[c] / t.hp,
        ammo: u.ammo[c],
        mag: t.mag,
        reload: u.reload[c] > 0 ? 1 - u.reload[c] / t.reloadSec : null,
        charges: u.charges[c],
        dozer: t.dozer,
        plant:
          u.plantTimer[c] > 0
            ? 1 - u.plantTimer[c] / (t.dozer && this.sim.structureById(u.targetStruct[c])?.kind === 'ditch' ? DOZER_FILL_SEC : t.plantSec)
            : null,
        battery: t.fly ? Math.max(0, u.battery[c] / t.battery) : null,
        batterySec: Math.max(0, Math.round(u.battery[c])),
        strike: !!t.blast,
        diving: u.order[c] === Order.Dive,
        nvgAvailable: t.nightVision >= 0.8,
        scope: t.zoom >= 3,
        squad: this.followers.filter((id) => u.isAlive(id) && u.order[id] === Order.Follow).length,
      };
    }
    const s = this.controlledStruct >= 0 ? this.sim.structureById(this.controlledStruct) : undefined;
    if (!s) return null;
    const def = STRUCTURE_DEFS[s.kind];
    const spec = def.turret;
    return {
      ...base,
      kind: spec ? 'turret' : 'light',
      name: def.name,
      hp: s.hp / def.hp,
      ammo: s.ammo,
      mag: spec?.mag ?? 0,
      reload: spec && s.reload > 0 ? 1 - s.reload / spec.reloadSec : null,
      crewed: spec ? this.sim.combat.crewed(s) : true,
    };
  }

  private updateTutorial(dt: number, events: SimEvent[]): void {
    const t = this.tutorial!;
    const u = this.sim.units;
    for (const e of events) if (e.type === 'recruited' && e.owner === this.player) this.tut.recruited++;
    if (!this.tut.moved) {
      for (let i = 0; i < u.count && !this.tut.moved; i++) {
        if (u.alive[i] && u.owner[i] === this.player && UNIT_TYPES[u.kind[i]].armed && u.order[i] === Order.Move) this.tut.moved = true;
      }
    }
    const r = this.renderer.rts;
    const c0 = this.tut.camStart;
    const cameraMoved =
      Math.hypot(r.target.x - c0.x, r.target.z - c0.z) > 6 || Math.abs(r.yaw - c0.yaw) > 0.4 || Math.abs(r.dist / c0.dist - 1) > 0.2;
    let selectedSoldiers = 0;
    for (const id of this.selected) if (UNIT_TYPES[u.kind[id]].armed) selectedSoldiers++;
    const changed = t.update(
      {
        sim: this.sim,
        player: this.player,
        cameraMoved,
        selectedSoldiers,
        controlling: this.controlled >= 0,
        moraleOpen: useHud.getState().moraleOpen,
        recruited: this.tut.recruited,
        moved: this.tut.moved,
      },
      dt,
    );
    this.tut.refresh -= dt;
    if (changed || this.tut.refresh <= 0) {
      this.tut.refresh = 0.5;
      this.pushTutorial();
    }
  }

  private pushTutorial(): void {
    const t = this.tutorial;
    if (!t) return;
    const step = t.step;
    setHud({
      tutorial: {
        index: Math.min(t.index, TUTORIAL_STEPS.length - 1),
        total: TUTORIAL_STEPS.length,
        title: step?.title ?? 'Tutorial complete',
        text: step ? (isTouchDevice() ? step.touch : step.desktop) : "You're ready. Try the Commander's Trail next.",
        done: t.celebrating,
        finished: t.finished,
      },
    });
  }

  skipTutorialStep(): void {
    this.tutorial?.skip();
    this.pushTutorial();
  }

  /** Where the "ears" are: the possessed unit, or the point the RTS camera looks at. */
  private listener(): Listener {
    const e = this.renderer.camera.matrixWorld.elements;
    const len = Math.hypot(e[0], e[2]) || 1;
    const u = this.sim.units;
    if (this.controlled >= 0 && u.isAlive(this.controlled)) {
      return { x: u.x[this.controlled], z: u.z[this.controlled], rx: e[0] / len, rz: e[2] / len, range: 10 };
    }
    const t = this.renderer.rts.target;
    return { x: t.x, z: t.z, rx: e[0] / len, rz: e[2] / len, range: Math.max(9, this.renderer.rts.dist * 0.45) };
  }

  private playSounds(events: SimEvent[]): void {
    if (!audio.ready || events.length === 0) return;
    const L = this.listener();
    const u = this.sim.units;
    const base = this.basePos;
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          const t = e.unit >= 0 ? UNIT_TYPES[u.kind[e.unit]] : null;
          const kind = !t ? 'mg' : t.silenced ? 'silenced' : t.ap || t.splash > 0.6 ? 'heavy' : t.mag >= 100 ? 'mg' : 'rifle';
          audio.play(kind, { x: e.fromX, z: e.fromZ }, L, 0.55);
          if (Math.hypot(e.fromX - base.x, e.fromZ - base.z) < 45 || Math.hypot(e.fromX - L.x, e.fromZ - L.z) < L.range * 2) {
            audio.intensity = Math.min(1, audio.intensity + 0.02);
          }
          break;
        }
        case 'explosion':
          audio.play('explosion', e, L);
          audio.intensity = Math.min(1, audio.intensity + 0.05);
          break;
        case 'shell':
          audio.play('mortar', { x: e.fromX, z: e.fromZ }, L, 0.8);
          if (Math.hypot(e.toX - L.x, e.toZ - L.z) < L.range * 2) audio.play('whistle', { x: e.toX, z: e.toZ }, L, 1, e.flight);
          break;
        case 'structureDestroyed':
          audio.play(e.kind === 'hq' ? 'bigExplosion' : 'crumble', e, L);
          break;
        case 'structureAdded': {
          const s = this.sim.structureById(e.id);
          if (s && s.owner === this.player && this.sim.elapsed > 1) audio.play('build', { x: s.tx + s.w / 2, z: s.tz + s.h / 2 }, L, 0.7);
          break;
        }
        case 'upgraded':
          if (e.owner === this.player) audio.play('build');
          break;
        case 'ignited':
          audio.play('whoosh', e, L);
          break;
        case 'launched':
          if (e.owner === this.player) audio.play('drone', undefined, undefined, 0.6);
          break;
        case 'taunt':
          audio.play('radio', undefined, undefined, 0.7);
          break;
        case 'wave':
          audio.play('alert');
          break;
        case 'ramp':
          if (e.target === this.player) audio.play('alert');
          break;
        case 'hired':
          if (e.owner === this.player) audio.play('hire', undefined, undefined, 0.7);
          break;
        case 'result':
          audio.play(e.result === 'victory' ? 'victory' : 'defeat', undefined, undefined, 0.8);
          break;
      }
    }
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'buildFailed':
          if (e.owner === this.player) this.toast(e.reason);
          break;
        case 'departed':
          if (e.owner === this.player && this.sim.timeSec - this.lastDepartToast > 20) {
            this.lastDepartToast = this.sim.timeSec;
            this.toast('Morale is low: civilians are leaving');
          }
          break;
        case 'wave':
          if (e.owner !== this.player) this.toast(`Wave ${e.index}/${e.total} incoming from the east! (${e.size} troops)`, 4);
          break;
        case 'hired':
          if (e.owner === this.player) this.toast(`${e.name} hired: they're waiting outside the Contracts Office`);
          break;
        case 'ramp':
          if (e.owner === this.player) this.toast('Ramp in place: infantry can climb onto their wall');
          break;
        case 'upgraded':
          if (e.owner === this.player) this.toast(`${STRUCTURE_DEFS[e.kind].name} upgraded${e.level > 1 ? ` to level ${e.level}` : ''}`);
          break;
        case 'structureDestroyed':
          if (e.owner === this.player && !STRUCTURE_DEFS[e.kind].trap) this.toast(`Your ${STRUCTURE_DEFS[e.kind].name} was destroyed`);
          break;
        case 'structureDamaged': {
          const s = this.sim.structureById(e.id);
          if (s && s.owner === this.player && !STRUCTURE_DEFS[s.kind].trap) this.raiseAlert(e.x, e.z, `${STRUCTURE_DEFS[s.kind].name} under attack!`);
          break;
        }
        case 'death': {
          // Losses near home only: a fight you started out there isn't news.
          const hq = this.sim.economy.hqOf(this.player);
          const home = hq ? Math.hypot(e.x - (hq.tx + hq.w / 2), e.z - (hq.tz + hq.h / 2)) < 32 : true;
          if (e.owner === this.player && home) this.raiseAlert(e.x, e.z, UNIT_TYPES[e.kind]?.key === 'civilian' ? 'Civilians under attack!' : 'Troops under fire!');
          break;
        }
        case 'result': {
          setHud({ result: { result: e.result, reason: e.reason } });
          clearGame(); // a finished match isn't worth resuming
          const stage = this.setup.trail;
          if (stage !== null) {
            if (e.result === 'victory') clearTrailStage(stage);
            const next = e.result === 'victory' && TRAIL[stage + 1] ? { stage: stage + 1, title: TRAIL[stage + 1].title } : null;
            setHud({ trail: { stage, title: TRAIL[stage].title, next } });
          }
          break;
        }
        case 'taunt':
          setHud({ taunt: { name: e.name, text: e.text } });
          this.tauntTimer = 6;
          break;
        case 'notice':
          if (e.owner === this.player) this.toast(e.text);
          break;
        case 'launched':
          if (e.owner === this.player) this.toast(`${UNIT_TYPES[e.kind].name} launched`);
          break;
        case 'shot':
          this.onShot(e);
          break;
        case 'death':
          if (e.unit === this.lastHit.unit && performance.now() - this.lastHit.at < 400) {
            setHud({ hitMarker: { kind: 'kill', t: performance.now() } });
          }
          break;
      }
    }
  }

  /** Hit markers for your own aimed shots; a damage indicator when you're the one hit. */
  private onShot(e: Extract<SimEvent, { type: 'shot' }>): void {
    const mine =
      (this.controlled >= 0 && e.unit === this.controlled) ||
      (this.controlledStruct >= 0 && e.unit === -1 && e.owner === this.player && this.nearControlledStruct(e.fromX, e.fromZ));
    if (mine && e.hit && e.target !== undefined && e.target >= 0) {
      this.lastHit = { unit: e.target, at: performance.now() };
      setHud({ hitMarker: { kind: e.head ? 'head' : 'hit', t: performance.now() } });
    }
    if (this.controlled >= 0 && e.hit && e.target === this.controlled) {
      const u = this.sim.units;
      const from = Math.atan2(e.fromX - u.x[this.controlled], e.fromZ - u.z[this.controlled]);
      let rel = this.renderer.ots.yaw - from;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      setHud({ damage: { angle: rel, t: performance.now() } });
    }
  }

  private nearControlledStruct(x: number, z: number): boolean {
    const s = this.sim.structureById(this.controlledStruct);
    return !!s && Math.hypot(x - (s.tx + s.w / 2), z - (s.tz + s.h / 2)) < 1.6;
  }

  private placingInfo(): PlacingInfo | null {
    if (!this.placing) return null;
    const def = STRUCTURE_DEFS[this.placing];
    if (this.placingLine()) {
      const tiles = this.wallTiles();
      const valid = tiles.filter((t) => t.ok).length;
      return {
        kind: this.placing,
        name: def.name,
        cost: `${costText(def.cost)} per tile`,
        valid: valid > 0,
        reason: tiles.length && !valid ? 'Nothing buildable on that line' : null,
        hasSpot: !!this.wallAnchor,
        rotatable: false,
        wall: { anchored: !!this.wallAnchor, ended: !!this.wallEnd, tiles: valid },
      };
    }
    const t = this.placeTile;
    const check = t ? this.sim.economy.canPlace(this.player, this.placing, t.tx, t.tz, this.placeRot) : null;
    return {
      kind: this.placing,
      name: def.name,
      cost: costText(def.cost),
      valid: !!check?.ok,
      reason: check && !check.ok ? (check.reason ?? null) : null,
      hasSpot: !!t,
      rotatable: !!def.rotatable,
      wall: null,
    };
  }

  private buildingInfo(): BuildingInfo | null {
    const s = this.selectedStructure >= 0 ? this.sim.structureById(this.selectedStructure) : undefined;
    if (!s) return null;
    const def = STRUCTURE_DEFS[s.kind];
    const p = this.sim.economy.player(s.owner);
    let storage: string | null = null;
    if (def.storage) {
      const kind = def.storage.kind;
      const label = kind === 'materials' ? 'Materials' : kind === 'food' ? 'Food' : 'Weapons';
      storage = `${label} ${Math.floor(p.stored(kind))} / ${p.cap(kind)} (all stores)`;
    } else if (def.housing) {
      storage = `Housing ${p.population} / ${p.housing} (all buildings)`;
    }
    if (def.power && def.power < 0) {
      storage = s.powered ? `⚡ Powered (uses ${-def.power})` : `No power: build a Generator (needs ${-def.power})`;
    } else if (def.power && def.power > 0 && s.kind === 'generator') {
      storage = `⚡ Supplying ${s.workers.length ? def.power : 0} power · grid ${p.powerDemand}/${p.powerSupply}`;
    }
    const half = (n?: number): number => Math.floor((n ?? 0) / 2);
    const refund = def.buildable
      ? costText({ timber: half(def.cost.timber), concrete: half(def.cost.concrete), funds: half(def.cost.funds) })
      : '';
    const mine = s.owner === this.player;
    return {
      id: s.id,
      kind: s.kind,
      name: def.name,
      description: def.description,
      rally: mine && RALLY_KINDS.has(s.kind) ? s.rallyX !== undefined : null,
      status: s.status,
      workers: s.workers.length,
      jobs: def.jobs ?? 0,
      active: s.active,
      canDemolish: def.buildable && mine,
      refund,
      storage,
      powered: !def.power || def.power > 0 || s.powered,
      hp: Math.max(0, Math.round(s.hp)),
      maxHp: Math.round(maxHp(s)),
      enemy: !mine,
      recipes: def.recipes
        ? { options: def.recipes.map((r) => `${RES_INFO[r.output].name} (${r.inputAmount} steel)`), selected: s.recipe }
        : null,
      trade:
        s.kind === 'market' && mine
          ? ([Res.Timber, Res.Concrete, Res.Steel, Res.Produce, Res.Meat, Res.Rifle, Res.MG, Res.Scoped, Res.Charges] as ResId[]).map(
              (r) => ({
                res: r,
                name: RES_INFO[r].name,
                stock: Math.floor(p.stock[r]),
                buy: PRICES[r],
                sell: Math.floor(PRICES[r] / 2),
              }),
            )
          : null,
      drones:
        s.kind === 'dronebay' && mine
          ? {
              options: DRONE_KINDS.map((k) => {
                const cost = DRONE_COST[k];
                const t = UNIT_TYPES[k];
                return {
                  kind: k,
                  name: t.name,
                  blurb: t.blurb,
                  cost: `$${cost.funds} · ${cost.steel} steel${cost.gear !== undefined ? ` · 1 ${RES_INFO[cost.gear].name.toLowerCase().replace(/s$/, '')}` : ''}`,
                  blocker: this.sim.drones.launchBlocker(this.player, s.id, k),
                };
              }),
              count: this.sim.drones.countAt(s),
              cap: def.bay?.capacity ?? 0,
            }
          : null,
      turret: def.turret && mine ? { crewed: this.sim.combat.crewed(s), ammo: s.ammo, mag: def.turret.mag } : null,
      controllable: mine && CONTROLLABLE_STRUCTURES.includes(s.kind),
      ignite: mine && s.kind === 'trench' && s.burn === 0,
      burning: s.burn > 0,
      level: s.level ?? 1,
      upgrade: (() => {
        const up = mine ? nextUpgrade(s) : null;
        return up
          ? { name: up.name, description: up.description, cost: costText(up.cost), blocker: this.sim.economy.upgradeBlocker(this.player, s.id) }
          : null;
      })(),
      contracts:
        s.kind === 'contracts' && mine
          ? CONTRACTS.map((ct, index) => ({
              index,
              name: ct.name,
              blurb: ct.blurb,
              cost: `$${ct.funds}`,
              blocker: this.sim.economy.hireBlocker(this.player, s.id, index),
            }))
          : null,
      recruit:
        s.kind === 'motorpool' && mine
          ? VEHICLES.map((k) => {
              const t = UNIT_TYPES[k];
              return {
                kind: k,
                name: t.name,
                blurb: t.blurb,
                cost: `${t.steel} steel · ${t.fuel} fuel · $${t.funds}`,
                stock: 0,
                note: 'crewed by an idle civilian',
                blocker: this.sim.economy.recruitBlocker(this.player, k),
              };
            })
          : s.kind === 'barracks' && mine
          ? RECRUITABLE.map((k) => {
              const t = UNIT_TYPES[k];
              return {
                kind: k,
                name: t.name,
                blurb: t.blurb,
                cost: `${RES_INFO[t.gear!].name.replace(/s$/, '')} + $${t.funds}`,
                stock: Math.floor(p.stock[t.gear!]),
                blocker: this.sim.economy.recruitBlocker(this.player, k),
              };
            })
          : null,
    };
  }

  /**
   * "Under attack" alert: a ping on the minimap, a warning sound and a message. At most one per area
   * every 25 s (and one every 5 s overall); not for fights you're already looking at.
   */
  private raiseAlert(x: number, z: number, msg: string): void {
    const now = this.sim.timeSec;
    const cell = Math.floor(z / 16) * 64 + Math.floor(x / 16);
    if (now - (this.alertCells.get(cell) ?? -1e9) < 25 || now - this.lastAlertAt < 5) return;
    this.alertCells.set(cell, now);
    this.alerts.push({ x, z, at: now });
    if (this.alerts.length > 8) this.alerts.shift();
    this.alertCursor = -1;
    const t = this.renderer.rts.target;
    const watching = this.controlled < 0 && this.controlledStruct < 0 && Math.hypot(t.x - x, t.z - z) < 16;
    if (watching) return;
    this.lastAlertAt = now;
    audio.play('alert');
    this.toast(`⚠ ${msg} ${isTouchDevice() ? '(tap ⚠ on the map)' : '(Tab to look)'}`, 3);
    setHud({ alertAt: now });
  }

  jumpToAlert(): void {
    if (!this.alerts.length) {
      this.toast('No recent alerts');
      return;
    }
    this.alertCursor = this.alertCursor <= 0 ? this.alerts.length - 1 : this.alertCursor - 1;
    const a = this.alerts[this.alertCursor];
    if (this.controlled >= 0 || this.controlledStruct >= 0) this.exitControl();
    this.renderer.rts.lookAtSoft(a.x, a.z);
  }

  toast(msg: string, sec = 2.5): void {
    setHud({ toast: msg });
    this.toastTimer = sec;
  }

  // ---------------------------------------------------------------- orders / selection

  /** Right-click / tap command at a picked point: attack a unit, attack a structure, or move. */
  commandAt(point: { x: number; z: number; layer: number }, enemyUnit: number, enemyStructure: number): void {
    if (this.selected.size === 0) return;
    const ids = [...this.selected];
    if (enemyUnit >= 0) {
      this.sim.enqueue({ type: 'attack', owner: this.player, ids, target: enemyUnit });
      this.renderer.fx.moveMarker(this.sim.units.x[enemyUnit], this.sim.units.z[enemyUnit]);
      return;
    }
    if (enemyStructure >= 0) {
      const s = this.sim.structureById(enemyStructure);
      const canBreach = (id: number): boolean => {
        const t = UNIT_TYPES[this.sim.units.kind[id]];
        return this.sim.units.charges[id] > 0 || !!t.blast || t.siege || !!t.artillery || (s?.kind === 'ditch' && (t.charges > 0 || t.dozer));
      };
      if (s && STRUCTURE_DEFS[s.kind].armored && !ids.some(canBreach)) {
        this.toast('Walls and gates need engineers, operators, AT teams, tanks, howitzers, breachers or strike drones');
        return;
      }
      this.sim.enqueue({ type: 'attackStructure', owner: this.player, ids, structure: enemyStructure });
      if (s) this.renderer.fx.moveMarker(s.tx + s.w / 2, s.tz + s.h / 2);
      return;
    }
    this.sim.enqueue({ type: 'move', owner: this.player, ids, x: point.x, z: point.z, layer: point.layer });
    this.renderer.fx.moveMarker(point.x, point.z);
  }

  issueMove(x: number, z: number, layer = 0): void {
    this.commandAt({ x, z, layer }, -1, -1);
  }

  select(ids: number[], additive: boolean): void {
    if (!additive) this.selected.clear();
    if (ids.length && this.selectedStructure >= 0) {
      this.selectedStructure = -1;
      this.renderer.setSelectedStructure(undefined);
    }
    const u = this.sim.units;
    for (const id of ids) {
      if (u.isAlive(id) && u.owner[id] === this.player && UNIT_TYPES[u.kind[id]].selectable) this.selected.add(id);
    }
    this.pushHud();
  }

  selectAll(): void {
    const u = this.sim.units;
    const ids: number[] = [];
    for (let i = 0; i < u.count; i++) {
      if (u.alive[i] && u.owner[i] === this.player && UNIT_TYPES[u.kind[i]].selectable) ids.push(i);
    }
    this.select(ids, false);
  }

  deselect(): void {
    this.selected.clear();
    this.pushHud();
  }

  setSelectMode(on: boolean): void {
    setHud({ selectMode: on });
  }

  // ---------------------------------------------------------------- building

  startPlacing(kind: StructureKind): void {
    if (this.controlled >= 0) return;
    this.targeting = null;
    this.aimTurns = 0;
    this.placing = kind;
    this.placeTile = null;
    this.wallAnchor = null;
    this.wallEnd = null;
    this.deselectStructure();
    this.renderer.setGhost(null);
    this.renderer.setWallGhost([]);
    setHud({ buildOpen: false, moraleOpen: false });
    this.pushHud();
  }

  cancelPlacing(): void {
    this.placing = null;
    this.placeTile = null;
    this.wallAnchor = null;
    this.wallEnd = null;
    this.renderer.setGhost(null);
    this.renderer.setWallGhost([]);
    this.pushHud();
  }

  /** Lights face away from your HQ by default (snapped to a quarter turn). */
  private autoFacing(x: number, z: number): number {
    const hq = this.sim.economy.hqOf(this.player);
    if (!hq) return 0;
    const a = Math.atan2(x - (hq.tx + hq.w / 2), z - (hq.tz + hq.h / 2));
    return Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
  }

  rotatePlacement(): void {
    if (this.placing && AIMABLE.includes(this.placing)) {
      this.aimTurns = (this.aimTurns + 1) % 4;
      if (this.placeTile) this.previewPlacementAt(this.placeTile.tx + 0.5, this.placeTile.tz + 0.5);
      return;
    }
    if (!this.placing || !STRUCTURE_DEFS[this.placing].rotatable) return;
    this.placeRot = this.placeRot ? 0 : Math.PI / 2;
    if (this.placeTile) {
      const { w, h } = footprint(this.placing, this.placeRot);
      this.previewPlacementAt(this.placeTile.tx + w / 2, this.placeTile.tz + h / 2);
    }
    this.pushHud();
  }

  /** Tiles of the current wall line with per-tile validity (affordability is cumulative). */
  private wallTiles(): { x: number; z: number; ok: boolean }[] {
    if (!this.wallAnchor) return [];
    const end = this.wallEnd ?? this.wallAnchor;
    const p = this.sim.economy.player(this.player);
    const per = STRUCTURE_DEFS.wall.cost.concrete ?? 0;
    let budget = Math.floor(p.stock[Res.Concrete] / Math.max(1, per));
    return tileLine(this.wallAnchor.tx, this.wallAnchor.tz, end.tx, end.tz).map(([x, z]) => {
      let ok = this.sim.economy.canPlaceWallTile(this.player, x, z).ok && budget > 0;
      if (ok) budget--;
      else ok = false;
      return { x, z, ok };
    });
  }

  private refreshWallGhost(): void {
    const flat: number[] = [];
    for (const t of this.wallTiles()) flat.push(t.x, t.z, t.ok ? 1 : 0);
    this.renderer.setWallGhost(flat);
  }

  /** Wall placement: set the line's anchor (start). */
  wallStart(x: number, z: number): void {
    this.wallAnchor = { tx: Math.floor(x), tz: Math.floor(z) };
    this.wallEnd = null;
    this.refreshWallGhost();
    this.pushHud();
  }

  /** Preview the current building centred on a ground point (or extend the wall line). */
  previewPlacementAt(x: number, z: number): void {
    if (!this.placing) return;
    if (this.placingLine()) {
      if (!this.wallAnchor) {
        // Hover preview of a single tile.
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        const ok = this.sim.economy.canPlaceWallTile(this.player, tx, tz).ok;
        this.renderer.setWallGhost([tx, tz, ok ? 1 : 0]);
      } else {
        this.wallEnd = { tx: Math.floor(x), tz: Math.floor(z) };
        this.refreshWallGhost();
      }
      this.pushHud();
      return;
    }
    if (AIMABLE.includes(this.placing)) this.placeRot = this.autoFacing(x, z) + (this.aimTurns * Math.PI) / 2;
    const { w, h } = footprint(this.placing, this.placeRot);
    const tx = Math.round(x - w / 2);
    const tz = Math.round(z - h / 2);
    this.placeTile = { tx, tz };
    const ok = this.sim.economy.canPlace(this.player, this.placing, tx, tz, this.placeRot).ok;
    const rot = this.placing === 'stairs' ? (this.sim.economy.stairsFacing(tx, tz, this.player) ?? 0) : this.placeRot;
    this.renderer.setGhost(this.placing, tx, tz, ok, rot);
    this.pushHud();
  }

  /** Build at the previewed spot (stays in placement mode for repeat building). */
  confirmPlacing(): void {
    if (!this.placing) return;
    if (this.placingLine()) {
      const tiles = this.wallTiles().filter((t) => t.ok);
      if (tiles.length === 0) {
        this.toast('Nothing buildable on that line');
        return;
      }
      const flat: number[] = [];
      for (const t of tiles) flat.push(t.x, t.z);
      this.sim.enqueue({ type: 'buildWall', owner: this.player, tiles: flat, kind: this.placing });
      // Chain the next segment from where this one ended.
      const end = this.wallEnd ?? this.wallAnchor;
      this.wallAnchor = isTouchDevice() && end ? { ...end } : null;
      this.wallEnd = null;
      this.renderer.setWallGhost([]);
      return;
    }
    if (!this.placeTile) return;
    const { tx, tz } = this.placeTile;
    const check = this.sim.economy.canPlace(this.player, this.placing, tx, tz, this.placeRot);
    if (!check.ok) {
      this.toast(check.reason ?? 'Cannot build here');
      return;
    }
    this.sim.enqueue({ type: 'build', owner: this.player, kind: this.placing, tx, tz, rot: this.placeRot });
    this.renderer.setGhost(this.placing, tx, tz, false, this.placeRot);
  }

  selectStructure(id: number): void {
    this.selectedStructure = id;
    this.selected.clear();
    this.renderer.setSelectedStructure(this.sim.structureById(id));
    setHud({ buildOpen: false });
    this.pushHud();
  }

  deselectStructure(): void {
    this.selectedStructure = -1;
    this.renderer.setSelectedStructure(undefined);
    this.pushHud();
  }

  demolishSelected(): void {
    if (this.selectedStructure < 0) return;
    this.sim.enqueue({ type: 'demolish', owner: this.player, id: this.selectedStructure });
  }

  toggleSelectedActive(): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s) return;
    this.sim.enqueue({ type: 'setActive', owner: this.player, id: s.id, active: !s.active });
    setTimeout(() => this.pushHud(), 120);
  }

  hire(contract: number): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s || s.kind !== 'contracts') return;
    const why = this.sim.economy.hireBlocker(this.player, s.id, contract);
    if (why) {
      this.toast(why);
      return;
    }
    this.sim.enqueue({ type: 'hire', owner: this.player, office: s.id, contract });
    setTimeout(() => this.pushHud(), 120);
  }

  recruit(kind: number, count: number): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s || (s.kind !== 'barracks' && s.kind !== 'motorpool')) return;
    const blocker = this.sim.economy.recruitBlocker(this.player, kind);
    if (blocker) {
      this.toast(blocker);
      return;
    }
    this.sim.enqueue({ type: 'recruit', owner: this.player, barracks: s.id, kind, count });
    setTimeout(() => this.pushHud(), 120);
  }

  setNightShift(on: boolean): void {
    this.sim.enqueue({ type: 'setNightShift', owner: this.player, on });
    setTimeout(() => this.pushHud(), 120);
  }

  startFlare(): void {
    if (this.controlled >= 0) return;
    if (this.sim.economy.player(this.player).flares <= 0) {
      this.toast('No flares left: you get another one every minute');
      return;
    }
    this.cancelPlacing();
    this.targeting = 'flare';
    this.pushHud();
  }

  cancelTargeting(): void {
    this.targeting = null;
    this.pushHud();
  }

  startOrder(kind: 'rally' | 'patrol' | 'attackMove'): void {
    if (kind === 'rally') {
      const s = this.selectedStructure >= 0 ? this.sim.structureById(this.selectedStructure) : undefined;
      if (!s || s.owner !== this.player || !RALLY_KINDS.has(s.kind)) return;
    } else if (this.selected.size === 0) {
      return;
    }
    this.cancelPlacing();
    this.targeting = kind;
    this.pushHud();
  }

  /** A tap/click on the ground while targeting. */
  targetAt(x: number, z: number): void {
    const t = this.targeting;
    if (t === 'flare') {
      this.fireFlareAt(x, z);
      return;
    }
    this.targeting = null;
    if (t === 'rally' && this.selectedStructure >= 0) {
      this.sim.enqueue({ type: 'rally', owner: this.player, id: this.selectedStructure, x, z });
      this.renderer.fx.moveMarker(x, z);
      this.toast('Rally point set: new units will head there');
    } else if ((t === 'patrol' || t === 'attackMove') && this.selected.size) {
      this.sim.enqueue({ type: t, owner: this.player, ids: [...this.selected], x, z });
      this.renderer.fx.moveMarker(x, z);
    }
    this.pushHud();
  }

  clearRally(): void {
    if (this.selectedStructure < 0) return;
    this.sim.enqueue({ type: 'rally', owner: this.player, id: this.selectedStructure, x: -1, z: -1 });
    setTimeout(() => this.pushHud(), 80);
  }

  toggleHoldFire(): void {
    if (!this.selected.size) return;
    const u = this.sim.units;
    const all = [...this.selected].every((id) => u.stance[id] === STANCE_HOLD_FIRE);
    this.sim.enqueue({ type: 'stance', owner: this.player, ids: [...this.selected], holdFire: !all });
    this.toast(all ? 'Weapons free' : 'Holding fire: they only shoot when you order an attack');
    setTimeout(() => this.pushHud(), 80);
  }

  groupSelect(n: number, additive = false): void {
    const u = this.sim.units;
    const g = (this.groups.get(n) ?? []).filter((id) => u.isAlive(id) && u.owner[id] === this.player);
    this.groups.set(n, g);
    if (!g.length) {
      if (!additive && this.selected.size) this.groupAssign(n);
      return;
    }
    this.select(g, additive);
  }

  groupAssign(n: number): void {
    if (!this.selected.size) return;
    this.groups.set(n, [...this.selected]);
    this.toast(`Group ${n} set (${this.selected.size})`);
    this.pushHud();
  }

  minimapJump(fx: number, fz: number): void {
    const map = this.sim.map;
    if (this.controlled >= 0 || this.controlledStruct >= 0) return;
    this.renderer.rts.jumpTo(Math.min(Math.max(fx, 0), 1) * map.width, Math.min(Math.max(fz, 0), 1) * map.height);
  }

  /** Overview map: ground, buildings, the units you can see, your view, recent alerts. */
  drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const sim = this.sim;
    const map = sim.map;
    if (!this.miniTerrain) this.miniTerrain = minimapTerrain(map);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.miniTerrain, 0, 0, w, h);
    const night = this.renderer.dayNight.night;
    if (night > 0.05) {
      ctx.fillStyle = `rgba(6, 10, 24, ${0.5 * night})`;
      ctx.fillRect(0, 0, w, h);
    }
    const sx = w / map.width;
    const sz = h / map.height;
    for (const s of sim.structures) {
      const mine = s.owner === this.player;
      if (s.kind === 'mines' && !mine && !sim.traps.knows(this.player, s)) continue;
      const def = STRUCTURE_DEFS[s.kind];
      ctx.fillStyle = mine ? (def.trap ? '#4a6aa8' : '#6f9bff') : def.trap ? '#a8584a' : '#ff6a55';
      ctx.fillRect(s.tx * sx, s.tz * sz, Math.max(1.5, s.w * sx), Math.max(1.5, s.h * sz));
    }
    const u = sim.units;
    const seen = sim.vision.seen[this.player];
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const mine = u.owner[i] === this.player;
      if (!mine && seen[i] !== 1) continue;
      const t = UNIT_TYPES[u.kind[i]];
      if (mine && !t.armed && !t.fly) {
        ctx.fillStyle = '#c9d6ff';
        ctx.fillRect(u.x[i] * sx - 0.75, u.z[i] * sz - 0.75, 1.5, 1.5);
        continue;
      }
      const r = t.vehicle ? 2.4 : 1.7;
      ctx.fillStyle = mine ? (this.selected.has(i) ? '#7dff8a' : '#9cc0ff') : '#ff3b30';
      ctx.fillRect(u.x[i] * sx - r / 2, u.z[i] * sz - r / 2, r, r);
    }
    // What the camera sees.
    const q = this.renderer.viewQuad();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    q.forEach((p, k) => (k ? ctx.lineTo(p.x * sx, p.z * sz) : ctx.moveTo(p.x * sx, p.z * sz)));
    ctx.closePath();
    ctx.stroke();
    // Alert pings.
    const now = sim.timeSec;
    for (const a of this.alerts) {
      const age = now - a.at;
      if (age > 10) continue;
      const k = (age % 1.2) / 1.2;
      ctx.strokeStyle = `rgba(255, 70, 50, ${1 - k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a.x * sx, a.z * sz, 3 + k * 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Fire a flare at a ground point (from targeting mode). */
  fireFlareAt(x: number, z: number): void {
    this.sim.enqueue({ type: 'flare', owner: this.player, x, z });
    this.targeting = null;
    this.pushHud();
  }

  trade(res: number, amount: number): void {
    this.sim.enqueue({ type: 'trade', owner: this.player, res: res as ResId, amount });
    setTimeout(() => this.pushHud(), 120);
  }

  setRecipe(index: number): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s) return;
    this.sim.enqueue({ type: 'setRecipe', owner: this.player, id: s.id, recipe: index });
    setTimeout(() => this.pushHud(), 120);
  }

  setRations(level: number): void {
    this.sim.enqueue({ type: 'setRations', owner: this.player, level });
    setTimeout(() => this.pushHud(), 120);
  }

  setTax(level: number): void {
    this.sim.enqueue({ type: 'setTax', owner: this.player, level });
    setTimeout(() => this.pushHud(), 120);
  }

  setBuildOpen(open: boolean): void {
    if (open) this.cancelPlacing();
    setHud({ buildOpen: open, moraleOpen: false });
  }

  setMoraleOpen(open: boolean): void {
    setHud({ moraleOpen: open, buildOpen: false });
  }

  // ---------------------------------------------------------------- direct control

  takeControl(): void {
    if (this.controlled >= 0 || this.controlledStruct >= 0) return;
    if (this.placing) this.cancelPlacing();
    const st = this.selectedStructure >= 0 ? this.sim.structureById(this.selectedStructure) : undefined;
    if (st && st.owner === this.player && CONTROLLABLE_STRUCTURES.includes(st.kind)) {
      this.takeStructure(st.id);
      return;
    }
    const u = this.sim.units;
    let pick = -1;
    for (const id of this.selected) {
      if (UNIT_TYPES[u.kind[id]].controllable) {
        pick = id;
        break;
      }
    }
    if (pick < 0) {
      this.toast('Select a soldier first');
      return;
    }
    this.controlled = pick;
    this.controlledKind = u.kind[pick];
    // The rest of the selection follows you as a squad.
    this.followers = [...this.selected].filter((id) => id !== pick && u.isAlive(id));
    if (this.followers.length) this.sim.enqueue({ type: 'follow', owner: this.player, ids: this.followers, leader: pick });
    this.selected.clear();
    this.selected.add(pick);
    // Face "up the screen" from the RTS view so the player keeps their bearings.
    this.renderer.ots.yaw = this.renderer.rts.yaw + Math.PI;
    this.renderer.ots.pitch = -0.08;
    this.renderer.ots.aiming = false;
    this.renderer.director.startSwoop();
    this.input.enterControl();
    setHud({ view: 'control' });
    this.pushHud();
  }

  /** Aim a gun tower or searchlight yourself. */
  private takeStructure(id: number): void {
    const s = this.sim.structureById(id);
    if (!s) return;
    this.controlledStruct = id;
    this.renderer.ots.yaw = s.aim;
    this.renderer.ots.pitch = -0.1;
    this.renderer.ots.aiming = false;
    this.renderer.director.startSwoop();
    this.input.enterControl();
    if (s.kind === 'guntower' && !this.sim.combat.crewed(s)) this.toast('Put a soldier on the tower to fire the gun', 3);
    setHud({ view: 'control' });
    this.pushHud();
  }

  exitControl(): void {
    if (this.controlledStruct >= 0) {
      const s = this.sim.structureById(this.controlledStruct);
      this.controlledStruct = -1;
      if (s) this.renderer.rts.lookAtSoft(s.tx + s.w / 2, s.tz + s.h / 2);
    } else if (this.controlled >= 0) {
      const id = this.controlled;
      this.sim.enqueue({ type: 'release', owner: this.player, id });
      this.controlled = -1;
      const u = this.sim.units;
      if (this.followers.length) this.sim.enqueue({ type: 'stop', owner: this.player, ids: this.followers });
      this.followers = [];
      if (u.isAlive(id)) this.renderer.rts.lookAtSoft(u.x[id], u.z[id]);
    } else {
      return;
    }
    this.renderer.director.startSwoop();
    this.renderer.ots.aiming = false;
    this.input.exitControl();
    setHud({ view: 'rts', aiming: false, control: null, hitMarker: null, damage: null });
  }

  reload(): void {
    this.input.reloadReq = true;
  }

  plantCharge(): void {
    this.input.plantReq = true;
  }

  toggleNvg(): void {
    const c = this.controlled;
    if (c < 0 || UNIT_TYPES[this.sim.units.kind[c]].nightVision < 0.8) return;
    this.renderer.nvgEnabled = !this.renderer.nvgEnabled;
    this.pushHud();
  }

  toggleSlowMo(): void {
    this.slowMo = !this.slowMo;
    try {
      localStorage.setItem(SLOWMO_KEY, this.slowMo ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    setHud({ slowMo: this.slowMo });
    this.toast(this.slowMo ? 'Slow motion on while in direct control' : 'Slow motion off');
  }

  /** Fire an illumination flare where the crosshair meets the ground. */
  flareAtCrosshair(): void {
    const r = this.renderer.canvas.getBoundingClientRect();
    const g = this.renderer.pickGround(r.left + r.width / 2, r.top + r.height / 2);
    if (!g) {
      this.toast('Aim at the ground to fire a flare');
      return;
    }
    this.sim.enqueue({ type: 'flare', owner: this.player, x: g.x, z: g.z });
  }

  selectKindOnly(kind: number): void {
    const u = this.sim.units;
    for (const id of [...this.selected]) if (u.kind[id] !== kind) this.selected.delete(id);
    this.pushHud();
  }

  deselectKind(kind: number): void {
    const u = this.sim.units;
    for (const id of [...this.selected]) if (u.kind[id] === kind) this.selected.delete(id);
    this.pushHud();
  }

  upgradeSelected(): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s) return;
    const why = this.sim.economy.upgradeBlocker(this.player, s.id);
    if (why) {
      this.toast(why);
      return;
    }
    this.sim.enqueue({ type: 'upgrade', owner: this.player, id: s.id });
    setTimeout(() => this.pushHud(), 120);
  }

  igniteSelected(): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s || s.kind !== 'trench') return;
    this.sim.enqueue({ type: 'ignite', owner: this.player, id: s.id });
    setTimeout(() => this.pushHud(), 120);
  }

  /** Placing something drawn as a line (walls, mines, ditches, trenches, wire)? */
  placingLine(): boolean {
    return !!this.placing && !!STRUCTURE_DEFS[this.placing].line;
  }

  launchDrone(kind: number): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s || s.kind !== 'dronebay') return;
    const why = this.sim.drones.launchBlocker(this.player, s.id, kind);
    if (why) {
      this.toast(why);
      return;
    }
    this.sim.enqueue({ type: 'launchDrone', owner: this.player, bay: s.id, kind });
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

  restart(mode?: GameMode): void {
    this.leaving = true;
    clearGame();
    const params = new URLSearchParams(location.search);
    if (mode) params.set('mode', mode);
    else for (const k of ['mode', 'difficulty', 'seed', 'ai', 'map', 'trail']) params.delete(k);
    location.search = params.toString();
  }

  playTrail(stage: number): void {
    if (!TRAIL[stage]) return;
    this.leaving = true;
    clearGame();
    const params = new URLSearchParams(location.search);
    for (const k of ['mode', 'difficulty', 'seed', 'ai', 'map', 'trail']) params.delete(k);
    new URLSearchParams(setupQuery(trailSetup(stage))).forEach((v, k) => params.set(k, v));
    location.search = params.toString();
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
      localStorage.setItem(HELP_KEY, '1');
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
