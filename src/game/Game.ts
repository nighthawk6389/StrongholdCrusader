import * as THREE from 'three';
import { TICK_SEC, formatHour, type PhaseName } from '../sim/clock';
import { TAX_LEVELS } from '../sim/economy';
import { createScenario, ENEMY, type GameMode } from '../sim/scenario';
import type { Sim, SimEvent } from '../sim/sim';
import { PRICES, RES_INFO, Res, STRUCTURE_DEFS, costText, footprint, type ResId, type StructureKind } from '../sim/structures';
import type { Difficulty } from '../sim/ai';
import { RECRUITABLE, UNIT_TYPES } from '../sim/unitTypes';
import { GameRenderer, detectQuality } from '../render/GameRenderer';
import { InputController } from '../input/InputController';
import { setHud, type BuildingInfo, type PlacingInfo } from '../ui/store';

const MAX_STEPS_PER_FRAME = 8;
const NO_SELECTION: ReadonlySet<number> = new Set();
const HELP_KEY = 'm2-help-seen';

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
  setRecipe(index: number): void;
  trade(res: number, amount: number): void;
  restart(mode?: GameMode): void;
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
  /** Building being placed, its rotation, and the footprint origin currently previewed. */
  placing: StructureKind | null = null;
  placeRot = 0;
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

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, mode: GameMode) {
    const params = new URLSearchParams(location.search);
    const diffParam = params.get('difficulty');
    const difficulty: Difficulty = diffParam === 'easy' || diffParam === 'hard' ? diffParam : 'normal';
    const scenario = createScenario(mode, Number(params.get('seed')) || 1337, difficulty);
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
      seenHelp = localStorage.getItem(HELP_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    const label = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[difficulty];
    setHud({
      isTouch,
      gameMode: mode,
      opponent: scenario.ai ? { name: scenario.ai.personality.name, difficulty: label } : null,
      quality: quality.name,
      debug: params.has('debug'),
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
    for (const id of this.selected) if (!u.isAlive(id) || u.owner[id] !== this.player) this.selected.delete(id);
    if (this.controlled >= 0 && !u.isAlive(this.controlled)) {
      this.toast('Your unit was killed');
      this.exitControl();
    }

    const events = this.sim.drainEvents();
    this.handleEvents(events);
    if (this.selectedStructure >= 0 && !this.sim.structureById(this.selectedStructure)) this.deselectStructure();
    this.renderer.render({
      alpha: this.paused ? 1 : this.acc / TICK_SEC,
      dt,
      selected: this.controlled >= 0 ? NO_SELECTION : this.selected,
      controlled: this.controlled,
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
    let canControl = false;
    for (const id of this.selected) {
      const t = UNIT_TYPES[u.kind[id]];
      counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
      if (t.controllable) canControl = true;
    }
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
        produce: p.stock[Res.Produce],
        meat: p.stock[Res.Meat],
        gear: [Res.Rifle, Res.MG, Res.Scoped, Res.Charges].map((r) => Math.floor(p.stock[r])),
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
      placing: this.placingInfo(),
      building: this.buildingInfo(),
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
        case 'structureDestroyed':
          if (e.owner === this.player) this.toast(`Your ${STRUCTURE_DEFS[e.kind].name} was destroyed`);
          break;
        case 'result':
          setHud({ result: { result: e.result, reason: e.reason } });
          break;
        case 'taunt':
          setHud({ taunt: { name: e.name, text: e.text } });
          this.tauntTimer = 6;
          break;
      }
    }
  }

  private placingInfo(): PlacingInfo | null {
    if (!this.placing) return null;
    const def = STRUCTURE_DEFS[this.placing];
    if (this.placing === 'wall') {
      const tiles = this.wallTiles();
      const valid = tiles.filter((t) => t.ok).length;
      return {
        kind: 'wall',
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
      status: s.status,
      workers: s.workers.length,
      jobs: def.jobs ?? 0,
      active: s.active,
      canDemolish: def.buildable && mine,
      refund,
      storage,
      hp: Math.max(0, Math.round(s.hp)),
      maxHp: def.hp,
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
      recruit:
        s.kind === 'barracks' && mine
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
      if (s && STRUCTURE_DEFS[s.kind].armored && ids.every((id) => this.sim.units.charges[id] === 0)) {
        this.toast('Only combat engineers can breach walls and gates');
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

  rotatePlacement(): void {
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
    if (this.placing === 'wall') {
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
    if (this.placing === 'wall') {
      const tiles = this.wallTiles().filter((t) => t.ok);
      if (tiles.length === 0) {
        this.toast('Nothing buildable on that line');
        return;
      }
      const flat: number[] = [];
      for (const t of tiles) flat.push(t.x, t.z);
      this.sim.enqueue({ type: 'buildWall', owner: this.player, tiles: flat });
      // Chain the next segment from where this one ended.
      const end = this.wallEnd ?? this.wallAnchor;
      this.wallAnchor = useHudIsTouch() && end ? { ...end } : null;
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

  recruit(kind: number, count: number): void {
    const s = this.sim.structureById(this.selectedStructure);
    if (!s || s.kind !== 'barracks') return;
    const blocker = this.sim.economy.recruitBlocker(this.player, kind);
    if (blocker) {
      this.toast(blocker);
      return;
    }
    this.sim.enqueue({ type: 'recruit', owner: this.player, barracks: s.id, kind, count });
    setTimeout(() => this.pushHud(), 120);
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
    if (this.controlled >= 0) return;
    if (this.placing) this.cancelPlacing();
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
    setHud({ view: 'rts', aiming: false });
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
    const params = new URLSearchParams(location.search);
    if (mode) params.set('mode', mode);
    else {
      params.delete('mode');
      params.delete('difficulty');
    }
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

function useHudIsTouch(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
