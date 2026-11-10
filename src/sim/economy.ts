import { TICK_RATE, TICK_SEC } from './clock';
import { Block, Tile } from './map';
import type { Sim } from './sim';
import {
  FOOD_RES,
  PRICES,
  RES_COUNT,
  RES_INFO,
  STRUCTURE_DEFS,
  footprint,
  resIdsFor,
  type Cost,
  type ResId,
  type StoreKind,
  type Structure,
  type StructureKind,
} from './structures';
import { UNIT_TYPES, UnitKind } from './unitTypes';
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
const DEFENSE_KINDS: StructureKind[] = ['wall', 'tower', 'gate', 'stairs'];

export interface MoraleFactor {
  key: string;
  label: string;
  value: number;
}

export class PlayerEconomy {
  /** Only active economies eat, pay taxes and attract civilians. */
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
  gearCap = 0;
  /** Seconds of food left at the current ration level (Infinity if not eating). */
  foodSeconds = Infinity;
  factors: MoraleFactor[] = [];
  moraleTrend = 0;
  arrivalTimer = 0;
  departTimer = 0;

  constructor(readonly owner: number) {}

  stored(kind: StoreKind): number {
    let s = 0;
    for (const r of resIdsFor(kind)) s += this.stock[r];
    return s;
  }

  cap(kind: StoreKind): number {
    return kind === 'food' ? this.foodCap : kind === 'gear' ? this.gearCap : this.materialsCap;
  }

  canAfford(c: Cost): boolean {
    return (
      (c.funds ?? 0) <= this.funds + 1e-9 &&
      (c.timber ?? 0) <= this.stock[0] + 1e-9 &&
      (c.concrete ?? 0) <= this.stock[1] + 1e-9 &&
      (c.steel ?? 0) <= this.stock[4] + 1e-9
    );
  }

  pay(c: Cost): void {
    this.funds -= c.funds ?? 0;
    this.stock[0] -= c.timber ?? 0;
    this.stock[1] -= c.concrete ?? 0;
    this.stock[4] -= c.steel ?? 0;
  }
}

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
}

/** Economy: population, morale, storage, placement, recruiting, and the civilian work cycle. */
export class Economy {
  readonly players = new Map<number, PlayerEconomy>();
  /** Why the last wall line failed (for UI feedback). */
  lastWallReason = '';
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

  /** Inside the build radius and away from the enemy. */
  private territory(owner: number, cx: number, cz: number): PlaceCheck {
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
    return { ok: true };
  }

  /** Is the tile empty ground that can take a structure? Returns a reason if not. */
  private tileFree(x: number, z: number): string | null {
    const map = this.sim.map;
    if (!map.inBounds(x, z)) return 'Off the map';
    const i = map.idx(x, z);
    if (map.blocked[i] !== Block.Free || map.structAt[i] !== 0) return 'Blocked';
    if (map.treeAt[i] >= 0) return 'Trees in the way';
    return null;
  }

  /** Enemy soldiers standing on the footprint block construction (your own people step aside). */
  private enemiesOn(owner: number, x: number, z: number, w: number, h: number): boolean {
    const u = this.sim.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.layer[i] !== 0 || u.owner[i] === owner) continue;
      const ux = Math.floor(u.x[i]);
      const uz = Math.floor(u.z[i]);
      if (ux >= x && uz >= z && ux < x + w && uz < z + h) return true;
    }
    return false;
  }

  canPlace(owner: number, kind: StructureKind, tx: number, tz: number, rot = 0): PlaceCheck {
    const def = STRUCTURE_DEFS[kind];
    const map = this.sim.map;
    if (!def.buildable) return { ok: false, reason: 'Not buildable' };
    const { w, h } = footprint(kind, rot);
    for (let z = tz; z < tz + h; z++) {
      for (let x = tx; x < tx + w; x++) {
        const r = this.tileFree(x, z);
        if (r) return { ok: false, reason: r };
      }
    }
    if (this.enemiesOn(owner, tx, tz, w, h)) return { ok: false, reason: 'Enemies in the way' };
    const terr = this.territory(owner, tx + w / 2, tz + h / 2);
    if (!terr.ok) return terr;
    if (def.requires === 'nearRock') {
      let rock = 0;
      for (let z = tz - 1; z <= tz + h; z++) {
        for (let x = tx - 1; x <= tx + w; x++) {
          if (map.inBounds(x, z) && map.tileAt(x, z) === Tile.Rock) rock++;
        }
      }
      if (rock < 2) return { ok: false, reason: 'Must touch a rock outcrop' };
    }
    if (def.requires === 'fertile') {
      let fertile = 0;
      for (let z = tz; z < tz + h; z++) {
        for (let x = tx; x < tx + w; x++) if (map.tileAt(x, z) === Tile.Fertile) fertile++;
      }
      if (fertile < Math.ceil(w * h * 0.6)) return { ok: false, reason: 'Needs fertile ground' };
    }
    if (def.requires === 'besideWall' && this.stairsFacing(tx, tz, owner) === null) {
      return { ok: false, reason: 'Must be right next to your wall' };
    }
    if (!DEFENSE_KINDS.includes(kind) && this.findDoor(tx, tz, w, h, owner) === null) {
      return { ok: false, reason: 'No access' };
    }
    const p = this.player(owner);
    if (!p.canAfford(def.cost)) {
      if ((def.cost.timber ?? 0) > p.stock[0]) return { ok: false, reason: 'Not enough timber' };
      if ((def.cost.concrete ?? 0) > p.stock[1]) return { ok: false, reason: 'Not enough concrete' };
      if ((def.cost.steel ?? 0) > p.stock[4]) return { ok: false, reason: 'Not enough steel' };
      return { ok: false, reason: 'Not enough funds' };
    }
    return { ok: true };
  }

  /** Validate, pay and place. Returns the new structure or null. */
  build(owner: number, kind: StructureKind, tx: number, tz: number, rot = 0): Structure | null {
    if (!this.canPlace(owner, kind, tx, tz, rot).ok) return null;
    this.player(owner).pay(STRUCTURE_DEFS[kind].cost);
    const facing = kind === 'stairs' ? (this.stairsFacing(tx, tz, owner) ?? 0) : rot;
    const s = this.sim.placeStructure(kind, owner, tx, tz, kind === 'stairs' ? 0 : rot);
    if (s) {
      s.rot = facing;
      this.displaceUnits(s);
    }
    this.recount();
    return s;
  }

  /** Per-tile check for a wall segment (no cost). */
  canPlaceWallTile(owner: number, x: number, z: number): PlaceCheck {
    const r = this.tileFree(x, z);
    if (r) return { ok: false, reason: r };
    if (this.enemiesOn(owner, x, z, 1, 1)) return { ok: false, reason: 'Enemies in the way' };
    return this.territory(owner, x + 0.5, z + 0.5);
  }

  /** Build as much of a wall line as is valid and affordable. Returns tiles built. */
  buildWall(owner: number, tiles: number[]): number {
    const p = this.player(owner);
    const cost = STRUCTURE_DEFS.wall.cost;
    let built = 0;
    this.lastWallReason = 'Nothing to build';
    for (let k = 0; k + 1 < tiles.length; k += 2) {
      const x = tiles[k];
      const z = tiles[k + 1];
      const check = this.canPlaceWallTile(owner, x, z);
      if (!check.ok) {
        this.lastWallReason = check.reason ?? 'Blocked';
        continue;
      }
      if (!p.canAfford(cost)) {
        this.lastWallReason = 'Not enough concrete';
        break;
      }
      p.pay(cost);
      const s = this.sim.placeStructure('wall', owner, x, z);
      if (s) {
        this.displaceUnits(s);
        built++;
      }
    }
    return built;
  }

  /** Direction from a stairs tile to the adjacent own wall/tower/gate deck, or null if none. */
  stairsFacing(tx: number, tz: number, owner: number): number | null {
    const map = this.sim.map;
    const dirs: [number, number, number][] = [
      [0, 1, 0],
      [1, 0, Math.PI / 2],
      [0, -1, Math.PI],
      [-1, 0, -Math.PI / 2],
    ];
    for (const [dx, dz, rot] of dirs) {
      const x = tx + dx;
      const z = tz + dz;
      if (!map.inBounds(x, z)) continue;
      const i = map.idx(x, z);
      if (map.deck[i] && !map.stairs[i] && map.structOwner[i] === owner) return rot;
    }
    return null;
  }

  demolish(owner: number, id: number): boolean {
    const s = this.sim.structureById(id);
    if (!s || s.owner !== owner || !STRUCTURE_DEFS[s.kind].buildable) return false;
    const cost = STRUCTURE_DEFS[s.kind].cost;
    const p = this.player(owner);
    this.onStructureLost(s);
    p.funds += Math.floor((cost.funds ?? 0) * REFUND);
    p.stock[0] += Math.floor((cost.timber ?? 0) * REFUND);
    p.stock[1] += Math.floor((cost.concrete ?? 0) * REFUND);
    p.stock[4] += Math.floor((cost.steel ?? 0) * REFUND);
    this.sim.removeStructure(s);
    this.afterStructureRemoved(owner);
    return true;
  }

  /** A structure is going away (demolished or destroyed): free its workers. */
  onStructureLost(s: Structure): void {
    for (const w of [...s.workers]) this.release(w);
    s.workers = [];
  }

  /** Storage may have shrunk: recount and spill any excess. */
  afterStructureRemoved(owner: number): void {
    this.recount();
    this.clampStock(this.player(owner));
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

  setRecipe(owner: number, id: number, recipe: number): void {
    const s = this.sim.structureById(id);
    if (!s || s.owner !== owner) return;
    const recipes = STRUCTURE_DEFS[s.kind].recipes;
    if (!recipes || recipe < 0 || recipe >= recipes.length) return;
    s.recipe = recipe;
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
      if (!map.isWalkableTile(x, z) || map.structAt[map.idx(x, z)] !== 0) return;
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
    const map = this.sim.map;
    const tx = Math.floor(s.doorX);
    const tz = Math.floor(s.doorZ);
    if (!map.isWalkableTile(tx, tz) || map.structAt[map.idx(tx, tz)] !== 0) {
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
      if (!u.alive[i] || u.layer[i] !== 0) continue;
      const x = Math.floor(u.x[i]);
      const z = Math.floor(u.z[i]);
      if (x < s.tx || z < s.tz || x >= s.tx + s.w || z >= s.tz + s.h) continue;
      if (map.walkable(x, z, 0, u.owner[i])) continue; // e.g. own gatehouse or stairs
      const t = map.nearestOnLayer(x, z, 0, u.owner[i], 8);
      if (t < 0) continue;
      u.x[i] = u.px[i] = (t % map.width) + 0.5;
      u.z[i] = u.pz[i] = Math.floor(t / map.width) + 0.5;
    }
  }

  // ------------------------------------------------------------------ trade

  hasMarket(owner: number): boolean {
    return this.sim.structures.some((s) => s.owner === owner && s.kind === 'market');
  }

  /** Buy (amount > 0) or sell (amount < 0) at a Trade Post. Returns units actually traded. */
  trade(owner: number, res: ResId, amount: number): number {
    if (!this.hasMarket(owner) || amount === 0) return 0;
    const p = this.player(owner);
    const price = PRICES[res];
    if (amount > 0) {
      const kind = RES_INFO[res].store;
      const room = Math.floor(p.cap(kind) - p.stored(kind));
      const n = Math.min(amount, room, Math.floor(p.funds / price));
      if (n <= 0) return 0;
      p.funds -= n * price;
      p.stock[res] += n;
      return n;
    }
    const n = Math.min(-amount, Math.floor(p.stock[res]));
    if (n <= 0) return 0;
    p.stock[res] -= n;
    p.funds += n * Math.floor(price / 2);
    return -n;
  }

  // ------------------------------------------------------------------ recruiting

  private idleCivilians(owner: number): number[] {
    const u = this.sim.units;
    const out: number[] = [];
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== owner || u.kind[i] !== UnitKind.Civilian) continue;
      if (u.job[i] < 0 && u.task[i] !== Task.Recruit) out.push(i);
    }
    return out;
  }

  /** Why recruiting can't proceed right now, or null if it can. */
  recruitBlocker(owner: number, kind: number): string | null {
    const t = UNIT_TYPES[kind];
    const p = this.player(owner);
    if (t.gear === null) return 'Cannot be trained';
    if (p.stock[t.gear] < 1) return `No ${RES_INFO[t.gear].name.toLowerCase()} in the armory`;
    if (p.funds < t.funds) return 'Not enough funds';
    if (this.idleCivilians(owner).length === 0) return 'No idle civilians';
    return null;
  }

  /** Send idle civilians to the barracks; gear and funds are paid up front. Returns how many. */
  recruit(owner: number, barracksId: number, kind: number, count: number): number {
    const b = this.sim.structureById(barracksId);
    if (!b || b.owner !== owner || b.kind !== 'barracks') return 0;
    const t = UNIT_TYPES[kind];
    if (t.gear === null) return 0;
    const p = this.player(owner);
    const u = this.sim.units;
    const d = this.door(b);
    let n = 0;
    for (let k = 0; k < count; k++) {
      if (this.recruitBlocker(owner, kind)) break;
      const idle = this.idleCivilians(owner);
      idle.sort((a, c) => Math.hypot(u.x[a] - d.x, u.z[a] - d.z) - Math.hypot(u.x[c] - d.x, u.z[c] - d.z) || a - c);
      const i = idle[0];
      p.stock[t.gear]--;
      p.funds -= t.funds;
      u.task[i] = Task.Recruit;
      u.dest[i] = b.id;
      u.recruitKind[i] = kind;
      u.retries[i] = 0;
      this.sim.goTo(i, d.x, d.z);
      n++;
    }
    this.recount();
    return n;
  }

  private updateRecruit(i: number): void {
    const u = this.sim.units;
    const b = this.sim.structureById(u.dest[i]);
    const kind = u.recruitKind[i];
    if (!b || kind < 0) {
      // Barracks gone: refund and stand down.
      if (kind >= 0) {
        const t = UNIT_TYPES[kind];
        const p = this.player(u.owner[i]);
        if (t.gear !== null) p.stock[t.gear]++;
        p.funds += t.funds;
      }
      u.task[i] = Task.Idle;
      u.recruitKind[i] = -1;
      return;
    }
    const d = this.door(b);
    const r = this.reached(i, d.x, d.z);
    if (r === 'stuck') {
      u.retries[i] = 0;
      return;
    }
    if (!r) return;
    u.convert(i, kind);
    this.sim.emit({ type: 'recruited', owner: u.owner[i], unit: i, kind });
    // Muster a little way from the door.
    const a = this.sim.rng.next() * Math.PI * 2;
    this.sim.goTo(i, d.x + Math.cos(a) * 2, d.z + Math.sin(a) * 2);
    this.recount();
  }

  // ------------------------------------------------------------------ per tick

  update(): void {
    const u = this.sim.units;
    const rate = 0.35 + 0.65 * this.sim.cycle.daylight;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.kind[i] !== UnitKind.Civilian) continue;
      if (u.task[i] === Task.Recruit) this.updateRecruit(i);
      else this.updateCivilian(i, rate);
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
      p.gearCap = 0;
    }
    const u = this.sim.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.kind[i] !== UnitKind.Civilian) continue;
      const p = this.player(u.owner[i]);
      p.population++;
      if (u.job[i] < 0 && u.task[i] !== Task.Recruit) p.idle++;
    }
    for (const s of this.sim.structures) {
      const def = STRUCTURE_DEFS[s.kind];
      if (!def.housing && !def.storage) continue;
      const p = this.player(s.owner);
      p.housing += def.housing ?? 0;
      if (def.storage?.kind === 'materials') p.materialsCap += def.storage.capacity;
      if (def.storage?.kind === 'food') p.foodCap += def.storage.capacity;
      if (def.storage?.kind === 'gear') p.gearCap += def.storage.capacity;
    }
  }

  private clampStock(p: PlayerEconomy): void {
    // Storage lost (e.g. a depot destroyed): spill the excess proportionally.
    for (const kind of ['materials', 'food', 'gear'] as const) {
      const cap = p.cap(kind);
      const have = p.stored(kind);
      if (have <= cap || have <= 0) continue;
      const k = cap / have;
      for (const r of resIdsFor(kind)) p.stock[r] *= k;
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
        this.spawnArrivals(p.owner, Math.min(2, p.housing - p.population));
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
      if (!u.alive[i] || u.owner[i] !== owner || u.kind[i] !== UnitKind.Civilian || u.task[i] === Task.Recruit) continue;
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
          if (!u.alive[i] || u.owner[i] !== s.owner || u.kind[i] !== UnitKind.Civilian) continue;
          if (u.job[i] >= 0 || u.task[i] === Task.Recruit) continue;
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
    const def = STRUCTURE_DEFS[s.kind];
    const recipe = def.recipes?.[s.recipe];
    const prod = def.producer;
    if (!prod && !recipe) {
      this.release(i);
      return;
    }
    const door = this.door(s);
    const output = (recipe?.output ?? prod?.output) as ResId;

    switch (u.task[i]) {
      case Task.Idle:
      case Task.ToWork: {
        const r = this.reached(i, door.x, door.z);
        if (r === 'stuck') return this.wait(i, 2);
        if (!r) return;
        if (prod?.gather === 'tree' && u.carry[i] !== CARRY_LOG) {
          this.goToTree(i, s);
        } else if (recipe && u.carry[i] !== recipe.input) {
          this.goFetch(i, s, recipe.input, recipe.inputAmount);
        } else {
          u.task[i] = Task.Working;
          u.taskTimer[i] = recipe?.work ?? prod!.work;
          u.carry[i] = CARRY_NONE;
          s.status = 'ok';
        }
        return;
      }
      case Task.Working:
        u.taskTimer[i] -= TICK_SEC * rate;
        if (u.taskTimer[i] <= 0) {
          u.carry[i] = output;
          u.carryAmt[i] = recipe ? 1 : prod!.batch;
          this.goToStore(i, s, output);
        }
        return;
      case Task.ToFetch: {
        const depot = this.sim.structureById(u.dest[i]);
        if (!depot || !recipe) return this.wait(i, 2);
        const d = this.door(depot);
        const r = this.reached(i, d.x, d.z);
        if (r === 'stuck') return this.wait(i, 2);
        if (!r) return;
        const p = this.player(s.owner);
        if (p.stock[recipe.input] < recipe.inputAmount) {
          s.status = 'noInput';
          return this.wait(i, 3);
        }
        p.stock[recipe.input] -= recipe.inputAmount;
        u.carry[i] = recipe.input;
        u.carryAmt[i] = recipe.inputAmount;
        this.startLeg(i, Task.ToWork, door.x, door.z);
        return;
      }
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
        if (u.carry[i] >= 0 && u.carry[i] < RES_COUNT && u.carry[i] !== recipe?.input) {
          this.goToStore(i, s, u.carry[i] as ResId);
        } else {
          this.startLeg(i, Task.ToWork, door.x, door.z);
        }
        return;
    }
  }

  private wait(i: number, sec: number): void {
    const u = this.sim.units;
    u.task[i] = Task.Wait;
    u.taskTimer[i] = sec;
    if (u.order[i] === Order.Move) u.order[i] = Order.Idle;
  }

  private nearestStore(owner: number, kind: StoreKind, x: number, z: number): Structure | undefined {
    let best: Structure | undefined;
    let bestD = Infinity;
    for (const st of this.sim.structures) {
      if (st.owner !== owner || STRUCTURE_DEFS[st.kind].storage?.kind !== kind) continue;
      const d = Math.hypot(st.doorX - x, st.doorZ - z);
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    return best;
  }

  private goFetch(i: number, s: Structure, res: ResId, amount: number): void {
    const u = this.sim.units;
    const p = this.player(s.owner);
    if (p.stock[res] < amount) {
      s.status = 'noInput';
      return this.wait(i, 3);
    }
    const depot = this.nearestStore(s.owner, RES_INFO[res].store, u.x[i], u.z[i]);
    if (!depot) {
      s.status = 'noInput';
      return this.wait(i, 3);
    }
    u.dest[i] = depot.id;
    const d = this.door(depot);
    this.startLeg(i, Task.ToFetch, d.x, d.z);
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
    const kind = RES_INFO[res].store;
    if (p.stored(kind) + u.carryAmt[i] > p.cap(kind) + 1e-6) {
      s.status = 'storageFull';
      return this.wait(i, 2);
    }
    const best = this.nearestStore(s.owner, kind, u.x[i], u.z[i]);
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
    const kind = RES_INFO[res].store;
    const amount = Math.max(0, Math.min(u.carryAmt[i], p.cap(kind) - p.stored(kind)));
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
