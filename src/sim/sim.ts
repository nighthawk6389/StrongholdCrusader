import { CYCLE_SEC, TICK_SEC, cycleInfo, phaseStartSec, type CycleInfo, type PhaseName } from './clock';
import { Combat } from './combat';
import { Drones } from './drones';
import { Economy } from './economy';
import { AT_GOAL, CLIMB_BASE, DIR_X, DIR_Z, FlowFieldCache, SWITCH_LAYER, fieldKey } from './flowfield';
import { Vision } from './vision';
import { Block, type GameMap } from './map';
import { Rng } from './rng';
import { STRUCTURE_DEFS, footprint, type ResId, type Structure, type StructureKind } from './structures';
import { UNIT_TYPES } from './unitTypes';
import { Order, UnitStore } from './units';
import type { WaveDirector } from './waves';

/** Anything that plays a side from inside the deterministic step (AI commanders). */
export interface Controller {
  readonly owner: number;
  update(sim: Sim): void;
  /** Sees every event emitted during a step (before the UI drains them). */
  observe?(sim: Sim, events: readonly SimEvent[]): void;
}

export type Command =
  | { type: 'move'; owner: number; ids: number[]; x: number; z: number; layer?: number }
  | { type: 'stop'; owner: number; ids: number[] }
  | {
      type: 'control';
      owner: number;
      id: number;
      /** World-space move intent, magnitude 0..1. */
      mx: number;
      mz: number;
      /** Aim yaw in radians (forward = (sin yaw, cos yaw)). */
      yaw: number;
      fire: boolean;
      aim: boolean;
      /** Aim pitch (radians, + up). With the camera position (ex, ey, ez) it defines the crosshair ray. */
      pitch?: number;
      ex?: number;
      ey?: number;
      ez?: number;
      reload?: boolean;
      /** Plant a breach charge on the enemy structure you're standing against. */
      plant?: boolean;
    }
  /** Aim a gun tower (fire needs a soldier up top) or a searchlight yourself. */
  | {
      type: 'controlStructure';
      owner: number;
      id: number;
      yaw: number;
      pitch?: number;
      ex?: number;
      ey?: number;
      ez?: number;
      fire: boolean;
      aim: boolean;
      reload?: boolean;
    }
  /** Keep these units close to `leader` (your squad while you possess one of them). */
  | { type: 'follow'; owner: number; ids: number[]; leader: number }
  | { type: 'launchDrone'; owner: number; bay: number; kind: number }
  | { type: 'release'; owner: number; id: number }
  | { type: 'build'; owner: number; kind: StructureKind; tx: number; tz: number; rot?: number }
  /** Wall line: flat [tx0, tz0, tx1, tz1, ...]. */
  | { type: 'buildWall'; owner: number; tiles: number[] }
  | { type: 'demolish'; owner: number; id: number }
  | { type: 'setActive'; owner: number; id: number; active: boolean }
  | { type: 'setRations'; owner: number; level: number }
  | { type: 'setTax'; owner: number; level: number }
  | { type: 'setRecipe'; owner: number; id: number; recipe: number }
  | { type: 'recruit'; owner: number; barracks: number; kind: number; count: number }
  /** Trade Post: buy (amount > 0) or sell (amount < 0). */
  | { type: 'trade'; owner: number; res: ResId; amount: number }
  /** Fire an illumination flare at a point (needs one of your soldiers within range; costs funds). */
  | { type: 'flare'; owner: number; x: number; z: number }
  | { type: 'setNightShift'; owner: number; on: boolean }
  | { type: 'attack'; owner: number; ids: number[]; target: number }
  | { type: 'attackStructure'; owner: number; ids: number[]; structure: number }
  /** Send units to assault `target`'s HQ (breaching walls on the way). */
  | { type: 'assault'; owner: number; ids: number[]; target: number };

export type SimEvent =
  | {
      type: 'shot';
      /** Firing unit, or -1 for a gun tower. */
      unit: number;
      owner: number;
      fromX: number;
      fromZ: number;
      fromY: number;
      toX: number;
      toZ: number;
      toY: number;
      hit: boolean;
      /** Unit hit (-1 = none) and whether it was a head hit (aimed fire). */
      target?: number;
      head?: boolean;
    }
  | { type: 'death'; unit: number; owner: number; x: number; z: number; y: number; kind: number }
  | { type: 'structureAdded'; id: number }
  | { type: 'structureRemoved'; id: number }
  | { type: 'structureDamaged'; id: number; x: number; z: number }
  | { type: 'structureDestroyed'; id: number; kind: StructureKind; owner: number; x: number; z: number }
  | { type: 'explosion'; x: number; z: number; owner: number }
  | { type: 'buildFailed'; owner: number; reason: string }
  | { type: 'treeFelled'; index: number }
  | { type: 'delivered'; owner: number; res: ResId; amount: number; x: number; z: number }
  | { type: 'arrived'; owner: number; unit: number }
  | { type: 'departed'; owner: number; x: number; z: number }
  | { type: 'recruited'; owner: number; unit: number; kind: number }
  | { type: 'wave'; owner: number; index: number; total: number; size: number }
  | { type: 'result'; result: 'victory' | 'defeat'; reason: string }
  | { type: 'taunt'; owner: number; name: string; text: string }
  | { type: 'flare'; owner: number; x: number; z: number }
  | { type: 'launched'; owner: number; unit: number; kind: number }
  /** Feedback for a player action that didn't happen (shown as a toast). */
  | { type: 'notice'; owner: number; text: string };

export interface SimInit {
  map: GameMap;
  seed: number;
  /** Seconds into the day/night cycle at tick 0. */
  startSec: number;
}

const FORMATION_SPACING = 0.78;
export const FLARE_COST = 15;
/** A flare must land within this distance of one of your soldiers. */
export const FLARE_REACH = 32;

export const Nav = {
  Moving: 0,
  Arrived: 1,
  Stuck: 2,
  Unreachable: 3,
  /** Breach field ran into an enemy structure (see `navObstacle`). */
  Blocked: 4,
} as const;

/**
 * The authoritative game simulation. Pure TypeScript, no DOM or rendering.
 * Advanced in fixed ticks via `step()`; all external changes arrive as `Command`s.
 */
export class Sim {
  readonly map: GameMap;
  readonly units = new UnitStore();
  readonly structures: Structure[] = [];
  readonly flow: FlowFieldCache;
  readonly rng: Rng;
  readonly economy: Economy;
  readonly combat: Combat;
  readonly vision: Vision;
  readonly drones: Drones;
  director: WaveDirector | null = null;
  /** Player whose victory/defeat is tracked. */
  defender = 1;
  /** Skirmish opponent: lose your HQ or Commander and you lose; take theirs and you win. */
  opponent = 0;
  readonly controllers: Controller[] = [];
  result: { result: 'victory' | 'defeat'; reason: string } | null = null;
  tick = 0;
  startSec: number;
  /** Structure id a breach-mode navigation step ran into. */
  navObstacle = -1;

  private queue: Command[] = [];
  private events: SimEvent[] = [];
  private nextStructureId = 1;
  private readonly structById = new Map<number, Structure>();
  private readonly cellHead: Int32Array;
  private readonly cellNext: Int32Array;

  constructor(init: SimInit) {
    this.map = init.map;
    this.rng = new Rng(init.seed);
    this.startSec = init.startSec;
    this.flow = new FlowFieldCache(this.map, 64);
    this.economy = new Economy(this);
    this.combat = new Combat(this);
    this.vision = new Vision(this);
    this.drones = new Drones(this);
    this.cellHead = new Int32Array(this.map.width * this.map.height).fill(-1);
    this.cellNext = new Int32Array(this.units.alive.length).fill(-1);
  }

  get timeSec(): number {
    return this.startSec + this.tick * TICK_SEC;
  }

  /** Seconds since the match started. */
  get elapsed(): number {
    return this.tick * TICK_SEC;
  }

  get cycle(): CycleInfo {
    return cycleInfo(this.timeSec);
  }

  enqueue(cmd: Command): void {
    this.queue.push(cmd);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Returns and clears events produced since the last call. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** After a save is restored into this sim: rebuild the indexes and caches that aren't saved. */
  afterRestore(): void {
    this.structById.clear();
    for (const s of this.structures) this.structById.set(s.id, s);
    this.flow.clear();
    this.queue = [];
    this.events = [];
  }

  /** Dev helper: jump the day/night clock to the start of a phase (does not advance the sim). */
  skipToPhase(phase: PhaseName): void {
    const now = this.timeSec;
    const cycleStart = now - (now % CYCLE_SEC);
    let target = cycleStart + phaseStartSec(phase);
    if (target <= now) target += CYCLE_SEC;
    this.startSec += target - now;
  }

  // ---------------------------------------------------------------- structures

  /** Place a structure without validation or cost (scenario setup, or after Economy checks). */
  placeStructure(kind: StructureKind, owner: number, tx: number, tz: number, rot = 0): Structure | null {
    const def = STRUCTURE_DEFS[kind];
    const { w, h } = footprint(kind, rot);
    const map = this.map;
    for (let z = tz; z < tz + h; z++) {
      for (let x = tx; x < tx + w; x++) {
        if (!map.isWalkableTile(x, z) || map.structAt[map.idx(x, z)] !== 0) return null;
      }
    }
    const s: Structure = {
      id: this.nextStructureId++,
      kind,
      owner,
      tx,
      tz,
      w,
      h,
      hp: def.hp,
      rot,
      doorX: tx + w / 2,
      doorZ: tz + h + 0.5,
      workers: [],
      active: true,
      status: def.jobs ? 'noWorker' : 'ok',
      recipe: 0,
      powered: !def.power || def.power > 0,
      aim: rot,
      cooldown: 0,
      ammo: def.turret?.mag ?? 0,
      reload: 0,
      target: -1,
      manualUntil: -1,
    };
    for (let z = tz; z < tz + h; z++) {
      for (let x = tx; x < tx + w; x++) {
        const i = map.idx(x, z);
        map.structAt[i] = s.id;
        map.structOwner[i] = owner;
        if (kind === 'gate') {
          map.blocked[i] = Block.Gate;
          map.gateOwner[i] = owner;
        } else if (def.blocks) {
          map.blocked[i] = Block.Structure;
        }
        if (def.deckH !== undefined) {
          map.deck[i] = 1;
          map.deckH[i] = def.deckH;
          if (kind === 'stairs') map.stairs[i] = 1;
        }
      }
    }
    map.version++;
    const door = this.economy.findDoor(tx, tz, w, h, owner);
    if (door) {
      s.doorX = door.x;
      s.doorZ = door.z;
    }
    this.structures.push(s);
    this.structById.set(s.id, s);
    this.emit({ type: 'structureAdded', id: s.id });
    return s;
  }

  removeStructure(s: Structure): void {
    const map = this.map;
    for (let z = s.tz; z < s.tz + s.h; z++) {
      for (let x = s.tx; x < s.tx + s.w; x++) {
        const i = map.idx(x, z);
        if (map.blocked[i] === Block.Structure || map.blocked[i] === Block.Gate) map.blocked[i] = Block.Free;
        map.gateOwner[i] = 0;
        map.deck[i] = 0;
        map.deckH[i] = 0;
        map.stairs[i] = 0;
        map.structAt[i] = 0;
        map.structOwner[i] = 0;
      }
    }
    map.version++;
    // Anyone standing on a vanished deck drops to the ground.
    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.layer[i] !== 1) continue;
      const x = Math.floor(u.x[i]);
      const z = Math.floor(u.z[i]);
      if (x >= s.tx && z >= s.tz && x < s.tx + s.w && z < s.tz + s.h) u.layer[i] = 0;
    }
    const idx = this.structures.indexOf(s);
    if (idx >= 0) this.structures.splice(idx, 1);
    this.structById.delete(s.id);
    this.emit({ type: 'structureRemoved', id: s.id });
  }

  /** Apply damage to a structure; destroys it at 0 hp. */
  damageStructure(s: Structure, amount: number): void {
    if (s.hp <= 0) return;
    s.hp -= amount;
    const cx = s.tx + s.w / 2;
    const cz = s.tz + s.h / 2;
    if (s.hp > 0) {
      this.emit({ type: 'structureDamaged', id: s.id, x: cx, z: cz });
      return;
    }
    this.emit({ type: 'structureDestroyed', id: s.id, kind: s.kind, owner: s.owner, x: cx, z: cz });
    this.economy.onStructureLost(s);
    this.removeStructure(s);
    this.economy.afterStructureRemoved(s.owner);
  }

  structureById(id: number): Structure | undefined {
    return this.structById.get(id);
  }

  /** Structure covering tile (tx, tz), if any. */
  structureAt(tx: number, tz: number): Structure | undefined {
    if (!this.map.inBounds(tx, tz)) return undefined;
    const id = this.map.structAt[this.map.idx(tx, tz)];
    return id ? this.structById.get(id) : undefined;
  }

  spawnUnit(kind: number, owner: number, x: number, z: number, heading = 0): number {
    return this.units.spawn(kind, owner, x, z, heading);
  }

  // ---------------------------------------------------------------- navigation

  /**
   * Point the unit at a destination (order unchanged). Falls back to the ground if the deck can't be
   * reached. `fieldTile` lets a group share one flow field toward a common tile while each unit
   * finishes at its own slot (units steer directly to the slot once it's in sight).
   */
  setDestination(i: number, x: number, z: number, layer = 0, breach = false, fieldTile = -1): boolean {
    const map = this.map;
    const u = this.units;
    const team = u.owner[i];
    let goalLayer = layer;
    let goal = map.nearestOnLayer(Math.floor(x), Math.floor(z), goalLayer, team, 6);
    if (goal < 0 && goalLayer === 1) {
      goalLayer = 0;
      goal = map.nearestOnLayer(Math.floor(x), Math.floor(z), 0, team, 6);
    }
    if (goal < 0) return false;
    const exact = map.walkableAt(x, z, goalLayer, team) && Math.floor(x) + Math.floor(z) * map.width === goal;
    u.goalX[i] = exact ? x : (goal % map.width) + 0.5;
    u.goalZ[i] = exact ? z : Math.floor(goal / map.width) + 0.5;
    u.goalLayer[i] = goalLayer;
    const shared = fieldTile >= 0 && map.walkable(fieldTile % map.width, Math.floor(fieldTile / map.width), goalLayer, team);
    const climb = UNIT_TYPES[u.kind[i]].climber;
    // Climbers go over walls rather than through them.
    u.field[i] = fieldKey(map, { goal: shared ? fieldTile : goal, goalLayer, team, breach: breach && !climb, climb });
    u.stuck[i] = 0;
    return true;
  }

  /** Send one unit to a point (no formation). */
  goTo(i: number, x: number, z: number, layer = 0): void {
    if (this.setDestination(i, x, z, layer)) this.units.order[i] = Order.Move;
    else this.units.order[i] = Order.Idle;
  }

  /** Advance unit i one tick toward its destination. */
  navigate(i: number, speedMul = 1): number {
    const u = this.units;
    const map = this.map;
    const type = UNIT_TYPES[u.kind[i]];
    const team = u.owner[i];
    const layer = u.layer[i];
    const x = u.x[i];
    const z = u.z[i];
    const dx = u.goalX[i] - x;
    const dz = u.goalZ[i] - z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1 && layer === u.goalLayer[i]) {
      u.vx[i] = u.vz[i] = 0;
      return Nav.Arrived;
    }
    if (u.field[i] < 0) return Nav.Unreachable;
    const spec = FlowFieldCache.decode(map, u.field[i]);

    let dirX = 0;
    let dirZ = 0;
    if (
      layer === u.goalLayer[i] &&
      dist < 10 &&
      !(spec.breach && dist > 2) &&
      map.segmentClearOn(x, z, u.goalX[i], u.goalZ[i], type.radius * 0.9, layer, team)
    ) {
      dirX = dx / dist;
      dirZ = dz / dist;
    } else {
      const field = this.flow.get(spec);
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      if (!map.inBounds(tx, tz)) return Nav.Unreachable;
      const tile = map.idx(tx, tz);
      const d = field.dir[layer * map.width * map.height + tile];
      if (d === SWITCH_LAYER) {
        u.layer[i] = 1 - layer;
        return Nav.Moving;
      }
      if (d >= CLIMB_BASE) {
        // Grapnel up (or drop down): hop into the neighbouring tile on the other layer.
        const cd = d - CLIMB_BASE;
        u.layer[i] = 1 - layer;
        u.x[i] = tx + DIR_X[cd] + 0.5;
        u.z[i] = tz + DIR_Z[cd] + 0.5;
        u.heading[i] = Math.atan2(DIR_X[cd], DIR_Z[cd]);
        return Nav.Moving;
      }
      if (d >= 0) {
        const ntx = tx + DIR_X[d];
        const ntz = tz + DIR_Z[d];
        if (spec.breach && layer === 0 && !map.walkable(ntx, ntz, 0, team)) {
          this.navObstacle = map.structAt[map.idx(ntx, ntz)];
          u.vx[i] = u.vz[i] = 0;
          return Nav.Blocked;
        }
        const nx = ntx + 0.5 - x;
        const nz = ntz + 0.5 - z;
        const nl = Math.hypot(nx, nz) || 1;
        dirX = nx / nl;
        dirZ = nz / nl;
      } else if (d === AT_GOAL) {
        dirX = dx / (dist || 1);
        dirZ = dz / (dist || 1);
      } else {
        u.vx[i] = u.vz[i] = 0;
        return Nav.Unreachable;
      }
    }

    const suppressed = u.suppressed[i] > 0 ? 0.6 : 1;
    const speed = type.speed * speedMul * suppressed * Math.min(1, 0.3 + dist / 1.0);
    u.vx[i] = u.vx[i] * 0.35 + dirX * speed * 0.65;
    u.vz[i] = u.vz[i] * 0.35 + dirZ * speed * 0.65;
    const moved = this.moveWithCollision(i, u.vx[i] * TICK_SEC, u.vz[i] * TICK_SEC);
    if (Math.abs(u.vx[i]) + Math.abs(u.vz[i]) > 0.05) {
      u.heading[i] = turnToward(u.heading[i], Math.atan2(u.vx[i], u.vz[i]), 10 * TICK_SEC);
    }
    if (moved < speed * TICK_SEC * 0.25 && dist < 2.5) {
      u.stuck[i] += TICK_SEC;
      if (u.stuck[i] > 0.6) return Nav.Stuck;
    } else {
      u.stuck[i] = Math.max(0, u.stuck[i] - TICK_SEC);
    }
    return Nav.Moving;
  }

  step(): void {
    const ev0 = this.events.length;
    const cmds = this.queue;
    this.queue = [];
    for (const c of cmds) this.apply(c);

    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      u.px[i] = u.x[i];
      u.pz[i] = u.z[i];
      u.pheading[i] = u.heading[i];
      u.pelev[i] = u.elev[i];
    }

    this.updateMovement();
    this.drones.update();
    this.combat.update();
    this.resolveOverlaps();
    this.updateElevation();
    this.economy.update();
    if (this.director) this.director.update(this);
    for (const ctl of this.controllers) ctl.update(this);
    this.vision.update();
    if (this.tick % 20 === 0) this.checkResult();
    if (this.controllers.length) {
      const stepEvents = this.events.slice(ev0);
      for (const ctl of this.controllers) ctl.observe?.(this, stepEvents);
    }
    this.tick++;
  }

  // ---------------------------------------------------------------- commands

  private apply(c: Command): void {
    const u = this.units;
    const owned = (id: number): boolean => u.isAlive(id) && u.owner[id] === c.owner && UNIT_TYPES[u.kind[id]].selectable;
    switch (c.type) {
      case 'move': {
        const ids = c.ids.filter(owned);
        this.issueMove(
          ids.filter((id) => !UNIT_TYPES[u.kind[id]].fly),
          c.x,
          c.z,
          c.layer ?? 0,
        );
        this.flyTo(
          ids.filter((id) => UNIT_TYPES[u.kind[id]].fly),
          c.x,
          c.z,
        );
        break;
      }
      case 'follow':
        if (!u.isAlive(c.leader) || u.owner[c.leader] !== c.owner) break;
        for (const id of c.ids) {
          if (!owned(id) || id === c.leader || u.order[id] === Order.Control || u.order[id] === Order.Dive) continue;
          u.order[id] = Order.Follow;
          u.leader[id] = c.leader;
          u.repath[id] = 0;
          u.target[id] = -1;
          u.targetStruct[id] = -1;
        }
        break;
      case 'launchDrone': {
        const why = this.drones.launchBlocker(c.owner, c.bay, c.kind);
        if (why) this.emit({ type: 'buildFailed', owner: c.owner, reason: why });
        else this.drones.launch(c.owner, c.bay, c.kind);
        break;
      }
      case 'controlStructure': {
        const s = this.structureById(c.id);
        if (!s || s.owner !== c.owner) break;
        const def = STRUCTURE_DEFS[s.kind];
        if (!def.turret && def.light?.kind !== 'search') break;
        s.manualUntil = this.tick + 3;
        s.aim = wrapAngle(c.yaw);
        if (def.turret) {
          if (c.reload && s.ammo < def.turret.mag && s.reload === 0) s.reload = def.turret.reloadSec;
          if (c.fire) this.combat.turretFire(s, c);
        }
        break;
      }
      case 'stop':
        for (const id of c.ids) {
          if (!owned(id)) continue;
          if (u.order[id] !== Order.Control && u.order[id] !== Order.Dive) u.order[id] = Order.Idle;
        }
        break;
      case 'attack':
        if (!u.isAlive(c.target) || u.owner[c.target] === c.owner) break;
        for (const id of c.ids) {
          if (!owned(id) || u.order[id] === Order.Dive) continue;
          if (!UNIT_TYPES[u.kind[id]].armed && !UNIT_TYPES[u.kind[id]].fly) continue;
          u.order[id] = Order.Attack;
          u.target[id] = c.target;
          u.repath[id] = 0;
        }
        break;
      case 'attackStructure': {
        const s = this.structureById(c.structure);
        if (!s || s.owner === c.owner) break;
        const armored = !!STRUCTURE_DEFS[s.kind].armored;
        for (const id of c.ids) {
          if (!owned(id)) continue;
          const t = UNIT_TYPES[u.kind[id]];
          if (u.order[id] === Order.Dive) continue;
          if (t.fly) {
            // Strike drones fly in and blow it up; recon drones go and have a look.
            if (t.blast) {
              u.order[id] = Order.Breach;
              u.targetStruct[id] = s.id;
            } else {
              this.flyTo([id], s.tx + s.w / 2, s.tz + s.h / 2);
            }
            continue;
          }
          // Small arms can't hurt walls: only units with charges take those orders.
          if (armored && u.charges[id] === 0) continue;
          if (!t.armed) continue;
          u.order[id] = Order.Breach;
          u.targetStruct[id] = s.id;
          u.plantTimer[id] = 0;
          u.repath[id] = 0;
        }
        break;
      }
      case 'assault':
        this.combat.startAssault(c.ids.filter(owned), c.target);
        break;
      case 'control': {
        const id = c.id;
        if (!u.isAlive(id) || u.owner[id] !== c.owner) return;
        const t = UNIT_TYPES[u.kind[id]];
        if (!t.controllable || u.order[id] === Order.Dive) return;
        if (u.order[id] !== Order.Control) {
          u.order[id] = Order.Control;
          u.target[id] = -1;
          u.targetStruct[id] = -1;
          u.field[id] = -1;
        }
        const len = Math.hypot(c.mx, c.mz);
        // Walking away cancels a charge you were planting.
        if (u.plantTimer[id] > 0 && len > 0.2) {
          u.plantTimer[id] = 0;
          u.targetStruct[id] = -1;
        }
        const k = len > 1 ? 1 / len : 1;
        const speed = t.speed * (c.aim && !t.fly ? 0.5 : 1) * (u.suppressed[id] > 0 ? 0.6 : 1);
        u.vx[id] = u.plantTimer[id] > 0 ? 0 : c.mx * k * speed;
        u.vz[id] = u.plantTimer[id] > 0 ? 0 : c.mz * k * speed;
        u.heading[id] = wrapAngle(c.yaw);
        if (t.fly) {
          if (c.fire && t.blast) {
            const base = this.map.heightAt(u.x[id], u.z[id]) + u.elev[id];
            this.drones.diveAlong(id, c.ex ?? u.x[id], c.ey ?? base, c.ez ?? u.z[id], c.yaw, c.pitch ?? -0.5);
          }
          break;
        }
        if (c.reload) this.combat.startReload(id);
        if (c.plant) this.combat.startPlant(id);
        if (c.fire) this.combat.controlledFire(id, c, len > 0.2);
        break;
      }
      case 'release':
        if (u.isAlive(c.id) && u.owner[c.id] === c.owner && u.order[c.id] === Order.Control) {
          u.order[c.id] = Order.Idle;
          u.vx[c.id] = u.vz[c.id] = 0;
          u.plantTimer[c.id] = 0;
          u.targetStruct[c.id] = -1;
        }
        break;
      case 'build': {
        const check = this.economy.canPlace(c.owner, c.kind, c.tx, c.tz, c.rot ?? 0);
        if (!check.ok) this.emit({ type: 'buildFailed', owner: c.owner, reason: check.reason ?? 'Cannot build' });
        else this.economy.build(c.owner, c.kind, c.tx, c.tz, c.rot ?? 0);
        break;
      }
      case 'buildWall': {
        const built = this.economy.buildWall(c.owner, c.tiles);
        if (built === 0) this.emit({ type: 'buildFailed', owner: c.owner, reason: this.economy.lastWallReason });
        break;
      }
      case 'demolish':
        this.economy.demolish(c.owner, c.id);
        break;
      case 'setActive':
        this.economy.setActive(c.owner, c.id, c.active);
        break;
      case 'setRations':
        this.economy.player(c.owner).rationLevel = Math.max(0, Math.min(4, Math.round(c.level)));
        break;
      case 'setTax':
        this.economy.player(c.owner).taxLevel = Math.max(0, Math.min(5, Math.round(c.level)));
        break;
      case 'setRecipe':
        this.economy.setRecipe(c.owner, c.id, c.recipe);
        break;
      case 'recruit':
        this.economy.recruit(c.owner, c.barracks, c.kind, c.count);
        break;
      case 'trade':
        this.economy.trade(c.owner, c.res, Math.round(c.amount));
        break;
      case 'flare': {
        const p = this.economy.player(c.owner);
        if (p.funds < FLARE_COST) {
          this.emit({ type: 'buildFailed', owner: c.owner, reason: 'Not enough funds for a flare' });
          break;
        }
        let near = false;
        for (let i = 0; i < u.count && !near; i++) {
          if (u.alive[i] && u.owner[i] === c.owner && (UNIT_TYPES[u.kind[i]].armed || UNIT_TYPES[u.kind[i]].fly)) {
            near = Math.hypot(u.x[i] - c.x, u.z[i] - c.z) <= FLARE_REACH;
          }
        }
        if (!near) {
          this.emit({ type: 'buildFailed', owner: c.owner, reason: 'Too far from your soldiers to fire a flare' });
          break;
        }
        p.funds -= FLARE_COST;
        this.vision.addFlare(c.x, c.z, c.owner);
        this.emit({ type: 'flare', owner: c.owner, x: c.x, z: c.z });
        break;
      }
      case 'setNightShift':
        this.economy.player(c.owner).nightShift = c.on;
        break;
    }
  }

  /** Drones fly straight to the point, spread a little so they don't stack. */
  private flyTo(ids: number[], x: number, z: number): void {
    const u = this.units;
    ids.forEach((id, k) => {
      if (u.order[id] === Order.Control || u.order[id] === Order.Dive) return;
      const a = k * 2.4;
      const r = k === 0 ? 0 : 1.2 + k * 0.25;
      u.order[id] = Order.Move;
      u.goalX[id] = Math.min(Math.max(x + Math.cos(a) * r, 0.5), this.map.width - 0.5);
      u.goalZ[id] = Math.min(Math.max(z + Math.sin(a) * r, 0.5), this.map.height - 0.5);
      u.target[id] = -1;
      u.targetStruct[id] = -1;
    });
  }

  private issueMove(ids: number[], tx: number, tz: number, layer: number): void {
    if (ids.length === 0) return;
    const map = this.map;
    const u = this.units;
    const team = u.owner[ids[0]];
    for (const id of ids) {
      u.target[id] = -1;
      u.targetStruct[id] = -1;
      u.plantTimer[id] = 0;
    }

    if (layer === 1 && map.nearestOnLayer(Math.floor(tx), Math.floor(tz), 1, team, 2) >= 0) {
      this.issueDeckMove(ids, tx, tz, team);
      return;
    }

    const goalTile = map.nearestOnLayer(Math.floor(tx), Math.floor(tz), 0, team);
    if (goalTile < 0) return;
    const gx = (goalTile % map.width) + 0.5;
    const gz = Math.floor(goalTile / map.width) + 0.5;
    const cx = map.walkableAt(tx, tz, 0, team) ? tx : gx;
    const cz = map.walkableAt(tx, tz, 0, team) ? tz : gz;

    // Formation facing: from the group's centroid toward the target.
    let mx = 0;
    let mz = 0;
    for (const id of ids) {
      mx += u.x[id];
      mz += u.z[id];
    }
    mx /= ids.length;
    mz /= ids.length;
    let fx = cx - mx;
    let fz = cz - mz;
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-3) {
      fx = 0;
      fz = 1;
    } else {
      fx /= fl;
      fz /= fl;
    }
    const rx = -fz;
    const rz = fx;

    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length * 1.6)));
    const rows = Math.ceil(ids.length / cols);
    const sorted = ids
      .map((id) => ({ id, f: (u.x[id] - mx) * fx + (u.z[id] - mz) * fz, r: (u.x[id] - mx) * rx + (u.z[id] - mz) * rz }))
      .sort((a, b) => b.f - a.f || a.id - b.id);

    for (let row = 0; row < rows; row++) {
      const slice = sorted.slice(row * cols, row * cols + cols).sort((a, b) => a.r - b.r || a.id - b.id);
      const inRow = slice.length;
      for (let col = 0; col < inRow; col++) {
        const id = slice[col].id;
        const offR = (col - (inRow - 1) / 2) * FORMATION_SPACING;
        const offF = -(row - (rows - 1) / 2) * FORMATION_SPACING;
        let sx = cx + rx * offR + fx * offF;
        let sz = cz + rz * offR + fz * offF;
        if (!map.walkableAt(sx, sz, 0, team)) {
          const t = map.nearestOnLayer(Math.floor(sx), Math.floor(sz), 0, team, 6);
          if (t >= 0) {
            sx = (t % map.width) + 0.5;
            sz = Math.floor(t / map.width) + 0.5;
          } else {
            sx = gx;
            sz = gz;
          }
        }
        if (this.setDestination(id, sx, sz, 0, false, goalTile)) u.order[id] = Order.Move;
      }
    }
  }

  /** Spread a group along the wall tops nearest the target, one per tile. */
  private issueDeckMove(ids: number[], tx: number, tz: number, team: number): void {
    const map = this.map;
    const u = this.units;
    const start = map.nearestOnLayer(Math.floor(tx), Math.floor(tz), 1, team, 2);
    const tiles: number[] = [];
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length && tiles.length < ids.length) {
      const t = queue.shift()!;
      if (!map.stairs[t]) tiles.push(t);
      const x = t % map.width;
      const z = (t - x) / map.width;
      for (let d = 0; d < 8; d++) {
        const nx = x + DIR_X[d];
        const nz = z + DIR_Z[d];
        if (!map.walkable(nx, nz, 1, team)) continue;
        const ni = map.idx(nx, nz);
        if (seen.has(ni)) continue;
        seen.add(ni);
        queue.push(ni);
      }
    }
    if (tiles.length === 0) tiles.push(start);
    const sorted = [...ids].sort(
      (a, b) => Math.hypot(u.x[a] - tx, u.z[a] - tz) - Math.hypot(u.x[b] - tx, u.z[b] - tz) || a - b,
    );
    sorted.forEach((id, k) => {
      const t = tiles[k % tiles.length];
      const lap = Math.floor(k / tiles.length);
      const ox = lap ? ((lap % 2) - 0.5) * 0.4 : 0;
      if (this.setDestination(id, (t % map.width) + 0.5 + ox, Math.floor(t / map.width) + 0.5, 1)) {
        u.order[id] = Order.Move;
      }
    });
  }

  // ---------------------------------------------------------------- movement

  private updateMovement(): void {
    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const order = u.order[i];
      if (UNIT_TYPES[u.kind[i]].fly) continue; // see Drones
      if (order === Order.Control) {
        this.controlMove(i);
        this.combat.tickPlant(i);
        if (u.cooldown[i] > 0) u.cooldown[i]--;
        continue;
      }
      if (order === Order.Follow) {
        this.follow(i);
        continue;
      }
      if (order !== Order.Move) {
        if (order === Order.Idle) u.vx[i] = u.vz[i] = 0;
        continue;
      }
      const r = this.navigate(i);
      if (r !== Nav.Moving) {
        u.order[i] = Order.Idle;
        u.vx[i] = u.vz[i] = 0;
      }
    }
  }

  /**
   * Possessed movement: slide along obstacles, take stairs up and down by walking onto/off them,
   * and (climbers) scale a wall by walking into it or drop off one by walking over the edge.
   */
  private controlMove(i: number): void {
    const u = this.units;
    const map = this.map;
    const dx = u.vx[i] * TICK_SEC;
    const dz = u.vz[i] * TICK_SEC;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      const moved = this.moveWithCollision(i, dx, dz);
      if (moved < len * 0.4) {
        // Blocked: maybe step onto the other layer ahead.
        const t = UNIT_TYPES[u.kind[i]];
        const ax = u.x[i] + (dx / len) * 0.6;
        const az = u.z[i] + (dz / len) * 0.6;
        const tx = Math.floor(ax);
        const tz = Math.floor(az);
        const here = map.idx(Math.floor(u.x[i]), Math.floor(u.z[i]));
        if (map.inBounds(tx, tz)) {
          const ahead = map.idx(tx, tz);
          if (u.layer[i] === 0 && t.climber && map.deck[ahead] && map.walkable(tx, tz, 1, u.owner[i])) {
            u.layer[i] = 1;
            u.x[i] = ax;
            u.z[i] = az;
          } else if (
            u.layer[i] === 1 &&
            !map.deck[ahead] &&
            (t.climber || map.stairs[here]) &&
            map.walkableAt(ax + (dx / len) * 0.25, az + (dz / len) * 0.25, 0, u.owner[i])
          ) {
            u.layer[i] = 0;
            u.x[i] = ax + (dx / len) * 0.25;
            u.z[i] = az + (dz / len) * 0.25;
          }
        }
      }
    }
    // Walking onto stairs takes you up.
    const tile = map.idx(Math.floor(u.x[i]), Math.floor(u.z[i]));
    if (map.stairs[tile] && u.layer[i] === 0 && map.deck[tile]) u.layer[i] = 1;
  }

  /** Squad follower: keep a slot behind the leader, re-pathing as they move. */
  private follow(i: number): void {
    const u = this.units;
    const l = u.leader[i];
    if (!u.isAlive(l) || u.owner[l] !== u.owner[i]) {
      u.order[i] = Order.Idle;
      u.leader[i] = -1;
      u.vx[i] = u.vz[i] = 0;
      return;
    }
    // Flank and trail the leader, clear of the over-the-shoulder camera (behind-right of them).
    const slot = i % 6;
    const SLOTS = [
      [-1.7, 0.6],
      [1.9, 0.9],
      [-2.6, 2.2],
      [2.8, 2.6],
      [-1.2, 3.8],
      [1.4, 4.2],
    ];
    const [lat, back] = SLOTS[slot];
    const h = u.heading[l];
    const sx = u.x[l] - Math.sin(h) * back + Math.cos(h) * lat;
    const sz = u.z[l] - Math.cos(h) * back - Math.sin(h) * lat;
    const near = Math.hypot(u.x[l] - u.x[i], u.z[l] - u.z[i]);
    if (near < 3 && u.layer[i] === u.layer[l]) {
      // Close enough: drift toward the slot, don't crowd the leader.
      const d = Math.hypot(sx - u.x[i], sz - u.z[i]);
      if (d > 0.5 && this.map.walkableAt(sx, sz, u.layer[i], u.owner[i])) {
        const sp = UNIT_TYPES[u.kind[i]].speed * 0.8;
        u.vx[i] = ((sx - u.x[i]) / d) * sp;
        u.vz[i] = ((sz - u.z[i]) / d) * sp;
        this.moveWithCollision(i, u.vx[i] * TICK_SEC, u.vz[i] * TICK_SEC);
      } else {
        u.vx[i] = u.vz[i] = 0;
      }
      return;
    }
    if (u.repath[i] === 0 || u.field[i] < 0) {
      const ok = this.map.walkableAt(sx, sz, u.layer[l], u.owner[i]);
      this.setDestination(i, ok ? sx : u.x[l], ok ? sz : u.z[l], u.layer[l]);
      u.repath[i] = 15;
    }
    if (this.navigate(i) !== Nav.Moving) u.vx[i] = u.vz[i] = 0;
  }

  /** Move with per-axis sliding against tiles this unit can't occupy. Returns distance moved. */
  moveWithCollision(i: number, dx: number, dz: number): number {
    const u = this.units;
    const map = this.map;
    const layer = u.layer[i];
    const team = u.owner[i];
    const r = layer === 1 ? 0 : UNIT_TYPES[u.kind[i]].radius;
    const ok = (px: number, pz: number): boolean => map.walkableAt(px, pz, layer, team);
    const x = u.x[i];
    const z = u.z[i];
    let nx = x + dx;
    if (dx !== 0) {
      const ex = nx + Math.sign(dx) * r;
      if (!ok(ex, z - r * 0.7) || !ok(ex, z + r * 0.7)) nx = x;
    }
    let nz = z + dz;
    if (dz !== 0) {
      const ez = nz + Math.sign(dz) * r;
      if (!ok(nx - r * 0.7, ez) || !ok(nx + r * 0.7, ez)) nz = z;
    }
    if (layer === 1 && !ok(nx, nz)) {
      nx = x;
      nz = z;
    }
    nx = Math.min(Math.max(nx, 0.3), map.width - 0.3);
    nz = Math.min(Math.max(nz, 0.3), map.height - 0.3);
    u.x[i] = nx;
    u.z[i] = nz;
    return Math.hypot(nx - x, nz - z);
  }

  private updateElevation(): void {
    const u = this.units;
    const map = this.map;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || UNIT_TYPES[u.kind[i]].fly) continue;
      let target = 0;
      if (u.layer[i] === 1) {
        const tx = Math.floor(u.x[i]);
        const tz = Math.floor(u.z[i]);
        target = map.inBounds(tx, tz) ? map.deckH[map.idx(tx, tz)] : 0;
      }
      u.elev[i] += (target - u.elev[i]) * 0.35;
    }
  }

  private rebuildSpatialHash(): void {
    const u = this.units;
    const w = this.map.width;
    this.cellHead.fill(-1);
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const c = Math.floor(u.z[i]) * w + Math.floor(u.x[i]);
      this.cellNext[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  /** Positional separation so units don't stack (per layer). Moving units shoulder idle ones aside. */
  private resolveOverlaps(): void {
    const u = this.units;
    const map = this.map;
    const w = map.width;
    this.rebuildSpatialHash();

    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || UNIT_TYPES[u.kind[i]].fly) continue;
      const ri = UNIT_TYPES[u.kind[i]].radius;
      const cx = Math.floor(u.x[i]);
      const cz = Math.floor(u.z[i]);
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gz = cz + oz;
          if (gx < 0 || gz < 0 || gx >= w || gz >= map.height) continue;
          for (let j = this.cellHead[gz * w + gx]; j >= 0; j = this.cellNext[j]) {
            if (j <= i || u.layer[j] !== u.layer[i] || UNIT_TYPES[u.kind[j]].fly) continue;
            const rj = UNIT_TYPES[u.kind[j]].radius;
            let dx = u.x[j] - u.x[i];
            let dz = u.z[j] - u.z[i];
            let d = Math.hypot(dx, dz);
            const min = (ri + rj) * (u.layer[i] === 1 ? 0.7 : 1);
            if (d >= min) continue;
            if (d < 1e-4) {
              const a = ((i * 7919 + j * 104729) % 628) / 100;
              dx = Math.cos(a);
              dz = Math.sin(a);
              d = 1;
            } else {
              dx /= d;
              dz /= d;
            }
            const overlap = min - Math.min(d, min);
            const wi = this.pushWeight(i, j);
            const ci = Math.min(overlap * wi, 0.12);
            const cj = Math.min(overlap * (1 - wi), 0.12);
            if (ci > 0) this.moveWithCollision(i, -dx * ci, -dz * ci);
            if (cj > 0) this.moveWithCollision(j, dx * cj, dz * cj);
          }
        }
      }
    }
  }

  /** Fraction of the overlap correction applied to unit i (rest goes to j). */
  private pushWeight(i: number, j: number): number {
    const u = this.units;
    const moving = (k: number): boolean => u.vx[k] !== 0 || u.vz[k] !== 0;
    if (u.order[i] === Order.Control) return 0;
    if (u.order[j] === Order.Control) return 1;
    if (moving(i) && !moving(j)) return 0.2;
    if (moving(j) && !moving(i)) return 0.8;
    return 0.5;
  }

  // ---------------------------------------------------------------- results

  commanderOf(owner: number): number {
    const u = this.units;
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === owner && u.kind[i] === 1) return i;
    return -1;
  }

  private checkResult(): void {
    if ((!this.director && !this.opponent) || this.result) return;
    const hq = this.economy.hqOf(this.defender);
    let res: Sim['result'] = null;
    if (!hq) res = { result: 'defeat', reason: 'Your HQ was destroyed.' };
    else if (this.commanderOf(this.defender) < 0) res = { result: 'defeat', reason: 'Your Commander was killed.' };
    else if (this.director?.done) res = { result: 'victory', reason: 'Every wave was beaten back.' };
    else if (this.opponent && !this.economy.hqOf(this.opponent)) res = { result: 'victory', reason: 'You destroyed the enemy HQ.' };
    else if (this.opponent && this.commanderOf(this.opponent) < 0) {
      res = { result: 'victory', reason: 'The enemy Commander is dead.' };
    }
    if (res) {
      this.result = res;
      this.emit({ type: 'result', ...res });
    }
  }

  // ---------------------------------------------------------------- utilities

  /** FNV-1a hash of the sim state, for determinism tests. */
  hash(): number {
    const u = this.units;
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 24) & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    mix(this.tick);
    for (const p of this.economy.players.values()) {
      mix(Math.round(p.funds * 100));
      mix(Math.round(p.morale * 100));
      for (const v of p.stock) mix(Math.round(v * 100));
    }
    mix(this.structures.length);
    mix(this.vision.flares.length);
    for (const s of this.structures) mix(Math.round(s.hp) * 2 + (s.powered ? 1 : 0));
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      mix(i);
      f32[0] = u.x[i];
      mix(u32[0]);
      f32[0] = u.z[i];
      mix(u32[0]);
      f32[0] = u.hp[i];
      mix(u32[0]);
      mix(u.order[i]);
      mix(u.layer[i]);
      mix(u.ammo[i]);
      mix(Math.round(u.battery[i] * 10));
    }
    for (const s of this.structures) if (STRUCTURE_DEFS[s.kind].turret) mix(s.ammo * 1000 + Math.round(s.aim * 100));
    return h >>> 0;
  }
}

/** Rotate angle `a` toward `b` by at most `maxStep` radians (shortest way). */
export function turnToward(a: number, b: number, maxStep: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const r = Math.abs(d) <= maxStep ? a + d : a + Math.sign(d) * maxStep;
  return wrapAngle(r);
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
