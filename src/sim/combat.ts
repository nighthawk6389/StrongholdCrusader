import { TICK_SEC } from './clock';
import { Block } from './map';
import { Nav, type Sim } from './sim';
import { STRUCTURE_DEFS, type Structure } from './structures';
import { UNIT_TYPES } from './unitTypes';
import { MAX_UNITS, Order } from './units';

const ENGAGE_INTERVAL = 4;
/** Seconds to plant a breach charge. */
const PLANT_SEC = 4;
const CHARGE_DAMAGE = 520;
const CHARGE_SPLASH = 50;
const MUZZLE_Y = 0.76;
/** Damage multiplier for targets standing on a wall/tower top. */
const DECK_COVER = 0.5;
/** Aim-error multiplier when shooting up at troops behind battlements. */
const DECK_SPREAD = 1.6;
/** Raiders that fail to reach a target wait this long before picking another. */
const RAID_COOLDOWN = 300;
/** How far wave troops will wander to raid soft buildings when walls stop them. */
const RAID_RADIUS = 36;

/**
 * Combat: automatic engagement, focused attacks, structure attacks (incl. engineer breach charges)
 * and the wave "assault" behaviour. Operates on the Sim's unit store.
 */
export class Combat {
  /** Units in an assault group (waves or AI attacks): they resume the assault after breaching. */
  readonly assault = new Uint8Array(MAX_UNITS);
  /** Owner whose HQ an assaulting unit is heading for. */
  readonly assaultTarget = new Uint8Array(MAX_UNITS);
  /** Ticks before a blocked raider looks for another soft target. */
  private raidCooldown = new Uint16Array(MAX_UNITS);

  constructor(private sim: Sim) {}

  /** Auto-engage range including the height bonus for standing on walls/towers. */
  rangeOf(i: number): number {
    const u = this.sim.units;
    return UNIT_TYPES[u.kind[i]].autoRange * (1 + 0.12 * u.elev[i]);
  }

  update(): void {
    const u = this.sim.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      if (u.suppressed[i] > 0) u.suppressed[i] = Math.max(0, u.suppressed[i] - TICK_SEC);
      const type = UNIT_TYPES[u.kind[i]];
      if (!type.armed || u.order[i] === Order.Control) continue;
      if (u.cooldown[i] > 0) u.cooldown[i]--;
      if (u.repath[i] > 0) u.repath[i]--;
      if (this.raidCooldown[i] > 0) this.raidCooldown[i]--;
      switch (u.order[i]) {
        case Order.Attack:
          this.doAttack(i);
          break;
        case Order.Breach:
          this.doBreach(i);
          break;
        case Order.Assault:
          this.doAssault(i);
          break;
        default:
          this.autoEngage(i, u.order[i] === Order.Move);
      }
    }
  }

  // ------------------------------------------------------------------ targeting

  /** Rescan (staggered) and return a valid target within range, or -1. */
  private scan(i: number): number {
    const u = this.sim.units;
    if ((this.sim.tick + i) % ENGAGE_INTERVAL === 0) u.target[i] = this.findTarget(i, this.rangeOf(i));
    const t = u.target[i];
    if (t < 0) return -1;
    if (!u.alive[t] || u.owner[t] === u.owner[i]) {
      u.target[i] = -1;
      return -1;
    }
    if (Math.hypot(u.x[t] - u.x[i], u.z[t] - u.z[i]) > this.rangeOf(i)) {
      u.target[i] = -1;
      return -1;
    }
    return t;
  }

  private findTarget(i: number, range: number): number {
    const u = this.sim.units;
    let best = -1;
    let bestScore = Infinity;
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === u.owner[i]) continue;
      const dx = u.x[j] - u.x[i];
      const dz = u.z[j] - u.z[i];
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      // Prefer soldiers over civilians.
      const score = d * (UNIT_TYPES[u.kind[j]].armed ? 1 : 1.4);
      if (score < bestScore && this.los(i, j)) {
        bestScore = score;
        best = j;
      }
    }
    return best;
  }

  /** Line of sight. Rocks always block; at ground level, structures block too. */
  los(i: number, j: number): boolean {
    const u = this.sim.units;
    const map = this.sim.map;
    const elevated = u.layer[i] === 1 || u.layer[j] === 1;
    const x0 = u.x[i];
    const z0 = u.z[i];
    const dx = u.x[j] - x0;
    const dz = u.z[j] - z0;
    const len = Math.hypot(dx, dz);
    const ownTile = Math.floor(x0) + Math.floor(z0) * map.width;
    const targetTile = Math.floor(u.x[j]) + Math.floor(u.z[j]) * map.width;
    const steps = Math.ceil(len / 0.3);
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const tx = Math.floor(x0 + dx * t);
      const tz = Math.floor(z0 + dz * t);
      const tile = tx + tz * map.width;
      if (tile === ownTile || tile === targetTile) continue;
      const b = map.blocked[tile];
      if (b === Block.Terrain) return false;
      if (!elevated && (b === Block.Structure || b === Block.Gate)) return false;
    }
    return true;
  }

  /** Line of sight from a unit to the nearest point of a structure (its own tiles don't block). */
  losToStructure(i: number, s: Structure): boolean {
    const u = this.sim.units;
    const map = this.sim.map;
    const elevated = u.layer[i] === 1;
    const x0 = u.x[i];
    const z0 = u.z[i];
    const x1 = Math.min(Math.max(x0, s.tx + 0.01), s.tx + s.w - 0.01);
    const z1 = Math.min(Math.max(z0, s.tz + 0.01), s.tz + s.h - 0.01);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(len / 0.3);
    const own = Math.floor(x0) + Math.floor(z0) * map.width;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const tile = Math.floor(x0 + (x1 - x0) * t) + Math.floor(z0 + (z1 - z0) * t) * map.width;
      if (tile === own || map.structAt[tile] === s.id) continue;
      const b = map.blocked[tile];
      if (b === Block.Terrain) return false;
      if (!elevated && (b === Block.Structure || b === Block.Gate)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ behaviours

  private autoEngage(i: number, moving: boolean): void {
    const u = this.sim.units;
    const t = this.scan(i);
    if (t < 0) return;
    const yaw = Math.atan2(u.x[t] - u.x[i], u.z[t] - u.z[i]);
    if (!moving) u.heading[i] = yaw;
    this.autoFire(i, t, moving);
  }

  private autoFire(i: number, t: number, moving: boolean): void {
    const u = this.sim.units;
    if (u.cooldown[i] > 0) return;
    const type = UNIT_TYPES[u.kind[i]];
    const dist = Math.hypot(u.x[t] - u.x[i], u.z[t] - u.z[i]);
    const range = this.rangeOf(i);
    const sup = u.suppressed[i] > 0;
    const upAtDeck = u.layer[t] === 1 && u.layer[i] === 0 ? DECK_SPREAD : 1;
    const spread = (type.spread * (0.6 + (0.8 * dist) / range) + (moving ? 0.08 : 0)) * (sup ? 2 : 1) * upAtDeck;
    const yaw = Math.atan2(u.x[t] - u.x[i], u.z[t] - u.z[i]) + (this.sim.rng.next() - 0.5) * 2 * spread;
    const hit = this.fire(i, yaw, range + 2, type.autoDamage, false, 0);
    // Suppressive fire pins the intended target even on a near miss.
    if (type.suppress > 0) {
      const cover = u.layer[t] === 1 ? 0.5 : 1;
      u.suppressed[t] = Math.max(u.suppressed[t], type.suppress * (hit === t ? 1 : 0.6) * cover);
    }
    const cd = type.autoCooldown + this.sim.rng.int(type.autoJitter + 1);
    u.cooldown[i] = Math.min(255, Math.round(cd * (sup ? 1.5 : 1)));
  }

  private doAttack(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    const t = u.target[i];
    if (!u.isAlive(t) || u.owner[t] === u.owner[i]) {
      u.order[i] = Order.Idle;
      u.target[i] = -1;
      return;
    }
    const dist = Math.hypot(u.x[t] - u.x[i], u.z[t] - u.z[i]);
    if (dist <= this.rangeOf(i) && this.los(i, t)) {
      u.vx[i] = u.vz[i] = 0;
      u.heading[i] = Math.atan2(u.x[t] - u.x[i], u.z[t] - u.z[i]);
      this.autoFire(i, t, false);
      return;
    }
    if (u.repath[i] === 0) {
      const layer = u.layer[i] === 1 && u.layer[t] === 1 ? 1 : 0;
      sim.setDestination(i, u.x[t], u.z[t], layer);
      u.repath[i] = 20;
    }
    const r = sim.navigate(i);
    if (r === Nav.Unreachable) {
      u.order[i] = Order.Idle;
      u.target[i] = -1;
    }
  }

  private doBreach(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    const s = sim.structureById(u.targetStruct[i]);
    if (!s || s.owner === u.owner[i]) return this.finishBreach(i);
    const type = UNIT_TYPES[u.kind[i]];
    const def = STRUCTURE_DEFS[s.kind];
    const engineer = u.charges[i] > 0;
    if (!engineer && def.armored) return this.finishBreach(i);

    // Planting in progress.
    if (u.plantTimer[i] > 0) {
      u.vx[i] = u.vz[i] = 0;
      u.plantTimer[i] -= TICK_SEC;
      if (u.plantTimer[i] <= 0) {
        u.plantTimer[i] = 0;
        u.charges[i]--;
        this.explode(s, i);
        if (u.charges[i] === 0 || !sim.structureById(s.id)) this.finishBreach(i);
      }
      return;
    }

    const gap = distToRect(u.x[i], u.z[i], s);
    if (engineer && gap <= 0.8 && u.layer[i] === 0) {
      u.vx[i] = u.vz[i] = 0;
      u.plantTimer[i] = PLANT_SEC;
      u.heading[i] = Math.atan2(s.tx + s.w / 2 - u.x[i], s.tz + s.h / 2 - u.z[i]);
      return;
    }
    if (!engineer && gap <= this.rangeOf(i) * 0.9 && this.losToStructure(i, s)) {
      u.vx[i] = u.vz[i] = 0;
      const cx = s.tx + s.w / 2;
      const cz = s.tz + s.h / 2;
      u.heading[i] = Math.atan2(cx - u.x[i], cz - u.z[i]);
      if (u.cooldown[i] === 0) {
        this.shotAt(i, cx, cz, 0.8);
        sim.damageStructure(s, type.structDamage);
        u.cooldown[i] = type.autoCooldown + sim.rng.int(type.autoJitter + 1);
      }
      // Still defend yourself against anyone in range.
      const t = this.scan(i);
      if (t >= 0 && u.cooldown[i] === 0) this.autoFire(i, t, false);
      return;
    }

    if (u.repath[i] === 0) {
      const spot = this.approachTile(i, s);
      if (!spot) return this.finishBreach(i);
      sim.setDestination(i, spot.x, spot.z, 0, this.assault[i] === 1);
      u.repath[i] = 30;
    }
    const r = sim.navigate(i);
    if (r === Nav.Blocked) {
      // Something else is in the way: deal with that first, or give up the raid if we can't.
      const obstacle = sim.structureById(sim.navObstacle);
      if (obstacle && obstacle.id !== s.id && (engineer || !STRUCTURE_DEFS[obstacle.kind].armored)) {
        u.targetStruct[i] = obstacle.id;
        u.repath[i] = 0;
      } else if (!engineer) {
        this.raidCooldown[i] = RAID_COOLDOWN;
        this.finishBreach(i);
      }
    } else if (r === Nav.Unreachable) {
      this.raidCooldown[i] = RAID_COOLDOWN;
      this.finishBreach(i);
    }
  }

  /** Nearest soft (non-armoured) building of `owner` within the raid radius. */
  private raidTarget(i: number, owner: number): Structure | undefined {
    const u = this.sim.units;
    let best: Structure | undefined;
    let bestD = RAID_RADIUS;
    for (const s of this.sim.structures) {
      if (s.owner !== owner || STRUCTURE_DEFS[s.kind].armored || s.kind === 'floodlight') continue;
      const d = distToRect(u.x[i], u.z[i], s);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private finishBreach(i: number): void {
    const u = this.sim.units;
    u.targetStruct[i] = -1;
    u.plantTimer[i] = 0;
    u.repath[i] = 0;
    u.order[i] = this.assault[i] ? Order.Assault : Order.Idle;
  }

  /** Where an assault on `owner` is headed: their HQ entrance. */
  assaultGoal(owner: number): { x: number; z: number; hq: Structure } | null {
    const hq = this.sim.economy.hqOf(owner);
    return hq ? { x: hq.doorX, z: hq.doorZ, hq } : null;
  }

  /** Put units into an assault group against `targetOwner`'s HQ. */
  startAssault(ids: number[], targetOwner: number): void {
    const u = this.sim.units;
    for (const i of ids) {
      if (!u.alive[i] || !UNIT_TYPES[u.kind[i]].armed) continue;
      this.assault[i] = 1;
      this.assaultTarget[i] = targetOwner;
      u.order[i] = Order.Assault;
      u.repath[i] = 0;
      u.target[i] = -1;
      u.targetStruct[i] = -1;
    }
  }

  private doAssault(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    const goal = this.assaultGoal(this.assaultTarget[i]);
    if (!goal) {
      u.order[i] = Order.Idle;
      this.assault[i] = 0;
      return;
    }
    const engineer = u.charges[i] > 0;

    // Fighters stop to shoot anything in range; engineers keep pushing to the walls.
    if (!engineer) {
      const t = this.scan(i);
      if (t >= 0) {
        u.vx[i] = u.vz[i] = 0;
        u.heading[i] = Math.atan2(u.x[t] - u.x[i], u.z[t] - u.z[i]);
        this.autoFire(i, t, false);
        return;
      }
    }

    // Close to the target HQ: attack it directly.
    if (goal.hq && distToRect(u.x[i], u.z[i], goal.hq) < Math.min(this.rangeOf(i), 6) && this.losToStructure(i, goal.hq)) {
      u.order[i] = Order.Breach;
      u.targetStruct[i] = goal.hq.id;
      u.repath[i] = 0;
      return;
    }

    if (u.repath[i] === 0) {
      sim.setDestination(i, goal.x, goal.z, 0, true);
      u.repath[i] = 60;
    }
    const r = sim.navigate(i);
    if (r === Nav.Blocked) {
      const obstacle = sim.structureById(sim.navObstacle);
      if (!obstacle) return;
      if (engineer || !STRUCTURE_DEFS[obstacle.kind].armored) {
        u.order[i] = Order.Breach;
        u.targetStruct[i] = obstacle.id;
        u.repath[i] = 0;
      } else if (this.raidCooldown[i] === 0) {
        // Walls hold us back: raid soft buildings outside them while the engineers work.
        const raid = this.raidTarget(i, this.assaultTarget[i]);
        if (raid) {
          u.order[i] = Order.Breach;
          u.targetStruct[i] = raid.id;
          u.repath[i] = 0;
        } else {
          this.raidCooldown[i] = RAID_COOLDOWN;
        }
      }
      // Otherwise: hold at the wall and wait for the engineers.
    } else if (r === Nav.Arrived || r === Nav.Stuck) {
      u.repath[i] = 0;
    }
  }

  /** Nearest ground tile next to a structure that this unit can stand on. */
  private approachTile(i: number, s: Structure): { x: number; z: number } | null {
    const u = this.sim.units;
    const map = this.sim.map;
    const team = u.owner[i];
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    const consider = (x: number, z: number): void => {
      if (!map.walkable(x, z, 0, team)) return;
      const d = Math.hypot(x + 0.5 - u.x[i], z + 0.5 - u.z[i]);
      if (d < bestD) {
        bestD = d;
        best = { x: x + 0.5, z: z + 0.5 };
      }
    };
    for (let x = s.tx - 1; x <= s.tx + s.w; x++) {
      consider(x, s.tz - 1);
      consider(x, s.tz + s.h);
    }
    for (let z = s.tz; z < s.tz + s.h; z++) {
      consider(s.tx - 1, z);
      consider(s.tx + s.w, z);
    }
    return best;
  }

  private explode(s: Structure, i: number): void {
    const sim = this.sim;
    const u = sim.units;
    // Blast point: the spot on the structure closest to the engineer.
    const bx = Math.min(Math.max(u.x[i], s.tx + 0.3), s.tx + s.w - 0.3);
    const bz = Math.min(Math.max(u.z[i], s.tz + 0.3), s.tz + s.h - 0.3);
    sim.emit({ type: 'explosion', x: bx, z: bz, owner: u.owner[i] });
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === u.owner[i]) continue;
      if (Math.hypot(u.x[j] - bx, u.z[j] - bz) < 1.6) this.damageUnit(j, CHARGE_SPLASH, i);
    }
    sim.damageStructure(s, CHARGE_DAMAGE);
  }

  // ------------------------------------------------------------------ shooting

  /** Emit a tracer toward a point (used for shots at buildings). */
  private shotAt(i: number, x: number, z: number, h: number): void {
    const sim = this.sim;
    const u = sim.units;
    const map = sim.map;
    sim.emit({
      type: 'shot',
      unit: i,
      owner: u.owner[i],
      fromX: u.x[i],
      fromZ: u.z[i],
      fromY: map.heightAt(u.x[i], u.z[i]) + u.elev[i] + MUZZLE_Y,
      toX: x,
      toZ: z,
      toY: map.heightAt(x, z) + h,
      hit: true,
    });
    u.lastShot[i] = sim.tick;
  }

  /**
   * Hitscan along `yaw`. Rocks stop every shot; at ground level so do structures (but a target
   * standing on a wall top can still be hit). Returns the unit hit, or -1.
   */
  fire(i: number, yaw: number, range: number, damage: number, aimed: boolean, suppress: number): number {
    const sim = this.sim;
    const u = sim.units;
    const map = sim.map;
    const ox = u.x[i];
    const oz = u.z[i];
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const elevated = u.layer[i] === 1;
    const ownTile = Math.floor(ox) + Math.floor(oz) * map.width;

    let maxT = range;
    for (let t = 0.45; t <= range; t += 0.2) {
      const tx = Math.floor(ox + dx * t);
      const tz = Math.floor(oz + dz * t);
      if (!map.inBounds(tx, tz)) {
        maxT = t;
        break;
      }
      const tile = tx + tz * map.width;
      if (tile === ownTile) continue;
      const b = map.blocked[tile];
      if (b === Block.Terrain || (!elevated && (b === Block.Structure || b === Block.Gate))) {
        maxT = t;
        break;
      }
    }

    let hit = -1;
    let hitT = Infinity;
    let hitPerp = 0;
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === u.owner[i]) continue;
      const rx = u.x[j] - ox;
      const rz = u.z[j] - oz;
      const t = rx * dx + rz * dz;
      if (t <= 0 || t >= hitT) continue;
      const reach = u.layer[j] === 1 ? maxT + 1.3 : maxT;
      if (t >= reach) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      const r = UNIT_TYPES[u.kind[j]].radius + 0.06;
      if (perp < r) {
        hit = j;
        hitT = t;
        hitPerp = perp / r;
      }
    }

    const endT = hit >= 0 ? hitT : maxT;
    const toX = ox + dx * endT;
    const toZ = oz + dz * endT;
    u.lastShot[i] = sim.tick;
    sim.emit({
      type: 'shot',
      unit: i,
      owner: u.owner[i],
      fromX: ox,
      fromZ: oz,
      fromY: map.heightAt(ox, oz) + u.elev[i] + MUZZLE_Y,
      toX,
      toZ,
      toY: map.heightAt(toX, toZ) + (hit >= 0 ? u.elev[hit] + 0.7 : 0.5),
      hit: hit >= 0,
    });
    if (hit < 0) return -1;

    const crit = aimed && hitPerp < 0.35 ? 2 : 1;
    const cover = u.layer[hit] === 1 ? DECK_COVER : 1;
    if (suppress > 0) u.suppressed[hit] = Math.max(u.suppressed[hit], suppress * (cover < 1 ? 0.5 : 1));
    this.damageUnit(hit, damage * crit * cover, i);
    return hit;
  }

  damageUnit(j: number, dmg: number, attacker: number): void {
    const sim = this.sim;
    const u = sim.units;
    if (!u.alive[j]) return;
    u.hp[j] -= dmg;
    if (u.hp[j] <= 0) {
      sim.emit({
        type: 'death',
        unit: j,
        owner: u.owner[j],
        x: u.x[j],
        z: u.z[j],
        y: sim.map.heightAt(u.x[j], u.z[j]) + u.elev[j],
      });
      sim.economy.onUnitRemoved(j);
      this.assault[j] = 0;
      u.kill(j);
    } else if (u.order[j] === Order.Idle && u.target[j] < 0 && UNIT_TYPES[u.kind[j]].armed && attacker >= 0) {
      u.target[j] = attacker; // return fire
    }
  }
}

/** Distance from a point to a structure's footprint rectangle (0 inside). */
export function distToRect(x: number, z: number, s: Structure): number {
  const dx = Math.max(s.tx - x, 0, x - (s.tx + s.w));
  const dz = Math.max(s.tz - z, 0, z - (s.tz + s.h));
  return Math.hypot(dx, dz);
}
