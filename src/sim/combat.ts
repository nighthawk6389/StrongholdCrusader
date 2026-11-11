import { TICK_SEC } from './clock';
import { Block } from './map';
import { Nav, turnToward, wrapAngle, type Sim } from './sim';
import { STRUCTURE_DEFS, structureTop, type Structure } from './structures';
import { UNIT_TYPES } from './unitTypes';
import { MAX_UNITS, Order } from './units';
import { NOISE_SEC } from './vision';

const ENGAGE_INTERVAL = 4;
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

// Hitboxes for aimed (direct-control) fire, in tiles above the unit's feet.
const BODY_H = 0.86;
const HEAD_Y = 0.97;
const HEAD_R = 0.14;
const FLYER_R = 0.42;
/** Rocks stop shots below this height above the ground. */
const ROCK_H = 1.6;

/** A direct-control shot: a ray from the camera through the crosshair. */
export interface AimedShot {
  /** Firing unit, or -1 for a gun tower. */
  shooter: number;
  owner: number;
  /** Ray origin (the camera) and direction. */
  ex: number;
  ey: number;
  ez: number;
  yaw: number;
  pitch: number;
  /** Ray distance at which the shot actually leaves the muzzle (skips anything behind the gun). */
  startT: number;
  range: number;
  damage: number;
  headshot: number;
  suppress: number;
  structDamage: number;
  /** Tracer start. */
  mx: number;
  my: number;
  mz: number;
  /** Ignore structures within `nearR` of (nearX, nearZ): the wall or tower you're standing on. */
  nearX: number;
  nearZ: number;
  nearR: number;
}

export interface AimedResult {
  unit: number;
  head: boolean;
  x: number;
  y: number;
  z: number;
}

/** Distance along a unit ray to a sphere, or Infinity. */
function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

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
      if (u.bloom[i] > 0) u.bloom[i] = Math.max(0, u.bloom[i] - 0.09 * TICK_SEC);
      if (u.reload[i] > 0) {
        u.reload[i] -= TICK_SEC;
        if (u.reload[i] <= 0) {
          u.reload[i] = 0;
          u.ammo[i] = type.mag;
        }
      }
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
          this.autoEngage(i, u.order[i] === Order.Move || u.order[i] === Order.Follow);
      }
    }
    this.updateTurrets();
  }

  // ------------------------------------------------------------------ targeting

  /** Rescan (staggered) and return a valid target within range, or -1. */
  private scan(i: number): number {
    const u = this.sim.units;
    if ((this.sim.tick + i) % ENGAGE_INTERVAL === 0) u.target[i] = this.findTarget(i, this.rangeOf(i));
    const t = u.target[i];
    if (t < 0) return -1;
    if (!u.alive[t] || u.owner[t] === u.owner[i] || !this.sim.vision.isSeen(u.owner[i], t)) {
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
    const seen = this.sim.vision.seen[u.owner[i]];
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === u.owner[i] || !seen[j]) continue;
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
    // Nothing on the ground hides a drone (or what a drone looks down on).
    if (UNIT_TYPES[u.kind[i]].fly || UNIT_TYPES[u.kind[j]].fly) return true;
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
    if (dist <= this.rangeOf(i) && this.los(i, t) && sim.vision.isSeen(u.owner[i], t)) {
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
      u.plantTimer[i] = UNIT_TYPES[u.kind[i]].plantSec;
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
        if (!type.silenced) sim.vision.reveal[i] = NOISE_SEC;
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

  explode(s: Structure, i: number): void {
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
    const u = this.sim.units;
    const y = this.sim.map.heightAt(u.x[i], u.z[i]) + u.elev[i] + MUZZLE_Y;
    return this.fireFrom(i, u.owner[i], u.x[i], u.z[i], y, u.layer[i] === 1, yaw, range, damage, aimed, suppress);
  }

  /** Flat hitscan from a point (soldiers and gun towers). `shooter` is the firing unit, or -1. */
  fireFrom(
    shooter: number,
    owner: number,
    ox: number,
    oz: number,
    oy: number,
    elevated: boolean,
    yaw: number,
    range: number,
    damage: number,
    aimed: boolean,
    suppress: number,
  ): number {
    const sim = this.sim;
    const u = sim.units;
    const map = sim.map;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
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
      if (!u.alive[j] || u.owner[j] === owner) continue;
      const rx = u.x[j] - ox;
      const rz = u.z[j] - oz;
      const t = rx * dx + rz * dz;
      if (t <= 0 || t >= hitT) continue;
      const type = UNIT_TYPES[u.kind[j]];
      const reach = type.fly ? range : u.layer[j] === 1 ? maxT + 1.3 : maxT;
      if (t >= reach) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      // Drones are small, quick targets.
      const r = type.fly ? type.radius * 0.6 : type.radius + 0.06;
      if (perp < r) {
        hit = j;
        hitT = t;
        hitPerp = perp / r;
      }
    }

    // Unsilenced gunfire gives the shooter's position away.
    if (shooter >= 0) {
      if (!UNIT_TYPES[u.kind[shooter]].silenced) sim.vision.reveal[shooter] = NOISE_SEC;
      u.lastShot[shooter] = sim.tick;
    }
    const endT = hit >= 0 ? hitT : maxT;
    const toX = ox + dx * endT;
    const toZ = oz + dz * endT;
    sim.emit({
      type: 'shot',
      unit: shooter,
      owner,
      fromX: ox,
      fromZ: oz,
      fromY: oy,
      toX,
      toZ,
      toY: map.heightAt(toX, toZ) + (hit >= 0 ? u.elev[hit] + (UNIT_TYPES[u.kind[hit]].fly ? 0.1 : 0.7) : 0.5),
      hit: hit >= 0,
      target: hit,
    });
    if (hit < 0) return -1;

    const crit = aimed && hitPerp < 0.35 ? 2 : 1;
    const cover = u.layer[hit] === 1 ? DECK_COVER : 1;
    if (suppress > 0) u.suppressed[hit] = Math.max(u.suppressed[hit], suppress * (cover < 1 ? 0.5 : 1));
    this.damageUnit(hit, damage * crit * cover, shooter);
    return hit;
  }

  /**
   * Direct-control shot: a 3D ray from the camera through the crosshair, so what's under the
   * crosshair is what gets hit. Soldiers have a body cylinder and a head sphere (head hits multiply
   * damage); drones are a sphere. Ground, rocks, walls and buildings stop the round by height, so a
   * parapet covers a defender's body but not their head.
   */
  aimedShot(o: AimedShot): AimedResult {
    const sim = this.sim;
    const u = sim.units;
    const map = sim.map;
    const cp = Math.cos(o.pitch);
    const dx = Math.sin(o.yaw) * cp;
    const dy = Math.sin(o.pitch);
    const dz = Math.cos(o.yaw) * cp;
    const { ex, ey, ez } = o;

    let maxT = o.startT + o.range;
    let block: Structure | undefined;
    for (let t = o.startT; t <= maxT; t += 0.12) {
      const px = ex + dx * t;
      const py = ey + dy * t;
      const pz = ez + dz * t;
      const tx = Math.floor(px);
      const tz = Math.floor(pz);
      if (!map.inBounds(tx, tz)) {
        maxT = t;
        break;
      }
      const g = map.heightAt(px, pz);
      if (py < g) {
        maxT = t;
        break;
      }
      const tile = map.idx(tx, tz);
      if (map.blocked[tile] === Block.Terrain) {
        if (py < g + ROCK_H) {
          maxT = t;
          break;
        }
        continue;
      }
      const sid = map.structAt[tile];
      const b = map.blocked[tile];
      if (!sid && b !== Block.Structure && b !== Block.Gate) continue;
      if (o.nearR > 0 && Math.hypot(px - o.nearX, pz - o.nearZ) < o.nearR) continue;
      const s = sid ? sim.structureById(sid) : undefined;
      if (py < g + (s ? structureTop(s.kind) : 2.2)) {
        maxT = t;
        block = s;
        break;
      }
    }

    let hit = -1;
    let hitT = maxT;
    let head = false;
    const hl = dx * dx + dz * dz;
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === o.owner || j === o.shooter) continue;
      const type = UNIT_TYPES[u.kind[j]];
      const bx = u.x[j];
      const bz = u.z[j];
      // Cheap reject: too far from the ray in the ground plane.
      const rx = bx - ex;
      const rz = bz - ez;
      const along = hl > 1e-6 ? (rx * dx + rz * dz) / hl : 0;
      if (hl > 1e-6 && (along < o.startT - 1 || along > hitT + 1)) continue;
      const by = map.heightAt(bx, bz) + u.elev[j];
      if (type.fly) {
        const th = raySphere(ex, ey, ez, dx, dy, dz, bx, by + 0.15, bz, FLYER_R);
        if (th >= o.startT && th < hitT) {
          hit = j;
          hitT = th;
          head = false;
        }
        continue;
      }
      const th = raySphere(ex, ey, ez, dx, dy, dz, bx, by + HEAD_Y, bz, HEAD_R);
      if (th >= o.startT && th < hitT) {
        hit = j;
        hitT = th;
        head = true;
      }
      if (hl < 1e-6) continue;
      const tc = along;
      if (tc < o.startT || tc >= hitT) continue;
      const px = ex + dx * tc - bx;
      const pz = ez + dz * tc - bz;
      const rr = type.radius * 0.85;
      const perp2 = px * px + pz * pz;
      if (perp2 > rr * rr) continue;
      const yy = ey + dy * tc;
      if (yy < by || yy > by + BODY_H) continue;
      hit = j;
      hitT = Math.max(o.startT, tc - Math.sqrt(rr * rr - perp2) / Math.sqrt(hl));
      head = false;
    }

    if (o.shooter >= 0) {
      if (!UNIT_TYPES[u.kind[o.shooter]].silenced) sim.vision.reveal[o.shooter] = NOISE_SEC;
      u.lastShot[o.shooter] = sim.tick;
    }
    const x = ex + dx * hitT;
    const y = ey + dy * hitT;
    const z = ez + dz * hitT;
    sim.emit({
      type: 'shot',
      unit: o.shooter,
      owner: o.owner,
      fromX: o.mx,
      fromZ: o.mz,
      fromY: o.my,
      toX: x,
      toZ: z,
      toY: y,
      hit: hit >= 0,
      target: hit,
      head,
    });
    if (hit >= 0) {
      if (o.suppress > 0) u.suppressed[hit] = Math.max(u.suppressed[hit], o.suppress);
      this.damageUnit(hit, o.damage * (head ? o.headshot : 1), o.shooter);
    } else if (block && block.owner !== o.owner && block.owner !== 0 && !STRUCTURE_DEFS[block.kind].armored && o.structDamage > 0) {
      sim.damageStructure(block, o.structDamage);
    }
    return { unit: hit, head, x, y, z };
  }

  /** Fire a possessed soldier's weapon along the camera ray (magazine, bloom and movement apply). */
  controlledFire(i: number, c: ControlAim, moving: boolean): void {
    const sim = this.sim;
    const u = sim.units;
    const t = UNIT_TYPES[u.kind[i]];
    if (t.mag === 0 || u.cooldown[i] > 0 || u.reload[i] > 0 || u.plantTimer[i] > 0) return;
    if (u.ammo[i] === 0) {
      u.reload[i] = t.reloadSec;
      return;
    }
    const sigma = t.spread * (c.aim ? 0.12 : 0.6) + (moving ? 0.015 : 0) + u.bloom[i] + (u.suppressed[i] > 0 ? 0.02 : 0);
    const yaw = c.yaw + (sim.rng.next() - 0.5) * 2 * sigma;
    const pitch = (c.pitch ?? 0) + (sim.rng.next() - 0.5) * 2 * sigma;
    const base = sim.map.heightAt(u.x[i], u.z[i]) + u.elev[i];
    // Without camera data, aim from chest height (a level shot hits a standing man).
    const eye = this.eyeFor(u.x[i], base + 0.8, u.z[i], c);
    const cp = Math.cos(pitch);
    const startT = Math.max(0, (u.x[i] - eye.x) * Math.sin(yaw) * cp + (u.z[i] - eye.z) * Math.cos(yaw) * cp + (base + 0.8 - eye.y) * Math.sin(pitch) - 0.2);
    this.aimedShot({
      shooter: i,
      owner: u.owner[i],
      ex: eye.x,
      ey: eye.y,
      ez: eye.z,
      yaw,
      pitch,
      startT,
      range: t.range,
      damage: t.damage,
      headshot: t.headshot,
      suppress: t.suppress,
      structDamage: t.structDamage,
      mx: u.x[i] + Math.sin(c.yaw) * 0.35,
      my: base + MUZZLE_Y,
      mz: u.z[i] + Math.cos(c.yaw) * 0.35,
      nearX: u.x[i],
      nearZ: u.z[i],
      nearR: u.layer[i] === 1 ? 1.1 : 0,
    });
    u.ammo[i]--;
    u.cooldown[i] = t.cooldown;
    u.bloom[i] = Math.min(0.05, u.bloom[i] + (t.mag >= 100 ? 0.004 : 0.008));
    if (u.ammo[i] === 0) u.reload[i] = t.reloadSec;
  }

  /** Start a reload if the magazine isn't full. */
  startReload(i: number): void {
    const u = this.sim.units;
    const t = UNIT_TYPES[u.kind[i]];
    if (t.mag > 0 && u.reload[i] === 0 && u.ammo[i] < t.mag) u.reload[i] = t.reloadSec;
  }

  /** Possessed engineer/operator: plant a charge on the enemy structure you're standing against. */
  startPlant(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    if (u.charges[i] === 0 || u.plantTimer[i] > 0) return;
    let best: Structure | undefined;
    let bestD = 1.0;
    for (const s of sim.structures) {
      if (s.owner === u.owner[i] || s.owner === 0) continue;
      const d = distToRect(u.x[i], u.z[i], s);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best || u.layer[i] !== 0) {
      sim.emit({ type: 'notice', owner: u.owner[i], text: 'Get right up against an enemy wall, gate or building to plant' });
      return;
    }
    u.plantTimer[i] = UNIT_TYPES[u.kind[i]].plantSec;
    u.targetStruct[i] = best.id;
    u.vx[i] = u.vz[i] = 0;
  }

  /** Advance a possessed unit's charge plant; it goes off when the timer runs out. */
  tickPlant(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    if (u.plantTimer[i] <= 0) return;
    u.vx[i] = u.vz[i] = 0;
    u.plantTimer[i] -= TICK_SEC;
    if (u.plantTimer[i] > 0) return;
    u.plantTimer[i] = 0;
    const s = sim.structureById(u.targetStruct[i]);
    u.targetStruct[i] = -1;
    if (s && u.charges[i] > 0) {
      u.charges[i]--;
      this.explode(s, i);
    }
  }

  /** The camera position a control command came from (clamped near the unit), or a default eye. */
  private eyeFor(x: number, y: number, z: number, c: ControlAim): { x: number; y: number; z: number } {
    if (c.ex === undefined || c.ey === undefined || c.ez === undefined) return { x, y, z };
    const dx = c.ex - x;
    const dy = c.ey - y;
    const dz = c.ez - z;
    const d = Math.hypot(dx, dy, dz);
    const k = d > 4 ? 4 / d : 1;
    return { x: x + dx * k, y: y + dy * k, z: z + dz * k };
  }

  // ------------------------------------------------------------------ gun towers

  /** A gun tower is crewed while one of its owner's soldiers stands on top of it. */
  crewed(s: Structure): boolean {
    const u = this.sim.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== s.owner || u.layer[i] !== 1 || !UNIT_TYPES[u.kind[i]].armed) continue;
      if (u.x[i] >= s.tx && u.x[i] < s.tx + s.w && u.z[i] >= s.tz && u.z[i] < s.tz + s.h) return true;
    }
    return false;
  }

  turretRange(s: Structure): number {
    const def = STRUCTURE_DEFS[s.kind];
    return (def.turret?.range ?? 0) * (1 + 0.12 * (def.deckH ?? 0));
  }

  /** Muzzle position of a gun tower's gun. */
  turretMuzzle(s: Structure): { x: number; y: number; z: number } {
    const cx = s.tx + s.w / 2;
    const cz = s.tz + s.h / 2;
    return {
      x: cx + Math.sin(s.aim) * 0.7,
      y: this.sim.map.heightAt(cx, cz) + (STRUCTURE_DEFS[s.kind].deckH ?? 0) + 0.95,
      z: cz + Math.cos(s.aim) * 0.7,
    };
  }

  private updateTurrets(): void {
    const sim = this.sim;
    const u = sim.units;
    for (const s of sim.structures) {
      const spec = STRUCTURE_DEFS[s.kind].turret;
      if (!spec) continue;
      if (s.cooldown > 0) s.cooldown--;
      if (s.reload > 0) {
        s.reload -= TICK_SEC;
        if (s.reload <= 0) {
          s.reload = 0;
          s.ammo = spec.mag;
        }
      }
      if (sim.tick < s.manualUntil) continue;
      if ((sim.tick + s.id) % ENGAGE_INTERVAL !== 0 && s.target < 0) continue;
      if (!this.crewed(s)) {
        s.target = -1;
        continue;
      }
      const range = this.turretRange(s);
      const cx = s.tx + s.w / 2;
      const cz = s.tz + s.h / 2;
      const valid = (t: number): boolean =>
        u.isAlive(t) && u.owner[t] !== s.owner && sim.vision.isSeen(s.owner, t) && Math.hypot(u.x[t] - cx, u.z[t] - cz) <= range;
      if ((sim.tick + s.id) % ENGAGE_INTERVAL === 0 || !valid(s.target)) s.target = this.turretTarget(s, range, cx, cz);
      const t = s.target;
      if (t < 0) continue;
      const want = Math.atan2(u.x[t] - cx, u.z[t] - cz);
      s.aim = turnToward(s.aim, want, spec.turn * TICK_SEC);
      if (s.cooldown > 0 || Math.abs(wrapAngle(want - s.aim)) > 0.12) continue;
      const dist = Math.hypot(u.x[t] - cx, u.z[t] - cz);
      const spread = spec.spread * (0.6 + (0.8 * dist) / range);
      const m = this.turretMuzzle(s);
      const hit = this.fireFrom(-1, s.owner, m.x, m.z, m.y, true, s.aim + (sim.rng.next() - 0.5) * 2 * spread, range + 2, spec.autoDamage, false, 0);
      const cover = u.layer[t] === 1 ? 0.5 : 1;
      u.suppressed[t] = Math.max(u.suppressed[t], spec.suppress * (hit === t ? 1 : 0.6) * cover);
      s.cooldown = spec.autoCooldown;
    }
  }

  private turretTarget(s: Structure, range: number, cx: number, cz: number): number {
    const u = this.sim.units;
    const map = this.sim.map;
    const seen = this.sim.vision.seen[s.owner];
    let best = -1;
    let bestD = range;
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === s.owner || !seen[j]) continue;
      const d = Math.hypot(u.x[j] - cx, u.z[j] - cz);
      if (d >= bestD) continue;
      // From up top only rocks block the view (drones are never hidden).
      let clear = true;
      if (!UNIT_TYPES[u.kind[j]].fly) {
        const steps = Math.ceil(d / 0.4);
        for (let k = 1; k < steps; k++) {
          const f = k / steps;
          const tx = Math.floor(cx + (u.x[j] - cx) * f);
          const tz = Math.floor(cz + (u.z[j] - cz) * f);
          if (map.blocked[map.idx(tx, tz)] === Block.Terrain) {
            clear = false;
            break;
          }
        }
      }
      if (clear) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  /** Hand-aimed burst from a gun tower (needs a soldier up top). */
  turretFire(s: Structure, c: ControlAim): void {
    const sim = this.sim;
    const spec = STRUCTURE_DEFS[s.kind].turret;
    if (!spec || s.cooldown > 0 || s.reload > 0) return;
    if (!this.crewed(s)) return;
    if (s.ammo === 0) {
      s.reload = spec.reloadSec;
      return;
    }
    const sigma = spec.spread * (c.aim ? 0.15 : 0.35);
    const yaw = c.yaw + (sim.rng.next() - 0.5) * 2 * sigma;
    const pitch = (c.pitch ?? 0) + (sim.rng.next() - 0.5) * 2 * sigma;
    const m = this.turretMuzzle(s);
    const eye = this.eyeFor(m.x, m.y + 0.4, m.z, c);
    const cp = Math.cos(pitch);
    const startT = Math.max(0, (m.x - eye.x) * Math.sin(yaw) * cp + (m.z - eye.z) * Math.cos(yaw) * cp);
    this.aimedShot({
      shooter: -1,
      owner: s.owner,
      ex: eye.x,
      ey: eye.y,
      ez: eye.z,
      yaw,
      pitch,
      startT,
      range: this.turretRange(s),
      damage: spec.damage,
      headshot: 1.5,
      suppress: spec.suppress,
      structDamage: 8,
      mx: m.x,
      my: m.y,
      mz: m.z,
      nearX: s.tx + s.w / 2,
      nearZ: s.tz + s.h / 2,
      nearR: 1.6,
    });
    s.ammo--;
    s.cooldown = spec.cooldown;
    if (s.ammo === 0) s.reload = spec.reloadSec;
  }

  /** Strike-drone warhead (or any blast) at a point. */
  blast(x: number, z: number, y: number, owner: number, b: { damage: number; radius: number; structDamage: number }): void {
    const sim = this.sim;
    const u = sim.units;
    sim.emit({ type: 'explosion', x, z, owner });
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === owner) continue;
      const jy = sim.map.heightAt(u.x[j], u.z[j]) + u.elev[j] + 0.5;
      const d = Math.hypot(u.x[j] - x, u.z[j] - z, (jy - y) * 0.7);
      if (d < b.radius) this.damageUnit(j, b.damage * (1 - (0.6 * d) / b.radius), -1);
    }
    for (const s of [...sim.structures]) {
      if (s.owner === owner || s.owner === 0) continue;
      const d = distToRect(x, z, s);
      if (d < b.radius * 0.6) sim.damageStructure(s, b.structDamage * (1 - d / b.radius));
    }
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
        kind: u.kind[j],
      });
      sim.economy.onUnitRemoved(j);
      this.assault[j] = 0;
      u.kill(j);
    } else if ((u.order[j] === Order.Idle || u.order[j] === Order.Follow) && u.target[j] < 0 && UNIT_TYPES[u.kind[j]].armed && attacker >= 0) {
      u.target[j] = attacker; // return fire
    }
  }
}

/** Aim fields of a control command (see Sim `control`). */
export interface ControlAim {
  yaw: number;
  pitch?: number;
  aim: boolean;
  ex?: number;
  ey?: number;
  ez?: number;
}

/** Distance from a point to a structure's footprint rectangle (0 inside). */
export function distToRect(x: number, z: number, s: Structure): number {
  const dx = Math.max(s.tx - x, 0, x - (s.tx + s.w));
  const dz = Math.max(s.tz - z, 0, z - (s.tz + s.h));
  return Math.hypot(dx, dz);
}
