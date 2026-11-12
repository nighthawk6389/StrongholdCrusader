import { TICK_RATE, TICK_SEC } from './clock';
import { Block } from './map';
import { Nav, turnToward, wrapAngle, type Sim } from './sim';
import { STRUCTURE_DEFS, structureTop, upgradeMul, type MortarSpec, type Structure } from './structures';
import { UNIT_TYPES, UnitKind } from './unitTypes';
import { MAX_UNITS, Order, STANCE_HOLD_FIRE } from './units';
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
/** Seconds for a Breacher to bulldoze a ditch tile flat. */
export const DOZER_FILL_SEC = 1.5;
/** A Breacher only pushes one ramp per stretch of wall this long. */
const RAMP_SPACING = 4;

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
  /** Firing at a target without hurting it (shots blocked by a wall corner, say): who, since when, its health then. */
  private engaged = new Int32Array(MAX_UNITS).fill(-1);
  private engagedAt = new Int32Array(MAX_UNITS);
  private engagedHp = new Float32Array(MAX_UNITS);
  /** A target given up on, and until which tick it's ignored. */
  private ignored = new Int32Array(MAX_UNITS).fill(-1);
  private ignoredUntil = new Int32Array(MAX_UNITS);

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
      if (type.vehicle) u.suppressed[i] = 0;
      if (type.artillery) {
        // Any movement packs the gun up again.
        if (u.x[i] !== u.px[i] || u.z[i] !== u.pz[i]) u.deploy[i] = 0;
        else if (u.order[i] === Order.Control) u.deploy[i] = Math.min(1, u.deploy[i] + TICK_SEC / type.artillery.deploySec);
      }
      if (!type.armed || u.order[i] === Order.Control) continue;
      if (u.cooldown[i] > 0) u.cooldown[i]--;
      if (u.repath[i] > 0) u.repath[i]--;
      if (this.raidCooldown[i] > 0) this.raidCooldown[i]--;
      if (type.artillery) {
        this.doArtillery(i);
        continue;
      }
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
        case Order.AttackMove:
        case Order.Patrol:
          this.doAttackMove(i);
          break;
        default:
          if (u.stance[i] !== STANCE_HOLD_FIRE) this.autoEngage(i, u.order[i] === Order.Move || u.order[i] === Order.Follow);
      }
    }
    this.updateTurrets();
    this.updateMortars();
    this.updateShells();
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
    // Six seconds of shooting without a scratch on it: the shots aren't getting through. Give up on it
    // for a while and get on with the job rather than plinking at a wall forever.
    const tick = this.sim.tick;
    if (this.engaged[i] !== t) {
      this.engaged[i] = t;
      this.engagedAt[i] = tick;
      this.engagedHp[i] = u.hp[t];
    } else if (u.hp[t] < this.engagedHp[i] - 0.01) {
      this.engagedAt[i] = tick;
      this.engagedHp[i] = u.hp[t];
    } else if (tick - this.engagedAt[i] > 6 * TICK_RATE) {
      this.ignored[i] = t;
      this.ignoredUntil[i] = tick + 15 * TICK_RATE;
      this.engaged[i] = -1;
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
    const skip = this.sim.tick < this.ignoredUntil[i] ? this.ignored[i] : -1;
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === u.owner[i] || !seen[j] || j === skip) continue;
      const dx = u.x[j] - u.x[i];
      const dz = u.z[j] - u.z[i];
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      // Prefer soldiers over civilians.
      const tj = UNIT_TYPES[u.kind[j]];
      const ap = UNIT_TYPES[u.kind[i]].ap && UNIT_TYPES[u.kind[i]].infantryMul < 1;
      const score = d * (tj.armed ? 1 : 1.4) * (ap ? (tj.vehicle ? 0.3 : 1.6) : 1);
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
    const ditch = def.trap === 'ditch';
    // Engineers fill ditches with a shovel (no charge used); walls and gates take a charge.
    // Breachers bulldoze ditches and push a ramp (their "charge") against anything with a walkable top.
    const engineer = type.dozer
      ? ditch || (u.charges[i] > 0 && this.rampable(s, u.owner[i]))
      : u.charges[i] > 0 || (ditch && type.charges > 0 && !type.vehicle);
    if (!engineer && def.armored && !type.siege) return this.finishBreach(i);

    // Planting (or filling) in progress.
    if (u.plantTimer[i] > 0) {
      u.vx[i] = u.vz[i] = 0;
      u.plantTimer[i] -= TICK_SEC;
      if (u.plantTimer[i] <= 0) {
        u.plantTimer[i] = 0;
        if (ditch) {
          sim.damageStructure(s, s.hp + 1);
        } else if (type.dozer) {
          this.placeRamp(i, s);
          return this.finishBreach(i);
        } else {
          u.charges[i]--;
          this.explode(s, i);
        }
        if (u.charges[i] === 0 || !sim.structureById(s.id)) this.finishBreach(i);
      }
      return;
    }

    const gap = distToRect(u.x[i], u.z[i], s);
    if (engineer && gap <= (type.dozer ? 1.0 : 0.8) && u.layer[i] === 0) {
      u.vx[i] = u.vz[i] = 0;
      u.plantTimer[i] = type.dozer && ditch ? DOZER_FILL_SEC : type.plantSec;
      u.heading[i] = Math.atan2(s.tx + s.w / 2 - u.x[i], s.tz + s.h / 2 - u.z[i]);
      return;
    }
    if (!engineer && gap <= this.rangeOf(i) * 0.9 && this.losToStructure(i, s)) {
      u.vx[i] = u.vz[i] = 0;
      const cx = s.tx + s.w / 2;
      const cz = s.tz + s.h / 2;
      u.heading[i] = Math.atan2(cx - u.x[i], cz - u.z[i]);
      if (u.cooldown[i] === 0) {
        const hx = Math.min(Math.max(u.x[i], s.tx + 0.2), s.tx + s.w - 0.2);
        const hz = Math.min(Math.max(u.z[i], s.tz + 0.2), s.tz + s.h - 0.2);
        this.shotAt(i, hx, hz, 0.8);
        if (!type.silenced) sim.vision.reveal[i] = NOISE_SEC;
        if (type.splash > 0) sim.emit({ type: 'explosion', x: hx, z: hz, owner: u.owner[i] });
        sim.damageStructure(s, type.structDamage, type.siege);
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

  /** Attack-move and patrol: walk on, but stop and fight whatever comes into range. */
  private doAttackMove(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    if (u.stance[i] !== STANCE_HOLD_FIRE) {
      const t = this.scan(i);
      if (t >= 0) {
        u.vx[i] = u.vz[i] = 0;
        u.heading[i] = Math.atan2(u.x[t] - u.x[i], u.z[t] - u.z[i]);
        this.autoFire(i, t, false);
        return;
      }
    }
    const r = sim.navigate(i);
    if (r === Nav.Moving) return;
    u.vx[i] = u.vz[i] = 0;
    if (u.order[i] === Order.Patrol) {
      // Turn round and walk the beat the other way.
      const bx = u.patrolX[i];
      const bz = u.patrolZ[i];
      u.patrolX[i] = u.goalX[i];
      u.patrolZ[i] = u.goalZ[i];
      if (Math.hypot(bx - u.x[i], bz - u.z[i]) > 1 && sim.setDestination(i, bx, bz, 0)) return;
    }
    u.order[i] = Order.Idle;
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
      const t = UNIT_TYPES[u.kind[i]];
      const canFill = STRUCTURE_DEFS[obstacle.kind].trap === 'ditch' && (t.charges > 0 || t.dozer);
      const charge = t.dozer ? u.charges[i] > 0 && this.rampable(obstacle, u.owner[i]) : engineer;
      if (charge || canFill || t.siege || !STRUCTURE_DEFS[obstacle.kind].armored) {
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
      if (Math.hypot(u.x[j] - bx, u.z[j] - bz) < 1.6) this.damageUnit(j, CHARGE_SPLASH, i, true);
    }
    sim.damageStructure(s, CHARGE_DAMAGE, true);
    sim.traps.igniteNear(bx, bz, 1.6);
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
      const r = type.fly ? type.radius * 0.5 : type.radius + 0.06;
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
    const sType = shooter >= 0 ? UNIT_TYPES[u.kind[shooter]] : null;
    if (sType && sType.splash > 0) this.splash(toX, toZ, owner, damage * 0.45, sType.splash, hit, sType.ap);
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
    const st = shooter >= 0 ? UNIT_TYPES[u.kind[shooter]] : null;
    const soft = !UNIT_TYPES[u.kind[hit]].vehicle;
    this.damageUnit(hit, damage * crit * cover * (st && soft ? st.infantryMul : 1), shooter, !!st?.ap);
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
      if (type.hitbox) {
        // Vehicles: one box-ish cylinder, no weak spot.
        if (hl < 1e-6) continue;
        const [vr, vh] = type.hitbox;
        const tc = along;
        if (tc < o.startT || tc >= hitT + vr) continue;
        const px = ex + dx * tc - bx;
        const pz = ez + dz * tc - bz;
        const perp2 = px * px + pz * pz;
        if (perp2 > vr * vr) continue;
        const enter = Math.max(o.startT, tc - Math.sqrt(vr * vr - perp2) / Math.sqrt(hl));
        const yy = ey + dy * enter;
        if (enter >= hitT || yy < by - 0.05 || yy > by + vh) continue;
        hit = j;
        hitT = enter;
        head = false;
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
      const st = o.shooter >= 0 ? UNIT_TYPES[u.kind[o.shooter]] : null;
      const soft = !UNIT_TYPES[u.kind[hit]].vehicle;
      this.damageUnit(hit, o.damage * (head ? o.headshot : 1) * (st && soft ? st.infantryMul : 1), o.shooter, !!st?.ap);
    } else if (
      block &&
      block.owner !== o.owner &&
      block.owner !== 0 &&
      (!STRUCTURE_DEFS[block.kind].armored || (o.shooter >= 0 && UNIT_TYPES[u.kind[o.shooter]].siege)) &&
      o.structDamage > 0
    ) {
      sim.damageStructure(block, o.structDamage, o.shooter >= 0 && UNIT_TYPES[u.kind[o.shooter]].siege);
    }
    const sp = o.shooter >= 0 ? UNIT_TYPES[u.kind[o.shooter]] : null;
    if (sp && sp.splash > 0) {
      this.splash(x, z, o.owner, o.damage * 0.45, sp.splash, hit, sp.ap);
      sim.emit({ type: 'explosion', x, z, owner: o.owner });
    }
    return { unit: hit, head, x, y, z };
  }

  /** Fire a possessed soldier's weapon along the camera ray (magazine, bloom and movement apply). */
  controlledFire(i: number, c: ControlAim, moving: boolean): void {
    const sim = this.sim;
    const u = sim.units;
    const t = UNIT_TYPES[u.kind[i]];
    if (t.mag === 0 || u.cooldown[i] > 0 || u.reload[i] > 0 || u.plantTimer[i] > 0) return;
    if (t.artillery) {
      if (u.deploy[i] < 1) return;
      const base0 = sim.map.heightAt(u.x[i], u.z[i]);
      const e = this.eyeFor(u.x[i], base0 + 1.2, u.z[i], c);
      const g = this.groundPoint(e.x, e.y, e.z, c.yaw, c.pitch ?? -0.2, t.range + 8);
      if (!g) return;
      const d = Math.hypot(g.x - u.x[i], g.z - u.z[i]);
      if (d < t.artillery.minRange || d > t.range) {
        sim.emit({ type: 'notice', owner: u.owner[i], text: d < t.artillery.minRange ? 'Too close for the howitzer' : 'Out of range' });
        u.cooldown[i] = 10;
        return;
      }
      this.fireShell(i, g.x, g.z);
      u.cooldown[i] = t.cooldown;
      return;
    }
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

  /** Can a Breacher of `owner` push a ramp against this (a walkable top with no ramp of ours already on it)? */
  rampable(s: Structure, owner: number): boolean {
    if (STRUCTURE_DEFS[s.kind].deckH === undefined || s.kind === 'stairs' || s.kind === 'ramp') return false;
    for (const r of this.sim.structures) {
      if (r.kind === 'ramp' && r.owner === owner && distToRect(r.tx + 0.5, r.tz + 0.5, s) < RAMP_SPACING) return false;
    }
    return true;
  }

  /** Breacher: shove an assault ramp against structure `s`, on open ground right beside it. */
  placeRamp(i: number, s: Structure): boolean {
    const sim = this.sim;
    const u = sim.units;
    const map = sim.map;
    let best: { tx: number; tz: number } | null = null;
    let bestD = 2.2;
    const consider = (x: number, z: number): void => {
      if (!map.inBounds(x, z)) return;
      const k = map.idx(x, z);
      if (map.blocked[k] !== Block.Free || map.structAt[k] !== 0 || map.treeAt[k] >= 0) return;
      const d = Math.hypot(x + 0.5 - u.x[i], z + 0.5 - u.z[i]);
      if (d < bestD) {
        bestD = d;
        best = { tx: x, tz: z };
      }
    };
    // Square-on to the wall (deck to deck needs a straight step).
    for (let x = s.tx; x < s.tx + s.w; x++) {
      consider(x, s.tz - 1);
      consider(x, s.tz + s.h);
    }
    for (let z = s.tz; z < s.tz + s.h; z++) {
      consider(s.tx - 1, z);
      consider(s.tx + s.w, z);
    }
    if (!best || u.charges[i] === 0) {
      sim.emit({ type: 'notice', owner: u.owner[i], text: 'No room for a ramp here: try another stretch of wall' });
      return false;
    }
    const { tx, tz } = best;
    const rot = Math.atan2(s.tx + s.w / 2 - (tx + 0.5), s.tz + s.h / 2 - (tz + 0.5));
    const r = sim.placeStructure('ramp', u.owner[i], tx, tz, rot);
    if (!r) return false;
    u.charges[i]--;
    sim.emit({ type: 'ramp', owner: u.owner[i], target: s.owner, x: tx + 0.5, z: tz + 0.5 });
    sim.emit({ type: 'notice', owner: s.owner, text: 'The enemy has pushed a ramp against your wall!' });
    return true;
  }

  /** Possessed engineer/operator: plant a charge on the enemy structure you're standing against. */
  startPlant(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    const dozer = UNIT_TYPES[u.kind[i]].dozer;
    if ((u.charges[i] === 0 && !dozer) || u.plantTimer[i] > 0) return;
    let best: Structure | undefined;
    let bestD = dozer ? 1.3 : 1.0;
    for (const s of sim.structures) {
      if (s.owner === u.owner[i] || s.owner === 0) continue;
      if (dozer && !(STRUCTURE_DEFS[s.kind].trap === 'ditch' || (u.charges[i] > 0 && this.rampable(s, u.owner[i])))) continue;
      const d = distToRect(u.x[i], u.z[i], s);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best || u.layer[i] !== 0) {
      const text = dozer
        ? u.charges[i] > 0
          ? 'Drive right up to an enemy wall (for a ramp) or a ditch (to fill it)'
          : 'Out of ramps: drive up to a ditch to fill it'
        : 'Get right up against an enemy wall, gate or building to plant';
      sim.emit({ type: 'notice', owner: u.owner[i], text });
      return;
    }
    u.plantTimer[i] = dozer && STRUCTURE_DEFS[best.kind].trap === 'ditch' ? DOZER_FILL_SEC : UNIT_TYPES[u.kind[i]].plantSec;
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
    if (s && UNIT_TYPES[u.kind[i]].dozer) {
      if (STRUCTURE_DEFS[s.kind].trap === 'ditch') sim.damageStructure(s, s.hp + 1);
      else this.placeRamp(i, s);
    } else if (s && u.charges[i] > 0) {
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
      if (d < b.radius) this.damageUnit(j, b.damage * (1 - (0.6 * d) / b.radius), -1, true);
    }
    for (const s of [...sim.structures]) {
      if (s.owner === owner || s.owner === 0) continue;
      const d = distToRect(x, z, s);
      if (d < b.radius * 0.6) sim.damageStructure(s, b.structDamage * (1 - d / b.radius), true);
    }
  }

  // ------------------------------------------------------------------ splash & artillery

  /** Shells in flight (howitzers). */
  readonly shells: {
    owner: number;
    shooter: number;
    kind: number;
    x: number;
    z: number;
    t: number;
    T: number;
    /** Warhead (mortar rounds); otherwise the shooter kind's artillery blast. */
    blast?: { damage: number; radius: number; structDamage: number };
  }[] = [];
  private lastCounterNotice = new Map<number, number>();

  /** Area damage around an impact (not the unit that took the direct hit). */
  private splash(x: number, z: number, owner: number, dmg: number, radius: number, skip: number, ap: boolean): void {
    const u = this.sim.units;
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === owner || j === skip || UNIT_TYPES[u.kind[j]].fly) continue;
      const d = Math.hypot(u.x[j] - x, u.z[j] - z);
      if (d < radius) this.damageUnit(j, dmg * (1 - (0.5 * d) / radius), -1, ap);
    }
  }

  /** Where a ray from the camera meets the ground, or null. */
  groundPoint(ex: number, ey: number, ez: number, yaw: number, pitch: number, reach: number): { x: number; z: number } | null {
    const map = this.sim.map;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = Math.cos(yaw) * cp;
    for (let t = 0.5; t < reach * 1.5; t += 0.25) {
      const x = ex + dx * t;
      const z = ez + dz * t;
      if (!map.inBounds(Math.floor(x), Math.floor(z))) return null;
      if (ey + dy * t <= map.heightAt(x, z)) return { x, z };
    }
    return null;
  }

  /** Lob a shell at a point; it lands after a flight time, a little off the mark. */
  fireShell(i: number, tx: number, tz: number): void {
    const sim = this.sim;
    const u = sim.units;
    const t = UNIT_TYPES[u.kind[i]];
    const art = t.artillery;
    if (!art) return;
    const d = Math.hypot(tx - u.x[i], tz - u.z[i]);
    const miss = art.scatter * Math.min(1, d / t.range) * sim.rng.next();
    const a = sim.rng.next() * Math.PI * 2;
    const x = Math.min(Math.max(tx + Math.cos(a) * miss, 0.5), sim.map.width - 0.5);
    const z = Math.min(Math.max(tz + Math.sin(a) * miss, 0.5), sim.map.height - 0.5);
    const T = Math.max(0.8, d / art.shellSpeed);
    this.shells.push({ owner: u.owner[i], shooter: i, kind: u.kind[i], x, z, t: 0, T });
    u.heading[i] = Math.atan2(tx - u.x[i], tz - u.z[i]);
    u.lastShot[i] = sim.tick;
    sim.vision.reveal[i] = NOISE_SEC; // the muzzle blast gives it away
    sim.emit({
      type: 'shell',
      owner: u.owner[i],
      fromX: u.x[i],
      fromZ: u.z[i],
      fromY: sim.map.heightAt(u.x[i], u.z[i]) + 1.1,
      toX: x,
      toZ: z,
      toY: sim.map.heightAt(x, z),
      flight: T,
    });
  }

  private updateShells(): void {
    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k];
      s.t += TICK_SEC;
      if (s.t < s.T) continue;
      this.shells.splice(k, 1);
      const blast = s.blast ?? UNIT_TYPES[s.kind].artillery?.blast;
      if (blast) this.blast(s.x, s.z, this.sim.map.heightAt(s.x, s.z), s.owner, blast);
    }
  }

  /**
   * Howitzers: pick something in range (a structure you ordered, the unit you ordered, or the
   * nearest enemy your side can see), stop, deploy, then fire. Assaults bombard the walls in front of them.
   */
  private doArtillery(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    const t = UNIT_TYPES[u.kind[i]];
    const art = t.artillery!;
    const owner = u.owner[i];
    let aim: { x: number; z: number } | null = null;
    let approach = false;
    switch (u.order[i]) {
      case Order.Breach: {
        const s = sim.structureById(u.targetStruct[i]);
        if (!s || s.owner === owner) return this.finishBreach(i);
        aim = { x: s.tx + s.w / 2, z: s.tz + s.h / 2 };
        approach = true;
        break;
      }
      case Order.Attack: {
        const j = u.target[i];
        if (!u.isAlive(j) || u.owner[j] === owner) {
          u.order[i] = Order.Idle;
          u.target[i] = -1;
          return;
        }
        if (sim.vision.isSeen(owner, j)) aim = { x: u.x[j], z: u.z[j] };
        approach = true;
        break;
      }
      case Order.Assault: {
        const s = this.siegeTarget(i, this.assaultTarget[i]);
        if (s) aim = { x: s.tx + s.w / 2, z: s.tz + s.h / 2 };
        else {
          const goal = this.assaultGoal(this.assaultTarget[i]);
          if (!goal) {
            u.order[i] = Order.Idle;
            this.assault[i] = 0;
            return;
          }
          aim = { x: goal.x, z: goal.z };
        }
        approach = true;
        break;
      }
      case Order.Move:
      case Order.Follow:
        return;
      default: {
        if ((sim.tick + i) % ENGAGE_INTERVAL === 0) u.target[i] = this.findTarget(i, t.range);
        const j = u.target[i];
        if (u.isAlive(j) && u.owner[j] !== owner && sim.vision.isSeen(owner, j)) aim = { x: u.x[j], z: u.z[j] };
      }
    }
    if (!aim) return;
    const d = Math.hypot(aim.x - u.x[i], aim.z - u.z[i]);
    if (d > t.range * 0.95 || (approach && d < art.minRange)) {
      if (!approach) return;
      // Close in (or back off) to a firing spot on our side of the target, well inside range.
      if (u.repath[i] === 0) {
        const k = (t.range * 0.8) / Math.max(d, 0.01);
        sim.setDestination(i, aim.x + (u.x[i] - aim.x) * k, aim.z + (u.z[i] - aim.z) * k, 0, false);
        u.repath[i] = 40;
      }
      if (d > t.range * 0.95) sim.navigate(i);
      return;
    }
    if (d < art.minRange) return;
    u.vx[i] = u.vz[i] = 0;
    if (u.x[i] === u.px[i] && u.z[i] === u.pz[i]) u.deploy[i] = Math.min(1, u.deploy[i] + TICK_SEC / art.deploySec);
    u.heading[i] = turnToward(u.heading[i], Math.atan2(aim.x - u.x[i], aim.z - u.z[i]), 1.5 * TICK_SEC);
    if (u.deploy[i] < 1 || u.cooldown[i] > 0) return;
    this.fireShell(i, aim.x, aim.z);
    u.cooldown[i] = Math.min(255, t.autoCooldown + sim.rng.int(t.autoJitter + 1));
  }

  /**
   * Mortar pits fire on their own: counter-battery first (any enemy gun that has fired recently and is
   * within reach, seen or not: the radar plots it from its shells), then the nearest enemy your side can
   * see, vehicles before infantry.
   */
  private updateMortars(): void {
    const sim = this.sim;
    const u = sim.units;
    for (const s of sim.structures) {
      const spec = STRUCTURE_DEFS[s.kind].mortar;
      if (!spec) continue;
      if (s.cooldown > 0) {
        s.cooldown--;
        continue;
      }
      if ((sim.tick + s.id) % 10 !== 0) continue;
      const cx = s.tx + s.w / 2;
      const cz = s.tz + s.h / 2;
      let best = -1;
      let bestScore = Infinity;
      let counter = false;
      for (let j = 0; j < u.count; j++) {
        if (!u.alive[j] || u.owner[j] === s.owner || u.owner[j] === 0) continue;
        const t = UNIT_TYPES[u.kind[j]];
        if (t.fly || u.kind[j] === UnitKind.Civilian) continue;
        const d = Math.hypot(u.x[j] - cx, u.z[j] - cz);
        if (d > spec.range || d < spec.minRange) continue;
        const firing = !!t.artillery && sim.tick - u.lastShot[j] < spec.trackSec * TICK_RATE;
        if (!firing && !sim.vision.isSeen(s.owner, j)) continue;
        const score = d - (firing ? 1000 : t.vehicle ? 15 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = j;
          counter = firing;
        }
      }
      if (best < 0) continue;
      this.fireMortar(s, spec, u.x[best], u.z[best]);
      s.cooldown = Math.round((spec.cooldownSec * TICK_RATE) / upgradeMul(s, 'speed'));
      if (counter && sim.elapsed - (this.lastCounterNotice.get(s.owner) ?? -1e9) > 45) {
        this.lastCounterNotice.set(s.owner, sim.elapsed);
        sim.emit({ type: 'notice', owner: s.owner, text: 'Counter-battery: your mortar is firing back at an enemy gun' });
      }
    }
  }

  private fireMortar(s: Structure, spec: MortarSpec, tx: number, tz: number): void {
    const sim = this.sim;
    const cx = s.tx + s.w / 2;
    const cz = s.tz + s.h / 2;
    const d = Math.hypot(tx - cx, tz - cz);
    const miss = spec.scatter * Math.min(1, d / spec.range) * sim.rng.next();
    const a = sim.rng.next() * Math.PI * 2;
    const x = Math.min(Math.max(tx + Math.cos(a) * miss, 0.5), sim.map.width - 0.5);
    const z = Math.min(Math.max(tz + Math.sin(a) * miss, 0.5), sim.map.height - 0.5);
    const T = Math.max(0.8, d / spec.shellSpeed);
    s.aim = Math.atan2(tx - cx, tz - cz);
    this.shells.push({ owner: s.owner, shooter: -1, kind: -1, x, z, t: 0, T, blast: spec.blast });
    sim.emit({
      type: 'shell',
      owner: s.owner,
      fromX: cx,
      fromZ: cz,
      fromY: sim.map.heightAt(cx, cz) + 0.8,
      toX: x,
      toZ: z,
      toY: sim.map.heightAt(x, z),
      flight: T,
    });
  }

  /** Assaulting artillery: the nearest enemy wall, tower, gate or building in range. */
  private siegeTarget(i: number, enemy: number): Structure | undefined {
    const u = this.sim.units;
    const t = UNIT_TYPES[u.kind[i]];
    let best: Structure | undefined;
    let bestD = t.range * 0.95;
    for (const s of this.sim.structures) {
      if (s.owner !== enemy || STRUCTURE_DEFS[s.kind].trap) continue;
      const d = Math.hypot(s.tx + s.w / 2 - u.x[i], s.tz + s.h / 2 - u.z[i]);
      if (d < bestD && d > (t.artillery?.minRange ?? 0)) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** `ap`: armor-piercing (rockets, tank guns, explosives) ignores a vehicle's armor. */
  damageUnit(j: number, dmg: number, attacker: number, ap = false): void {
    const sim = this.sim;
    const u = sim.units;
    if (!u.alive[j]) return;
    if (!ap) dmg *= UNIT_TYPES[u.kind[j]].armor;
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
