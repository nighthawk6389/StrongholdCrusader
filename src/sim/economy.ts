import { TICK_RATE, TICK_SEC } from './clock';
import { Block, Tile } from './map';
import type { Sim } from './sim';
import {
  FOOD_RES,
  MATERIAL_RES,
  RES_COUNT,
  RES_INFO,
  STRUCTURE_DEFS,
  type Cost,
  type ResId,
  type Structure,
  type StructureKind,
} from './structures';
import { UnitKind } from './unitTypes';
import { CARRY_LOG, CARRY_NONE, Order, Task } from './units';

// ------------------------------------------------------------------ tuning tables

export interface RationLevel {
  key: string;
  name: string;
  /** Food units eaten per civilian per minute. */
  perMin: number;
  morale: number;
}

export const RATION_LEVELS: RationLevel[] = [
  { key: 'none', name: 'None', perMin: 0, morale: -8 },
  { key: 'half', name: 'Half', perMin: 0.25, morale: -3 },
  { key: 'normal', name: 'Normal', perMin: 0.5, morale: 2 },
  { key: 'extra', name: 'Extra', perMin: 0.75, morale: 5 },
  { key: 'double', name: 'Double', perMin: 1, morale: 8 },
];

export interface TaxLevel {
  key: string;
  name: string;
  /** Funds per civilian per minute (negative = bribe paid out). */
  perMin: number;
  morale: number;
}

export const TAX_LEVELS: TaxLevel[] = [
  { key: 'bribe', name: 'Bribe', perMin: -1, morale: 5 },
  { key: 'none', name: 'None', perMin: 0, morale: 2 },
  { key: 'low', name: 'Low', perMin: 1, morale: 0 },
  { key: 'normal', name: 'Normal', perMin: 1.6, morale: -2 },
  { key: 'high', name: 'High', perMin: 2.4, morale: -5 },
  { key: 'extortionate', name: 'Extortionate', perMin: 3.4, morale: -9 },
];

/** Morale moves by (sum of factors) / MORALE_DIVISOR per second. */
const MORALE_DIVISOR = 20;
/** Max distance from your HQ at which you may build. */
export const BUILD_RADIUS = 40;
const ENEMY_KEEP_OUT = 10;
const TREE_SEARCH_RADIUS = 36;
const CHOP_SEC = 3;
const ARRIVE_R = 1.25;
/** Fraction of cost refunded on demolish. */
const REFUND = 0.5;

export interface MoraleFactor {
  key: string;
  label: string;
  value: number;
}

export class PlayerEconomy {
  /** Only active economies eat, pay taxes and attract civilians (the enemy gets one with the AI in M3). */
  active = false;
  funds = 0;
  readonly stock = new Float64Array(RES_COUNT);
  morale = 60;
  rationLevel = 2;
  taxLevel = 3;
  // Derived each economy second:
  population = 0;
  idle = 0;
  housing = 0;
  materialsCap = 0;
  foodCap = 0;
  /** Seconds of food left at the current ration level (Infinity if not eating). */
  foodSeconds = Infinity;
  factors: MoraleFactor[] = [];
  moraleTrend = 0;
  arrivalTimer = 0;
  departTimer = 0;

  constructor(readonly owner: number) {}

  stored(kind: 'materials' | 'food'): number {
    const ids = kind === 'food' ? FOOD_RES : MATERIAL_RES;
    let s = 0;
    for (const r of ids) s += this.stock[r];
    return s;
  }

  canAfford(c: Cost): boolean {
    return (
      (c.funds ?? 0) <= this.funds + 1e-9 &&
      (c.timber ?? 0) <= this.stock[0] + 1e-9 &&
      (c.concrete ?? 0) <= this.stock[1] + 1e-9
    );
  }
}

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
}

/** Economy: population, morale, storage, placement, and the civilian work cycle. */
export class Economy {
  readonly players = new Map<number, PlayerEconomy>();
  private secTimer = 0;

  constructor(private sim: Sim) {}

  player(owner: number): PlayerEconomy {
    let p = this.players.get(owner);
    if (!p) {
      p = new PlayerEconomy(owner);
      this.players.set(owner, p);
    }
    return p;
  }

  // ------------------------------------------------------------------ placement

  hqOf(owner: number): Structure | undefined {
    return this.sim.structures.find((s) => s.owner === owner && s.kind === 'hq');
  }

  canPlace(owner: number, kind: StructureKind, tx: number, tz: number): PlaceCheck {
    const def = STRUCTURE_DEFS[kind];
    const map = this.sim.map;
    if (!def.buildable) return { ok: false, reason: 'Not buildable' };
    for (let z = tz; z < tz + def.h; z++) {
      for (let x = tx; x < tx + def.w; x++) {
        if (!map.inBounds(x, z)) return { ok: false, reason: 'Off the map' };
        const i = map.idx(x, z);
        if (map.blocked[i] !== Block.Free) return { ok: false, reason: 'Blocked' };
        if (map.treeAt[i] >= 0) return { ok: false, reason: 'Trees in the way' };
      }
    }
    const cx = tx + def.w / 2;
    const cz = tz + def.h / 2;
    const hq = this.hqOf(owner);
    if (hq && Math.hypot(cx - (hq.tx + hq.w / 2), cz - (hq.tz + hq.h / 2)) > BUILD_RADIUS) {
      return { ok: false, reason: 'Too far from your HQ' };
    }
    for (const s of this.sim.structures) {
      if (s.owner === owner) continue;
      if (Math.hypot(cx - (s.tx + s.w / 2), cz - (s.tz + s.h / 2)) < ENEMY_KEEP_OUT) {
        return { ok: false, reason: 'Too close to the enemy' };
      }
    }
    if (def.requires === 'nearRock') {
      let rock = 0;
      for (let z = tz - 1; z <= tz + def.h; z++) {
        for (let x = tx - 1; x <= tx + def.w; x++) {
          if (map.inBounds(x, z) && map.tileAt(x, z) === Tile.Rock) rock++;
        }
      }
      if (rock < 2) return { ok: false, reason: 'Must touch a rock outcrop' };
    }
    if (def.requires === 'fertile') {
      let fertile = 0;
      for (let z = tz; z < tz + def.h; z++) {
        for (let x = tx; x < tx + def.w; x++) if (map.tileAt(x, z) === Tile.Fertile) fertile++;
      }
      if (fertile < Math.ceil(def.w * def.h * 0.6)) return { ok: false, reason: 'Needs fertile ground' };
    }
    if (this.findDoor(tx, tz, def.w, def.h, owner) === null) return { ok: false, reason: 'No access' };
    const p = this.player(owner);
    if (!p.canAfford(def.cost)) {
      if ((def.cost.timber ?? 0) > p.stock[0]) return { ok: false, reason: 'Not enough timber' };
      if ((def.cost.concrete ?? 0) > p.stock[1]) return { ok: false, reason: 'Not enough concrete' };
      return { ok: false, reason: 'Not enough funds' };
    }
    return { ok: true };
  }

  /** Validate, pay and place. Returns the new structure or null. */
  build(owner: number, kind: StructureKind, tx: number, tz: number): Structure | null {
    if (!this.canPlace(owner, kind, tx, tz).ok) return null;
    const def = STRUCTURE_DEFS[kind];
    const p = this.player(owner);
    p.funds -= def.cost.funds ?? 0;
    p.stock[0] -= def.cost.timber ?? 0;
    p.stock[1] -= def.cost.concrete ?? 0;
    const s = this.sim.placeStructure(kind, owner, tx, tz);
    if (s) this.displaceUnits(s);
    this.recount();
    return s;
  }

  demolish(owner: number, id: number): boolean {
    const s = this.sim.structureById(id);
    if (!s || s.owner !== owner || !STRUCTURE_DEFS[s.kind].buildable) return false;
    for (const w of [...s.workers]) this.release(w);
    const cost = STRUCTURE_DEFS[s.kind].cost;
    const p = this.player(owner);
    p.funds += Math.floor((cost.funds ?? 0) * REFUND);
    p.stock[0] += Math.floor((cost.timber ?? 0) * REFUND);
    p.stock[1] += Math.floor((cost.concrete ?? 0) * REFUND);
    this.sim.removeStructure(s);
    this.recount();
    this.clampStock(p);
    return true;
  }

  setActive(owner: number, id: number, active: boolean): void {
    const s = this.sim.structureById(id);
    if (!s || s.owner !== owner) return;
    s.active = active;
    if (!active) {
      for (const w of [...s.workers]) this.release(w);
      s.status = 'paused';
    }
  }

  /** Walkable tile next to the footprint, preferring the side facing the owner's HQ. */
  findDoor(tx: number, tz: number, w: number, h: number, owner: number): { x: number; z: number } | null {
    const map = this.sim.map;
    const hq = this.hqOf(owner);
    const fx = hq ? hq.tx + hq.w / 2 : map.width / 2;
    const fz = hq ? hq.tz + hq.h / 2 : map.height / 2;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    const consider = (x: number, z: number): void => {
      if (!map.isWalkableTile(x, z)) return;
      const d = Math.hypot(x + 0.5 - fx, z + 0.5 - fz);
      if (d < bestD) {
        bestD = d;
        best = { x: x + 0.5, z: z + 0.5 };
      }
    };
    for (let x = tx; x < tx + w; x++) {
      consider(x, tz - 1);
      consider(x, tz + h);
    }
    for (let z = tz; z < tz + h; z++) {
      consider(tx - 1, z);
      consider(tx + w, z);
    }
    return best;
  }

  /** The door of `s`, recomputed if something has since been built on it. */
  door(s: Structure): { x: number; z: number } {
    if (!this.sim.map.isWalkable(s.doorX, s.doorZ)) {
      const d = this.findDoor(s.tx, s.tz, s.w, s.h, s.owner);
      if (d) {
        s.doorX = d.x;
        s.doorZ = d.z;
      }
    }
    return { x: s.doorX, z: s.doorZ };
  }

  private displaceUnits(s: Structure): void {
    const u = this.sim.units;
    const map = this.sim.map;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const x = Math.floor(u.x[i]);
      const z = Math.floor(u.z[i]);
      if (x < s.tx || z < s.tz || x >= s.tx + s.w || z >= s.tz + s.h) continue;
      const t = map.nearestWalkable(x, z, 8);
      if (t < 0) continue;
      u.x[i] = u.px[i] = (t % map.width) + 0.5;
      u.z[i] = u.pz[i] = Math.floor(t / map.width) + 0.5;
    }
  }

  // ------------------------------------------------------------------ per tick

  update(): void {
    const u = this.sim.units;
    const rate = 0.35 + 0.65 * this.sim.cycle.daylight;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.kind[i] !== UnitKind.Civilian) continue;
      this.updateCivilian(i, rate);
    }
    if (++this.secTimer >= TICK_RATE) {
      this.secTimer = 0;
      this.recount();
      for (const p of this.players.values()) if (p.active) this.perSecond(p);
      this.assignJobs();
    }
  }

  /** Recompute population, housing and storage capacity for every player. */
  recount(): void {
    for (const p of this.players.values()) {
      p.population = 0;
      p.idle = 0;
      p.housing = 0;
      p.materialsCap = 0;
      p.foodCap = 0;
    }
    const u = this.sim.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.kind[i] !== UnitKind.Civilian) continue;
      const p = this.player(u.owner[i]);
      p.population++;
      if (u.job[i] < 0) p.idle++;
    }
    for (const s of this.sim.structures) {
      const def = STRUCTURE_DEFS[s.kind];
      if (!def.housing && !def.storage) continue;
      const p = this.player(s.owner);
      p.housing += def.housing ?? 0;
      if (def.storage?.kind === 'materials') p.materialsCap += def.storage.capacity;
      if (def.storage?.kind === 'food') p.foodCap += def.storage.capacity;
    }
  }

  private clampStock(p: PlayerEconomy): void {
    // Storage lost (e.g. a depot demolished): spill the excess proportionally.
    for (const kind of ['materials', 'food'] as const) {
      const cap = kind === 'food' ? p.foodCap : p.materialsCap;
      const have = p.stored(kind);
      if (have <= cap || have <= 0) continue;
      const k = cap / have;
      for (const r of kind === 'food' ? FOOD_RES : MATERIAL_RES) p.stock[r] *= k;
    }
  }

  private perSecond(p: PlayerEconomy): void {
    // --- Food
    const level = RATION_LEVELS[p.rationLevel];
    const need = (p.population * level.perMin) / 60;
    const totalFood = p.stored('food');
    let effectiveRation = p.rationLevel;
    if (need > 0) {
      if (totalFood >= need) {
        for (const r of FOOD_RES) p.stock[r] -= (need * p.stock[r]) / totalFood;
        p.foodSeconds = totalFood / need;
      } else {
        for (const r of FOOD_RES) p.stock[r] = 0;
        effectiveRation = 0;
        p.foodSeconds = 0;
      }
    } else {
      p.foodSeconds = Infinity;
    }
    let types = 0;
    for (const r of FOOD_RES) if (p.stock[r] >= 1) types++;
    const variety = effectiveRation > 0 ? Math.max(0, types - 1) * 2 : 0;

    // --- Taxes
    let tax = TAX_LEVELS[p.taxLevel];
    const income = (p.population * tax.perMin) / 60;
    if (income < 0 && p.funds < -income) tax = TAX_LEVELS[1];
    else p.funds += income;

    // --- Morale
    const factors: MoraleFactor[] = [
      {
        key: 'rations',
        label: effectiveRation === p.rationLevel ? `Rations: ${level.name}` : 'Rations: none (out of food!)',
        value: RATION_LEVELS[effectiveRation].morale,
      },
      { key: 'variety', label: `Food variety (${types} type${types === 1 ? '' : 's'})`, value: variety },
      { key: 'taxes', label: `Taxes: ${tax.name}`, value: tax.morale },
    ];
    if (p.population > p.housing) factors.push({ key: 'housing', label: 'Overcrowding', value: -4 });
    const total = factors.reduce((a, f) => a + f.value, 0);
    p.factors = factors;
    p.moraleTrend = total;
    p.morale = Math.min(100, Math.max(0, p.morale + total / MORALE_DIVISOR));

    // --- Population flow
    if (p.morale >= 50 && p.population < p.housing) {
      p.departTimer = 0;
      p.arrivalTimer++;
      const interval = 10 - ((p.morale - 50) / 50) * 7;
      if (p.arrivalTimer >= interval) {
        p.arrivalTimer = 0;
        const n = Math.min(2, p.housing - p.population);
        this.spawnArrivals(p.owner, n);
      }
    } else if (p.morale < 50 || p.population > p.housing) {
      p.arrivalTimer = 0;
      p.departTimer++;
      const interval = p.morale < 50 ? 10 - ((50 - p.morale) / 50) * 7 : 6;
      if (p.departTimer >= interval && p.population > 0) {
        p.departTimer = 0;
        this.departOne(p.owner);
      }
    }
  }

  private hubOf(owner: number): Structure | undefined {
    return this.sim.structures.find((s) => s.owner === owner && s.kind === 'hub') ?? this.hqOf(owner);
  }

  spawnArrivals(owner: number, n: number): void {
    const hub = this.hubOf(owner);
    if (!hub) return;
    const d = this.door(hub);
    for (let k = 0; k < n; k++) {
      const id = this.sim.spawnUnit(
        UnitKind.Civilian,
        owner,
        d.x + (this.sim.rng.next() - 0.5) * 0.6,
        d.z + (this.sim.rng.next() - 0.5) * 0.6,
        this.sim.rng.next() * Math.PI * 2,
      );
      if (id >= 0) this.sim.emit({ type: 'arrived', owner, unit: id });
    }
    this.recount();
  }

  private departOne(owner: number): void {
    const u = this.sim.units;
    let pick = -1;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== owner || u.kind[i] !== UnitKind.Civilian) continue;
      if (u.job[i] < 0) {
        pick = i;
        break;
      }
      if (pick < 0) pick = i;
    }
    if (pick < 0) return;
    this.release(pick);
    this.sim.emit({ type: 'departed', owner, x: u.x[pick], z: u.z[pick] });
    u.kill(pick);
    this.recount();
  }

  // ------------------------------------------------------------------ jobs

  private assignJobs(): void {
    const u = this.sim.units;
    for (const s of this.sim.structures) {
      const def = STRUCTURE_DEFS[s.kind];
      if (!def.jobs) continue;
      if (!s.active) {
        s.status = 'paused';
        continue;
      }
      s.workers = s.workers.filter((w) => u.isAlive(w) && u.job[w] === s.id);
      while (s.workers.length < def.jobs) {
        const d = this.door(s);
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < u.count; i++) {
          if (!u.alive[i] || u.owner[i] !== s.owner || u.kind[i] !== UnitKind.Civilian || u.job[i] >= 0) continue;
          const dist = Math.hypot(u.x[i] - d.x, u.z[i] - d.z);
          if (dist < bestD) {
            bestD = dist;
            best = i;
          }
        }
        if (best < 0) break;
        s.workers.push(best);
        u.job[best] = s.id;
        u.carry[best] = CARRY_NONE;
        this.startLeg(best, Task.ToWork, d.x, d.z);
      }
      if (s.workers.length === 0) s.status = 'noWorker';
    }
  }

  /** Detach a civilian from its job (drops any cargo) and send it back to the hub. */
  release(i: number): void {
    const u = this.sim.units;
    const s = u.job[i] >= 0 ? this.sim.structureById(u.job[i]) : undefined;
    if (s) s.workers = s.workers.filter((w) => w !== i);
    u.job[i] = -1;
    u.carry[i] = CARRY_NONE;
    u.carryAmt[i] = 0;
    u.task[i] = Task.Idle;
    u.taskTimer[i] = 0;
    if (u.alive[i]) {
      const hub = this.hubOf(u.owner[i]);
      if (hub) {
        const d = this.door(hub);
        this.sim.goTo(i, d.x, d.z);
      }
    }
  }

  /** Called by the sim when any unit dies. */
  onUnitRemoved(i: number): void {
    const u = this.sim.units;
    if (u.job[i] >= 0) {
      const s = this.sim.structureById(u.job[i]);
      if (s) s.workers = s.workers.filter((w) => w !== i);
    }
  }

  private startLeg(i: number, task: number, x: number, z: number): void {
    const u = this.sim.units;
    u.task[i] = task;
    u.retries[i] = 0;
    this.sim.goTo(i, x, z);
  }

  /** True if the unit is at (x,z). Re-paths if it stopped short; gives up after a few tries. */
  private reached(i: number, x: number, z: number, r = ARRIVE_R): boolean | 'stuck' {
    const u = this.sim.units;
    const d = Math.hypot(u.x[i] - x, u.z[i] - z);
    if (d <= r) {
      if (u.order[i] === Order.Move) u.order[i] = Order.Idle;
      return true;
    }
    if (u.order[i] === Order.Idle) {
      if (u.retries[i] >= 4) return 'stuck';
      u.retries[i]++;
      this.sim.goTo(i, x, z);
    }
    return false;
  }

  private updateCivilian(i: number, rate: number): void {
    const u = this.sim.units;
    if (u.order[i] === Order.Control) return;
    const jobId = u.job[i];
    if (jobId < 0) {
      this.updateIdle(i);
      return;
    }
    const s = this.sim.structureById(jobId);
    if (!s || !s.active) {
      this.release(i);
      return;
    }
    const prod = STRUCTURE_DEFS[s.kind].producer;
    if (!prod) {
      this.release(i);
      return;
    }
    const door = this.door(s);

    switch (u.task[i]) {
      case Task.Idle:
      case Task.ToWork: {
        const r = this.reached(i, door.x, door.z);
        if (r === 'stuck') return this.wait(i, 2);
        if (!r) return;
        if (prod.gather === 'tree' && u.carry[i] !== CARRY_LOG) {
          this.goToTree(i, s);
        } else {
          u.task[i] = Task.Working;
          u.taskTimer[i] = prod.work;
          u.carry[i] = CARRY_NONE;
          s.status = 'ok';
        }
        return;
      }
      case Task.Working:
        u.taskTimer[i] -= TICK_SEC * rate;
        if (u.taskTimer[i] <= 0) {
          u.carry[i] = prod.output;
          u.carryAmt[i] = prod.batch;
          this.goToStore(i, s, prod.output);
        }
        return;
      case Task.ToTree: {
        const tree = this.sim.map.trees[u.dest[i]];
        if (!tree || tree.wood <= 0) return this.goToTree(i, s);
        const r = this.reached(i, tree.x, tree.z, 0.9);
        if (r === 'stuck') return this.goToTree(i, s);
        if (r) {
          u.task[i] = Task.Chopping;
          u.taskTimer[i] = CHOP_SEC;
        }
        return;
      }
      case Task.Chopping: {
        const tree = this.sim.map.trees[u.dest[i]];
        if (!tree || tree.wood <= 0) return this.goToTree(i, s);
        u.taskTimer[i] -= TICK_SEC * rate;
        if (u.taskTimer[i] <= 0) {
          tree.wood--;
          if (tree.wood <= 0) {
            this.sim.map.clearTree(u.dest[i]);
            this.sim.emit({ type: 'treeFelled', index: u.dest[i] });
          }
          u.carry[i] = CARRY_LOG;
          u.carryAmt[i] = 1;
          this.startLeg(i, Task.ToWork, door.x, door.z);
        }
        return;
      }
      case Task.ToStore: {
        const store = this.sim.structureById(u.dest[i]);
        if (!store) return this.goToStore(i, s, u.carry[i] as ResId);
        const sd = this.door(store);
        const r = this.reached(i, sd.x, sd.z);
        if (r === 'stuck') return this.wait(i, 2);
        if (!r) return;
        this.deposit(i, s);
        this.startLeg(i, Task.ToWork, door.x, door.z);
        return;
      }
      case Task.Wait:
        u.taskTimer[i] -= TICK_SEC;
        if (u.taskTimer[i] > 0) return;
        if (u.carry[i] >= 0 && u.carry[i] < RES_COUNT) this.goToStore(i, s, u.carry[i] as ResId);
        else this.startLeg(i, Task.ToWork, door.x, door.z);
        return;
    }
  }

  private wait(i: number, sec: number): void {
    const u = this.sim.units;
    u.task[i] = Task.Wait;
    u.taskTimer[i] = sec;
    if (u.order[i] === Order.Move) u.order[i] = Order.Idle;
  }

  private goToTree(i: number, s: Structure): void {
    const u = this.sim.units;
    const map = this.sim.map;
    const cx = s.tx + s.w / 2;
    const cz = s.tz + s.h / 2;
    let best = -1;
    let bestD = TREE_SEARCH_RADIUS;
    for (let t = 0; t < map.trees.length; t++) {
      const tree = map.trees[t];
      if (tree.wood <= 0) continue;
      const d = Math.hypot(tree.x - cx, tree.z - cz);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best < 0) {
      s.status = 'noTrees';
      return this.wait(i, 3);
    }
    s.status = 'ok';
    u.dest[i] = best;
    this.startLeg(i, Task.ToTree, map.trees[best].x, map.trees[best].z);
  }

  private goToStore(i: number, s: Structure, res: ResId): void {
    const u = this.sim.units;
    const p = this.player(s.owner);
    const kind = RES_INFO[res].food ? 'food' : 'materials';
    const cap = kind === 'food' ? p.foodCap : p.materialsCap;
    if (p.stored(kind) + u.carryAmt[i] > cap + 1e-6) {
      s.status = 'storageFull';
      return this.wait(i, 2);
    }
    let best: Structure | undefined;
    let bestD = Infinity;
    for (const st of this.sim.structures) {
      if (st.owner !== s.owner || STRUCTURE_DEFS[st.kind].storage?.kind !== kind) continue;
      const d = Math.hypot(st.doorX - u.x[i], st.doorZ - u.z[i]);
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    if (!best) {
      s.status = 'storageFull';
      return this.wait(i, 3);
    }
    u.dest[i] = best.id;
    const d = this.door(best);
    this.startLeg(i, Task.ToStore, d.x, d.z);
  }

  private deposit(i: number, s: Structure): void {
    const u = this.sim.units;
    const res = u.carry[i];
    if (res < 0 || res >= RES_COUNT) return;
    const p = this.player(s.owner);
    const kind = RES_INFO[res].food ? 'food' : 'materials';
    const cap = kind === 'food' ? p.foodCap : p.materialsCap;
    const amount = Math.max(0, Math.min(u.carryAmt[i], cap - p.stored(kind)));
    p.stock[res] += amount;
    this.sim.emit({ type: 'delivered', owner: s.owner, res: res as ResId, amount, x: u.x[i], z: u.z[i] });
    u.carry[i] = CARRY_NONE;
    u.carryAmt[i] = 0;
  }

  private updateIdle(i: number): void {
    const u = this.sim.units;
    if (u.order[i] !== Order.Idle) return;
    u.taskTimer[i] -= TICK_SEC;
    if (u.taskTimer[i] > 0) return;
    u.taskTimer[i] = 4 + this.sim.rng.next() * 6;
    const hub = this.hubOf(u.owner[i]);
    if (!hub) return;
    const d = this.door(hub);
    const a = this.sim.rng.next() * Math.PI * 2;
    const r = 0.8 + this.sim.rng.next() * 2.4;
    const x = d.x + Math.cos(a) * r;
    const z = d.z + Math.sin(a) * r;
    if (this.sim.map.isWalkable(x, z)) this.sim.goTo(i, x, z);
  }
}
