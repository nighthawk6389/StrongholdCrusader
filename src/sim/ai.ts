import { ringBlueprint, ringReserve, type Piece, type Side } from './blueprint';
import { Tile } from './map';
import type { Controller, Sim, SimEvent } from './sim';
import { GEAR_RES, Res, STRUCTURE_DEFS, footprint, type ResId, type StructureKind } from './structures';
import { RATION_LEVELS } from './economy';
import { RECRUITABLE, UNIT_TYPES, UnitKind } from './unitTypes';
import { RETURN_AT } from './drones';
import { CYCLE_SEC } from './clock';
import { Order, Task } from './units';

// ------------------------------------------------------------------ tuning

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AiTuning {
  /** Ticks between decisions. */
  thinkTicks: number;
  /** Earliest first assault (seconds). */
  firstAttack: number;
  attackSize: number;
  attackGrowth: number;
  /** Minimum gap between assaults (seconds). */
  attackGap: number;
  /** Soldiers kept on the walls. */
  garrison: number;
  /** Extra starting resources. */
  bonus: { timber: number; concrete: number; funds: number };
}

export const DIFFICULTY: Record<Difficulty, AiTuning> = {
  easy: {
    thinkTicks: 40,
    firstAttack: 560,
    attackSize: 6,
    attackGrowth: 3,
    attackGap: 210,
    garrison: 3,
    bonus: { timber: 0, concrete: 0, funds: 0 },
  },
  normal: {
    thinkTicks: 12,
    firstAttack: 360,
    attackSize: 10,
    attackGrowth: 5,
    attackGap: 140,
    garrison: 6,
    bonus: { timber: 60, concrete: 40, funds: 180 },
  },
  hard: {
    thinkTicks: 6,
    firstAttack: 300,
    attackSize: 12,
    attackGrowth: 6,
    attackGap: 115,
    garrison: 8,
    bonus: { timber: 140, concrete: 100, funds: 450 },
  },
};

// ------------------------------------------------------------------ personality

type Near = 'trees' | 'fertile' | 'rock' | 'oil' | 'home' | 'producers';

interface BuildStep {
  kind: StructureKind | 'fortFront' | 'fortRing' | 'nightKit' | 'gunTowers';
  /** Target number of this kind (cumulative), so destroyed buildings get rebuilt. */
  count?: number;
  near?: Near;
}

export interface Personality {
  name: string;
  /** Relative weights of the army mix. */
  mix: Partial<Record<number, number>>;
  build: BuildStep[];
  lines: Record<'start' | 'attack' | 'lostBuilding' | 'hqHit' | 'attackFailed' | 'win' | 'lose', string[]>;
}

/** Old Sarge: balanced, methodical, walls up early, steady infantry pushes. */
export const OLD_SARGE: Personality = {
  name: 'Old Sarge',
  mix: { [UnitKind.Rifleman]: 5, [UnitKind.Gunner]: 2, [UnitKind.Marksman]: 1, [UnitKind.Engineer]: 2, [UnitKind.AT]: 1 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'nightKit' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'gunTowers' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil' },
    { kind: 'motorpool', count: 1, near: 'home' },
    { kind: 'fortRing' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'arms', count: 2, near: 'home' },
    { kind: 'lumber', count: 3, near: 'trees' },
  ],
  lines: {
    start: ["Old Sarge here. Dig in, kid. The desert doesn't forgive sloppy walls."],
    attack: ['Alright, step off. Mind the wire.', "Here we come. Hope you've been eating your rations.", 'Move out! Eyes on that gate.'],
    lostBuilding: ['That was a perfectly good building.', "You'll pay for that one, kid.", 'Noted. And remembered.'],
    hqHit: ["Hey! That's my office!", 'Somebody plug that hole!'],
    attackFailed: ['Hm. Regroup and try the other flank.', "Not bad. Won't happen twice."],
    win: ['Good effort. Same time tomorrow?'],
    lose: ['Well... you earned it. Carry on.'],
  },
};

/** Build steps that only go ahead with steel to spare. */
const EXTRAS: StructureKind[] = ['generator', 'dronebay', 'derrick', 'motorpool'];
const SPARE_STEEL = 18;

const RECIPE_FOR: Partial<Record<number, number>> = {
  [UnitKind.Rifleman]: 0,
  [UnitKind.Gunner]: 1,
  [UnitKind.Marksman]: 2,
  [UnitKind.Engineer]: 3,
  [UnitKind.AT]: 5,
};

// ------------------------------------------------------------------ controller

/**
 * A computer commander. Runs inside the deterministic sim step and acts only through Commands,
 * so it plays by exactly the same rules (and sees the same map) as the player.
 */
export class AiCommander implements Controller {
  private tick = 0;
  private readonly tuning: AiTuning;
  private readonly front: Side;
  private readonly pieces: Piece[];
  private readonly reserved: (tx: number, tz: number) => boolean;
  private readonly impossible = new Set<string>();
  private readonly garrison = new Set<number>();
  private nextAttackAt: number;
  private attackSize: number;
  private attackGroup: number[] = [];
  private lastTaxChange = -1e9;
  private lastLostLine = -1e9;
  private lastHqLine = -1e9;
  private said = new Set<string>();
  private lastBuildAt = -1e9;

  constructor(
    readonly owner: number,
    readonly enemy: number,
    private home: { x: number; z: number },
    readonly personality: Personality,
    readonly difficulty: Difficulty,
    private ring = 11,
  ) {
    this.tuning = DIFFICULTY[difficulty];
    this.nextAttackAt = this.tuning.firstAttack;
    this.attackSize = this.tuning.attackSize;
    this.front = 'west';
    this.pieces = ringBlueprint(home.x, home.z, ring, ['east', 'west', 'north', 'south']);
    this.reserved = ringReserve(home.x, home.z, ring);
  }

  /** Called with the step's events before they're drained (see Sim.step). */
  observe(sim: Sim, events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'structureDestroyed' && e.owner === this.owner && sim.elapsed - this.lastLostLine > 60) {
        this.lastLostLine = sim.elapsed;
        this.say(sim, 'lostBuilding');
      }
      if (e.type === 'structureDamaged' && sim.elapsed - this.lastHqLine > 90) {
        const hq = sim.economy.hqOf(this.owner);
        if (hq && e.id === hq.id) {
          this.lastHqLine = sim.elapsed;
          this.say(sim, 'hqHit');
        }
      }
      if (e.type === 'result') this.say(sim, e.result === 'victory' ? 'lose' : 'win');
    }
  }

  update(sim: Sim): void {
    if (sim.result) return;
    if (++this.tick % this.tuning.thinkTicks !== 0) return;
    if (!sim.economy.hqOf(this.owner)) return;
    if (!this.said.has('start') && sim.elapsed > 4) {
      this.said.add('start');
      this.say(sim, 'start');
    }
    this.manageMorale(sim);
    this.build(sim);
    this.military(sim);
    this.flares(sim);
    this.drones(sim);
    this.upgrades(sim);
  }

  private lastUpgradeAt = -1e9;

  /** With money to spare, upgrade producers and housing (and on Hard, turn watchtowers into gun towers). */
  private upgrades(sim: Sim): void {
    if (sim.elapsed - this.lastUpgradeAt < 25) return;
    const p = sim.economy.player(this.owner);
    if (p.funds < 160) return;
    const order: StructureKind[] = ['scrapyard', 'quarry', 'lumber', 'arms', 'orchard', 'ranch', 'house', 'depot', 'generator'];
    if (this.difficulty === 'hard') order.push('tower');
    for (const kind of order) {
      for (const s of sim.structures) {
        if (s.owner !== this.owner || s.kind !== kind) continue;
        if (sim.economy.upgradeBlocker(this.owner, s.id)) continue;
        // Weapons first: don't spend steel the arms factory needs.
        const up = STRUCTURE_DEFS[s.kind].upgrades?.[(s.level ?? 1) - 1];
        if ((up?.cost.steel ?? 0) > 0 && p.stock[Res.Steel] < 20 + (up?.cost.steel ?? 0)) continue;
        this.lastUpgradeAt = sim.elapsed;
        sim.enqueue({ type: 'upgrade', owner: this.owner, id: s.id });
        return;
      }
    }
  }

  private say(sim: Sim, kind: keyof Personality['lines']): void {
    const lines = this.personality.lines[kind];
    const text = lines[sim.rng.int(lines.length)];
    sim.emit({ type: 'taunt', owner: this.owner, name: this.personality.name, text });
  }

  // ---------------------------------------------------------------- economy

  private manageMorale(sim: Sim): void {
    const p = sim.economy.player(this.owner);
    const food = p.stored('food');
    const ration = food < p.population * 1.5 ? 1 : food > p.population * 8 ? 3 : 2;
    if (ration !== p.rationLevel) sim.enqueue({ type: 'setRations', owner: this.owner, level: ration });
    if (sim.elapsed - this.lastTaxChange >= 15) {
      // Moderate taxes: enough income to recruit without bleeding people.
      const tax = p.morale < 45 ? 1 : p.morale < 56 ? 2 : p.morale < 80 ? 3 : 4;
      if (tax !== p.taxLevel) {
        this.lastTaxChange = sim.elapsed;
        sim.enqueue({ type: 'setTax', owner: this.owner, level: tax });
      }
    }
    this.trade(sim);
  }

  /** Sell surplus for funds; buy food in an emergency. */
  private trade(sim: Sim): void {
    if (!sim.economy.hasMarket(this.owner)) return;
    const p = sim.economy.player(this.owner);
    const walling = this.pieces.some((pc) => !sim.structureAt(pc.tx, pc.tz));
    const keep: [ResId, number][] = [
      [Res.Timber, 90],
      [Res.Concrete, walling ? 400 : 50],
      [Res.Steel, 30],
      [Res.Fuel, 30],
    ];
    for (const g of GEAR_RES) keep.push([g, 6]);
    for (const [res, k] of keep) {
      const surplus = Math.floor(p.stock[res] - k);
      if (surplus >= 5) {
        sim.enqueue({ type: 'trade', owner: this.owner, res, amount: -Math.min(surplus, 20) });
        return;
      }
    }
    if (p.foodSeconds < 60 && p.funds > 150) {
      sim.enqueue({ type: 'trade', owner: this.owner, res: Res.Produce, amount: 10 });
      return;
    }
    // Tanks need fuel: buy it if there's no derrick keeping up.
    const pool = sim.structures.some((s) => s.owner === this.owner && s.kind === 'motorpool');
    if (pool && this.difficulty !== 'easy' && p.stock[Res.Fuel] < 12 && p.funds > 100) {
      sim.enqueue({ type: 'trade', owner: this.owner, res: Res.Fuel, amount: 5 });
      return;
    }
    // Rich but short of weapons: buy the one the army mix needs most.
    if (p.funds > 190 && p.stored('gear') < p.gearCap - 2) {
      const gear = UNIT_TYPES[this.neededKind(sim)].gear;
      if (gear !== null && p.stock[gear] < 4) sim.enqueue({ type: 'trade', owner: this.owner, res: gear, amount: 2 });
    }
  }

  /** Army-mix weight for a unit type. AT teams only join once the enemy fields armor. */
  private weight(sim: Sim, k: number): number {
    const w = this.personality.mix[k] ?? 0;
    if (k !== UnitKind.AT) return w;
    const u = sim.units;
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === this.enemy && UNIT_TYPES[u.kind[i]].vehicle) return w * 2;
    return 0;
  }

  /** The unit type furthest below the personality's army mix (counting weapons in stock). */
  private neededKind(sim: Sim): number {
    const u = sim.units;
    const p = sim.economy.player(this.owner);
    const have = new Map<number, number>();
    for (let i = 0; i < u.count; i++) {
      if (u.alive[i] && u.owner[i] === this.owner) have.set(u.kind[i], (have.get(u.kind[i]) ?? 0) + 1);
    }
    let best: number = UnitKind.Rifleman;
    let bestScore = Infinity;
    for (const k of RECRUITABLE) {
      const weight = this.weight(sim, k);
      if (!weight) continue;
      const score = ((have.get(k) ?? 0) + p.stock[UNIT_TYPES[k].gear!]) / weight;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  }

  /** Rough food output per minute (orchards/ranches, averaged over day and night). */
  private foodRate(sim: Sim): number {
    let rate = 0;
    for (const s of sim.structures) {
      if (s.owner !== this.owner) continue;
      if (s.kind === 'orchard') rate += 6.5 * 0.75;
      if (s.kind === 'ranch') rate += 4 * 0.75;
    }
    return rate;
  }

  private count(sim: Sim, kind: StructureKind): number {
    let n = 0;
    for (const s of sim.structures) if (s.owner === this.owner && s.kind === kind) n++;
    return n;
  }

  private build(sim: Sim): void {
    if (sim.elapsed - this.lastBuildAt < 2) return;
    const p = sim.economy.player(this.owner);

    // Urgent needs first: food, housing and storage.
    const need = p.population * RATION_LEVELS[2].perMin;
    const foodBuildings = this.count(sim, 'orchard') + this.count(sim, 'ranch');
    if (this.foodRate(sim) < need * 1.1 && foodBuildings < 7 && sim.elapsed > 20) {
      if (!this.impossible.has('orchard:food') && p.canAfford(STRUCTURE_DEFS.orchard.cost)) {
        if (this.tryBuild(sim, 'orchard', 'fertile')) return;
        this.impossible.add('orchard:food');
      }
      if (p.canAfford(STRUCTURE_DEFS.ranch.cost) && this.tryBuild(sim, 'ranch', 'home')) return;
    }
    // More housing only when short of hands (idle civilians are the recruiting pool).
    if (p.population >= p.housing - 1 && p.idle < 4 && this.count(sim, 'house') < 10 && p.morale > 55) {
      if (p.canAfford(STRUCTURE_DEFS.house.cost) && this.tryBuild(sim, 'house', 'home')) return;
    }
    if (p.stored('materials') > p.materialsCap - 15 && this.tryBuild(sim, 'depot', 'producers')) return;
    if (p.stored('food') > p.foodCap - 15 && this.tryBuild(sim, 'rations', 'home')) return;

    for (const step of this.personality.build) {
      if (step.kind === 'fortFront' || step.kind === 'fortRing') {
        const done = this.fortify(sim, step.kind === 'fortFront');
        if (!done) return; // keep pouring concrete into the walls before moving on
        continue;
      }
      if (step.kind === 'nightKit') {
        if (!this.nightKit(sim)) return;
        continue;
      }
      if (step.kind === 'gunTowers') {
        if (!this.gunTowers(sim)) return;
        continue;
      }
      if (this.impossible.has(`${step.kind}:${step.count}`)) continue;
      if (this.count(sim, step.kind) >= (step.count ?? 1)) continue;
      const def = STRUCTURE_DEFS[step.kind];
      // Extras that eat steel wait for a surplus instead of holding up the build (weapons come first).
      if (EXTRAS.includes(step.kind) && (!p.canAfford(def.cost) || p.stock[Res.Steel] < SPARE_STEEL + (def.cost.steel ?? 0))) continue;
      if (!p.canAfford(def.cost)) return; // save up for the next step
      if (!this.tryBuild(sim, step.kind, step.near ?? 'home')) {
        // Fall back to a ranch when there's no fertile ground in reach.
        if (step.kind === 'orchard' && this.tryBuild(sim, 'ranch', 'home')) return;
        this.impossible.add(`${step.kind}:${step.count}`);
      }
      return;
    }
  }

  /** Build the next pieces of the fortress. Returns true when that phase is complete. */
  private fortify(sim: Sim, frontOnly: boolean): boolean {
    const p = sim.economy.player(this.owner);
    const todo = this.pieces.filter((pc) => {
      if (frontOnly && pc.side !== this.front && !(pc.kind === 'tower' && this.isFrontCorner(pc))) return false;
      const key = `${pc.kind}@${pc.tx},${pc.tz}`;
      if (this.impossible.has(key)) return false;
      const s = sim.structureAt(pc.tx, pc.tz);
      return !(s && s.kind === pc.kind && s.owner === this.owner);
    });
    if (todo.length === 0) return true;

    // Walls go up as one line command; towers/gates/stairs one at a time (they need walls for stairs).
    const walls = todo.filter((pc) => pc.kind === 'wall');
    const others = todo.filter((pc) => pc.kind !== 'wall' && pc.kind !== 'stairs');
    const stairs = todo.filter((pc) => pc.kind === 'stairs');
    for (const pc of [...others, ...stairs]) {
      const def = STRUCTURE_DEFS[pc.kind];
      if (!p.canAfford(def.cost)) break;
      const check = sim.economy.canPlace(this.owner, pc.kind, pc.tx, pc.tz, pc.rot);
      if (check.ok) {
        sim.enqueue({ type: 'build', owner: this.owner, kind: pc.kind, tx: pc.tx, tz: pc.tz, rot: pc.rot });
        this.lastBuildAt = sim.elapsed;
        return false;
      }
      // Stairs wait for their wall; enemies move; money comes in. Anything else won't fix itself.
      const retry = check.reason === 'Enemies in the way' || check.reason?.startsWith('Not enough') || check.reason?.startsWith('Must be right next');
      if (!retry) this.impossible.add(`${pc.kind}@${pc.tx},${pc.tz}`);
    }
    const per = STRUCTURE_DEFS.wall.cost.concrete ?? 1;
    const budget = Math.floor(p.stock[Res.Concrete] / per);
    if (walls.length && budget > 0) {
      const tiles: number[] = [];
      for (const w of walls) {
        if (tiles.length / 2 >= budget) break;
        const check = sim.economy.canPlaceWallTile(this.owner, w.tx, w.tz);
        if (check.ok) tiles.push(w.tx, w.tz);
        else if (check.reason !== 'Enemies in the way') this.impossible.add(`wall@${w.tx},${w.tz}`);
      }
      if (tiles.length) {
        sim.enqueue({ type: 'buildWall', owner: this.owner, tiles });
        this.lastBuildAt = sim.elapsed;
      }
    }
    return false;
  }

  /** Where the two gun towers go: just inside the front wall, touching it, either side of the gate. */
  private gunTowerSpots(): { tx: number; tz: number }[] {
    if (this.difficulty === 'easy') return [];
    const tx = this.front === 'west' ? this.home.x - this.ring + 1 : this.home.x + this.ring - 2;
    return [
      { tx, tz: this.home.z - 4 },
      { tx, tz: this.home.z + 3 },
    ];
  }

  /** Normal and up: two gun towers by the front gate. Returns true when done (or impossible). */
  private gunTowers(sim: Sim): boolean {
    const p = sim.economy.player(this.owner);
    for (const g of this.gunTowerSpots()) {
      const key = `guntower@${g.tx},${g.tz}`;
      if (this.impossible.has(key)) continue;
      const s = sim.structureAt(g.tx, g.tz);
      if (s && s.kind === 'guntower' && s.owner === this.owner) continue;
      const cost = STRUCTURE_DEFS.guntower.cost;
      if (!p.canAfford(cost) || p.stock[Res.Steel] < SPARE_STEEL + (cost.steel ?? 0)) return true; // later
      const check = sim.economy.canPlace(this.owner, 'guntower', g.tx, g.tz);
      if (check.ok) {
        sim.enqueue({ type: 'build', owner: this.owner, kind: 'guntower', tx: g.tx, tz: g.tz });
        this.lastBuildAt = sim.elapsed;
        return false;
      }
      if (check.reason !== 'Enemies in the way') this.impossible.add(key);
    }
    return true;
  }

  /** Lights and a sensor around the walls (front first). Returns true when all are up. */
  private nightKit(sim: Sim): boolean {
    const p = sim.economy.player(this.owner);
    const { x: hx, z: hz } = this.home;
    const r = this.ring - 3;
    const f = this.front === 'west' ? -1 : 1;
    const q = Math.PI / 2;
    const kit: { kind: StructureKind; tx: number; tz: number; rot: number }[] = [
      { kind: 'floodlight', tx: hx + f * r, tz: hz - 5, rot: f * q },
      { kind: 'floodlight', tx: hx + f * r, tz: hz + 5, rot: f * q },
      { kind: 'searchlight', tx: hx + f * r - (f < 0 ? 0 : 1), tz: hz + 2, rot: f * q },
      { kind: 'sensor', tx: hx + f * (r + 1), tz: hz - 2, rot: 0 },
      { kind: 'floodlight', tx: hx - f * r, tz: hz, rot: -f * q },
      { kind: 'floodlight', tx: hx, tz: hz - r, rot: Math.PI },
      { kind: 'floodlight', tx: hx, tz: hz + r, rot: 0 },
    ];
    for (const k of kit) {
      const key = `${k.kind}@${k.tx},${k.tz}`;
      if (this.impossible.has(key)) continue;
      const s = sim.structureAt(k.tx, k.tz);
      if (s && s.kind === k.kind && s.owner === this.owner) continue;
      // Weapons come first: only spend steel on lights when there's plenty to spare.
      if (!p.canAfford(STRUCTURE_DEFS[k.kind].cost) || p.stock[Res.Steel] < 14) return false;
      if (sim.economy.canPlace(this.owner, k.kind, k.tx, k.tz).ok) {
        sim.enqueue({ type: 'build', owner: this.owner, kind: k.kind, tx: k.tx, tz: k.tz, rot: k.rot });
        this.lastBuildAt = sim.elapsed;
        return false;
      }
      this.impossible.add(key);
    }
    return true;
  }

  private lastFlareAt = -1e9;

  /** At night, light up intruders near the base with a flare. */
  private flares(sim: Sim): void {
    if (sim.cycle.daylight > 0.3 || sim.elapsed - this.lastFlareAt < 25) return;
    const p = sim.economy.player(this.owner);
    if (p.funds < 80) return;
    const u = sim.units;
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.enemy || !UNIT_TYPES[u.kind[i]].armed) continue;
      if (!sim.vision.isSeen(this.owner, i)) continue;
      if (Math.hypot(u.x[i] - this.home.x, u.z[i] - this.home.z) > this.ring + 12) continue;
      n++;
      sx += u.x[i];
      sz += u.z[i];
    }
    if (n === 0) return;
    this.lastFlareAt = sim.elapsed;
    sim.enqueue({ type: 'flare', owner: this.owner, x: sx / n, z: sz / n });
  }

  private isFrontCorner(pc: Piece): boolean {
    return this.front === 'west' ? pc.tx < this.home.x : pc.tx > this.home.x;
  }

  private tryBuild(sim: Sim, kind: StructureKind, near: Near): boolean {
    const anchor = this.anchorFor(sim, near);
    if (!anchor) return false;
    const spot = this.findSpot(sim, kind, anchor.x, anchor.z, kind === 'house' || kind === 'arms' ? 10 : 14);
    if (!spot) return false;
    sim.enqueue({ type: 'build', owner: this.owner, kind, tx: spot.tx, tz: spot.tz });
    this.lastBuildAt = sim.elapsed;
    return true;
  }

  /** Where to look for a building site. */
  private anchorFor(sim: Sim, near: Near): { x: number; z: number } | null {
    const map = sim.map;
    const { x: hx, z: hz } = this.home;
    const limit = 36;
    if (near === 'home') return { x: hx, z: hz };
    if (near === 'trees') {
      // The densest grove within reach: count living trees around each candidate.
      let best: { x: number; z: number } | null = null;
      let bestScore = -1;
      for (const t of map.trees) {
        if (t.wood <= 0 || Math.hypot(t.x - hx, t.z - hz) > limit) continue;
        let n = 0;
        for (const o of map.trees) if (o.wood > 0 && Math.abs(o.x - t.x) < 5 && Math.abs(o.z - t.z) < 5) n++;
        const score = n - Math.hypot(t.x - hx, t.z - hz) * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = { x: t.x, z: t.z };
        }
      }
      return best;
    }
    if (near === 'fertile' || near === 'rock' || near === 'oil') {
      const want = near === 'fertile' ? Tile.Fertile : near === 'oil' ? Tile.Oil : Tile.Rock;
      let best: { x: number; z: number } | null = null;
      let bestD = limit;
      for (let tz = Math.max(0, hz - limit); tz < Math.min(map.height, hz + limit); tz++) {
        for (let tx = Math.max(0, hx - limit); tx < Math.min(map.width, hx + limit); tx++) {
          if (map.tileAt(tx, tz) !== want) continue;
          const d = Math.hypot(tx + 0.5 - hx, tz + 0.5 - hz);
          if (d < bestD && d > this.ring + 2) {
            bestD = d;
            best = { x: tx + 0.5, z: tz + 0.5 };
          }
        }
      }
      return best;
    }
    // 'producers': next to the producer farthest from any store.
    let best: { x: number; z: number } | null = null;
    let bestD = 8;
    for (const s of sim.structures) {
      if (s.owner !== this.owner || !STRUCTURE_DEFS[s.kind].producer) continue;
      let nearest = Infinity;
      for (const st of sim.structures) {
        if (st.owner === this.owner && STRUCTURE_DEFS[st.kind].storage?.kind === 'materials') {
          nearest = Math.min(nearest, Math.hypot(st.tx - s.tx, st.tz - s.tz));
        }
      }
      if (nearest > bestD) {
        bestD = nearest;
        best = { x: s.tx + s.w / 2, z: s.tz + s.h / 2 };
      }
    }
    return best ?? { x: hx, z: hz };
  }

  /** First valid site spiralling out from an anchor, keeping clear of the planned ring. */
  private findSpot(sim: Sim, kind: StructureKind, ax: number, az: number, maxR: number): { tx: number; tz: number } | null {
    const { w, h } = footprint(kind, 0);
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tx = Math.round(ax - w / 2) + dx;
          const tz = Math.round(az - h / 2) + dz;
          if (this.touchesReserve(tx, tz, w, h)) continue;
          if (sim.economy.canPlace(this.owner, kind, tx, tz).ok) return { tx, tz };
        }
      }
    }
    return null;
  }

  private touchesReserve(tx: number, tz: number, w: number, h: number): boolean {
    for (let z = tz; z < tz + h; z++) for (let x = tx; x < tx + w; x++) if (this.reserved(x, z)) return true;
    return false;
  }

  // ---------------------------------------------------------------- military

  private military(sim: Sim): void {
    const u = sim.units;
    const p = sim.economy.player(this.owner);
    const army: number[] = [];
    const byKind = new Map<number, number>();
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.owner) continue;
      const t = UNIT_TYPES[u.kind[i]];
      if (!t.armed || u.kind[i] === UnitKind.Commander) continue;
      army.push(i);
      byKind.set(u.kind[i], (byKind.get(u.kind[i]) ?? 0) + 1);
    }
    for (const g of this.garrison) if (!u.isAlive(g)) this.garrison.delete(g);
    this.attackGroup = this.attackGroup.filter((id) => u.isAlive(id) && sim.combat.assault[id]);

    // What should the arms factories make? Whatever is furthest below the desired mix.
    const mix: Partial<Record<number, number>> = {};
    for (const k of RECRUITABLE) mix[k] = this.weight(sim, k);
    let needKind: number = UnitKind.Rifleman;
    let needScore = Infinity;
    for (const k of RECRUITABLE) {
      const weight = mix[k] ?? 0;
      if (!weight) continue;
      const gear = UNIT_TYPES[k].gear!;
      const score = ((byKind.get(k) ?? 0) + p.stock[gear]) / weight;
      if (score < needScore) {
        needScore = score;
        needKind = k;
      }
    }
    const recipe = RECIPE_FOR[needKind] ?? 0;
    for (const s of sim.structures) {
      if (s.owner === this.owner && s.kind === 'arms' && s.recipe !== recipe) {
        sim.enqueue({ type: 'setRecipe', owner: this.owner, id: s.id, recipe });
      }
    }

    // Armor (Normal and up): tanks, a scout car, and on Hard a howitzer. With a decent infantry
    // force already, he saves up for the next tank instead of recruiting more riflemen.
    const pool = sim.structures.find((s) => s.owner === this.owner && s.kind === 'motorpool');
    let saving = false;
    if (pool && this.difficulty !== 'easy') {
      const n = (k: number): number => byKind.get(k) ?? 0;
      const hard = this.difficulty === 'hard';
      const want =
        n(UnitKind.Tank) < (hard ? 2 : 1)
          ? UnitKind.Tank
          : n(UnitKind.ArmoredCar) < 1
            ? UnitKind.ArmoredCar
            : hard && n(UnitKind.Howitzer) < 1
              ? UnitKind.Howitzer
              : -1;
      if (want >= 0) {
        const t = UNIT_TYPES[want];
        // Only hold back infantry when the tank is nearly paid for (materials in hand, half the cash).
        saving = army.length >= 10 && p.stock[Res.Fuel] >= t.fuel && p.stock[Res.Steel] >= t.steel && p.funds >= t.funds * 0.5;
        if (p.idle >= 1 && !sim.economy.recruitBlocker(this.owner, want) && p.funds >= t.funds + 10) {
          sim.enqueue({ type: 'recruit', owner: this.owner, barracks: pool.id, kind: want, count: 1 });
          saving = false;
        }
      }
    }

    // Recruit one soldier per decision while weapons, funds and idle hands allow.
    const barracks = sim.structures.find((s) => s.owner === this.owner && s.kind === 'barracks');
    if (barracks && p.idle >= 2 && !saving) {
      let best = -1;
      let bestScore = Infinity;
      for (const k of RECRUITABLE) {
        const weight = mix[k] ?? 0;
        if (!weight || sim.economy.recruitBlocker(this.owner, k)) continue;
        if (p.funds < UNIT_TYPES[k].funds + 30) continue;
        const score = (byKind.get(k) ?? 0) / weight;
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
      if (best >= 0) sim.enqueue({ type: 'recruit', owner: this.owner, barracks: barracks.id, kind: best, count: 1 });
    }

    const free = army.filter(
      (i) => !this.garrison.has(i) && !sim.combat.assault[i] && u.order[i] !== Order.Control && u.task[i] !== Task.Recruit,
    );

    // Man the front wall (prefer marksmen and machine gunners up there).
    const deck = this.frontDeckTiles(sim);
    // Defenders stuck on the ground (e.g. assigned before stairs existed) try again.
    let k = 0;
    for (const g of this.garrison) {
      if (deck.length && u.layer[g] === 0 && u.order[g] === Order.Idle) {
        const t = deck[k % deck.length];
        sim.enqueue({ type: 'move', owner: this.owner, ids: [g], x: t.x, z: t.z, layer: 1 });
      }
      k++;
    }
    if (deck.length && this.garrison.size < this.tuning.garrison) {
      const pick = [...free]
        .filter((i) => !UNIT_TYPES[u.kind[i]].vehicle)
        .sort((a, b) => this.garrisonRank(u.kind[a]) - this.garrisonRank(u.kind[b]) || a - b)[0];
      if (pick !== undefined) {
        const t = deck[this.garrison.size % deck.length];
        this.garrison.add(pick);
        sim.enqueue({ type: 'move', owner: this.owner, ids: [pick], x: t.x, z: t.z, layer: 1 });
        free.splice(free.indexOf(pick), 1);
      }
    }

    // Defend: hit intruders near the base with whoever is free.
    const intruder = this.nearestIntruder(sim, 26);
    if (intruder >= 0) {
      const idle = free.filter((i) => u.order[i] === Order.Idle || u.order[i] === Order.Move);
      if (idle.length) sim.enqueue({ type: 'attack', owner: this.owner, ids: idle, target: intruder });
      return;
    }

    // Attack when the field army is big enough (and has engineers if the enemy has walls).
    if (this.attackGroup.length === 0 && this.lastAttackLaunched && !this.reportedFailure) {
      // Only grumble if the assault was mostly wiped out (not when it simply won).
      this.reportedFailure = true;
      const survivors = this.launched.filter((id) => u.isAlive(id) && u.owner[id] === this.owner).length;
      if (survivors < this.launched.length * 0.3 && !sim.result) this.say(sim, 'attackFailed');
    }
    if (sim.elapsed < this.nextAttackAt || this.attackGroup.length > 0) return;
    const enemyWalls = sim.structures.some((s) => s.owner === this.enemy && STRUCTURE_DEFS[s.kind].armored);
    const engineers = free.filter((i) => u.kind[i] === UnitKind.Engineer).length;
    // Armor counts for more than one rifleman, and tanks/howitzers can breach walls themselves.
    const worth = (k: number): number => (k === UnitKind.Tank ? 4 : k === UnitKind.Howitzer ? 3 : k === UnitKind.ArmoredCar ? 2 : 1);
    const strength = free.reduce((a, i) => a + worth(u.kind[i]), 0);
    const breachers = engineers + free.filter((i) => UNIT_TYPES[u.kind[i]].siege || UNIT_TYPES[u.kind[i]].artillery).length;
    const ready = strength >= this.attackSize && (!enemyWalls || breachers > 0 || strength >= this.attackSize * 1.5);
    if (!ready) return;
    sim.enqueue({ type: 'assault', owner: this.owner, ids: free, target: this.enemy });
    this.attackGroup = [...free];
    this.launched = [...free];
    this.lastAttackLaunched = true;
    this.reportedFailure = false;
    this.nextAttackAt = sim.elapsed + this.tuning.attackGap;
    this.attackSize += this.tuning.attackGrowth;
    this.say(sim, 'attack');
  }

  private lastAttackLaunched = false;
  private reportedFailure = false;
  private launched: number[] = [];

  private garrisonRank(kind: number): number {
    return kind === UnitKind.Marksman ? 0 : kind === UnitKind.Gunner ? 1 : kind === UnitKind.Rifleman ? 2 : 3;
  }

  /** Built wall-top tiles on the side facing the enemy (gun towers first: they need a crew to fire). */
  private frontDeckTiles(sim: Sim): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const guns: { x: number; z: number }[] = [];
    const map = sim.map;
    for (const g of this.gunTowerSpots()) {
      const s = sim.structureAt(g.tx, g.tz);
      if (s && s.kind === 'guntower' && s.owner === this.owner) guns.push({ x: s.tx + 1, z: s.tz + 1 });
    }
    for (const pc of this.pieces) {
      if (pc.kind !== 'wall' || pc.side !== this.front) continue;
      const i = map.idx(pc.tx, pc.tz);
      if (map.deck[i] && map.structOwner[i] === this.owner) out.push({ x: pc.tx + 0.5, z: pc.tz + 0.5 });
    }
    // Spread defenders out from the gate.
    return [...guns, ...out.sort((a, b) => Math.abs(a.z - this.home.z) - Math.abs(b.z - this.home.z)).filter((_, k) => k % 2 === 0)];
  }

  private lastDroneAt = -1e9;
  private reconNight = -1;

  /**
   * Drones: a recon drone watches the front approach at night; during an assault (Normal and up) a
   * strike drone goes after a gun tower or a defender on the walls.
   */
  private drones(sim: Sim): void {
    const u = sim.units;
    const bay = sim.structures.find((s) => s.owner === this.owner && s.kind === 'dronebay');
    const night = sim.cycle.daylight < 0.35;
    const f = this.front === 'west' ? -1 : 1;
    const watch = { x: this.home.x + f * (this.ring + 12), z: this.home.z };
    let recon = 0;
    let strike = 0;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.owner) continue;
      const k = u.kind[i];
      if (k !== UnitKind.ReconDrone && k !== UnitKind.StrikeDrone) continue;
      const busy = u.order[i] !== Order.Idle || u.battery[i] < RETURN_AT + 20;
      if (k === UnitKind.ReconDrone) {
        recon++;
        if (busy) continue;
        if (night) sim.enqueue({ type: 'move', owner: this.owner, ids: [i], x: watch.x, z: watch.z });
      } else {
        strike++;
        if (busy) continue;
        const tgt = this.strikeTarget(sim);
        if (tgt.structure >= 0) sim.enqueue({ type: 'attackStructure', owner: this.owner, ids: [i], structure: tgt.structure });
        else if (tgt.unit >= 0) sim.enqueue({ type: 'attack', owner: this.owner, ids: [i], target: tgt.unit });
      }
    }
    if (!bay || !bay.powered || sim.elapsed - this.lastDroneAt < 40) return;
    const p = sim.economy.player(this.owner);
    if (p.funds < 150) return;
    let kind = -1;
    const nightNo = Math.floor(sim.timeSec / CYCLE_SEC);
    if (night && recon === 0 && this.reconNight !== nightNo) {
      kind = UnitKind.ReconDrone;
      this.reconNight = nightNo; // one recon drone a night: if it's shot down, so be it
    } else if (this.difficulty !== 'easy' && this.attackGroup.length > 0 && strike === 0) {
      const tgt = this.strikeTarget(sim);
      if (tgt.structure >= 0 || tgt.unit >= 0) kind = UnitKind.StrikeDrone;
    }
    if (kind < 0 || sim.drones.launchBlocker(this.owner, bay.id, kind)) return;
    this.lastDroneAt = sim.elapsed;
    sim.enqueue({ type: 'launchDrone', owner: this.owner, bay: bay.id, kind });
  }

  /** Best strike-drone target: a crewed enemy gun tower, else a defender we can see on a wall top. */
  private strikeTarget(sim: Sim): { structure: number; unit: number } {
    const u = sim.units;
    for (const s of sim.structures) {
      if (s.owner === this.enemy && s.kind === 'guntower' && sim.combat.crewed(s)) return { structure: s.id, unit: -1 };
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.enemy || u.layer[i] !== 1 || !sim.vision.isSeen(this.owner, i)) continue;
      const d = Math.hypot(u.x[i] - this.home.x, u.z[i] - this.home.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { structure: -1, unit: best };
  }

  private nearestIntruder(sim: Sim, radius: number): number {
    const u = sim.units;
    let best = -1;
    let bestD = radius;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.enemy || !UNIT_TYPES[u.kind[i]].armed) continue;
      const d = Math.hypot(u.x[i] - this.home.x, u.z[i] - this.home.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Debug/inspection summary (used by tests and the balancing report). */
  summary(sim: Sim): string {
    const p = sim.economy.player(this.owner);
    const kinds = new Map<string, number>();
    for (const s of sim.structures) if (s.owner === this.owner) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    const soldiers = sim.units.kind.filter(
      (k, i) => sim.units.alive[i] && sim.units.owner[i] === this.owner && UNIT_TYPES[k].armed,
    ).length;
    const gear = GEAR_RES.map((g) => Math.floor(p.stock[g])).join('/');
    const arms = sim.structures.filter((st) => st.owner === this.owner && st.kind === 'arms').map((st) => st.status).join(',');
    return `gear ${gear} arms[${arms}] pop ${p.population}/${p.housing} morale ${p.morale.toFixed(0)} $${p.funds.toFixed(0)} T${p.stock[Res.Timber].toFixed(0)} C${p.stock[Res.Concrete].toFixed(0)} S${p.stock[Res.Steel].toFixed(0)} soldiers ${soldiers} garrison ${this.garrison.size} | ${[...kinds.entries()].map(([k, n]) => `${k}:${n}`).join(' ')}`;
  }
}
