import { TICK_SEC } from './clock';
import { distToRect } from './combat';
import type { Sim } from './sim';
import { turnToward } from './sim';
import { RES_INFO, Res, STRUCTURE_DEFS, type ResId, type Structure } from './structures';
import { UNIT_TYPES, UnitKind } from './unitTypes';
import { Order } from './units';

/** What a Drone Bay charges to put a drone in the air. */
export const DRONE_COST: Record<number, { funds: number; steel: number; gear?: ResId }> = {
  [UnitKind.ReconDrone]: { funds: 40, steel: 4 },
  [UnitKind.StrikeDrone]: { funds: 50, steel: 6, gear: Res.Charges },
};

/** Battery seconds left when a drone not under your control heads home. */
export const RETURN_AT = 22;
/** Battery seconds regained per second while parked at a powered bay. */
const RECHARGE = 6;
const DOCK_RANGE = 1.6;
const DIVE_SPEED = 11;
/** A strike drone goes off this close to its target. */
const STRIKE_REACH = 0.9;

/**
 * Drones fly straight over walls and terrain at their cruise height. They run on batteries: when
 * low they fly home to their bay and recharge there (if it has power); a flat battery means a crash.
 * Strike drones dive onto a unit, structure or point and explode.
 */
export class Drones {
  constructor(private sim: Sim) {}

  bayOf(i: number): Structure | undefined {
    const s = this.sim.structureById(this.sim.units.home[i]);
    return s && s.kind === 'dronebay' && s.owner === this.sim.units.owner[i] ? s : undefined;
  }

  /** Drones currently assigned to a bay. */
  countAt(bay: Structure): number {
    const u = this.sim.units;
    let n = 0;
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.home[i] === bay.id && UNIT_TYPES[u.kind[i]].fly) n++;
    return n;
  }

  /** Why `bayId` can't launch a drone of `kind` right now, or null if it can. */
  launchBlocker(owner: number, bayId: number, kind: number): string | null {
    const s = this.sim.structureById(bayId);
    if (!s || s.owner !== owner || s.kind !== 'dronebay') return 'No drone bay';
    const cost = DRONE_COST[kind];
    if (!cost) return 'Not a drone';
    if (!s.powered) return 'The bay has no power';
    if (this.countAt(s) >= (STRUCTURE_DEFS.dronebay.bay?.capacity ?? 0)) return 'The bay is full';
    const p = this.sim.economy.player(owner);
    if (p.funds < cost.funds) return 'Not enough funds';
    if (p.stock[Res.Steel] < cost.steel) return 'Not enough steel';
    if (cost.gear !== undefined && p.stock[cost.gear] < 1) return `No ${RES_INFO[cost.gear].name.toLowerCase()} in the armory`;
    return null;
  }

  /** Pay for and launch a drone. Returns its id, or -1. */
  launch(owner: number, bayId: number, kind: number): number {
    if (this.launchBlocker(owner, bayId, kind)) return -1;
    const s = this.sim.structureById(bayId) as Structure;
    const cost = DRONE_COST[kind];
    const p = this.sim.economy.player(owner);
    p.funds -= cost.funds;
    p.stock[Res.Steel] -= cost.steel;
    if (cost.gear !== undefined) p.stock[cost.gear] -= 1;
    const u = this.sim.units;
    const id = this.sim.spawnUnit(kind, owner, s.tx + s.w / 2, s.tz + s.h / 2, s.rot);
    if (id < 0) return -1;
    u.home[id] = s.id;
    u.elev[id] = u.pelev[id] = 0.5; // lifts off from the pad
    this.sim.emit({ type: 'launched', owner, unit: id, kind });
    return id;
  }

  /** Commit a strike drone to a dive onto the ground point under the ray. */
  diveAlong(i: number, ex: number, ey: number, ez: number, yaw: number, pitch: number): boolean {
    const map = this.sim.map;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = Math.cos(yaw) * cp;
    for (let t = 1; t < 70; t += 0.25) {
      const x = ex + dx * t;
      const y = ey + dy * t;
      const z = ez + dz * t;
      if (!map.inBounds(Math.floor(x), Math.floor(z))) return false;
      if (y <= map.heightAt(x, z) + 0.3) return this.diveTo(i, x, z);
    }
    return false;
  }

  diveTo(i: number, x: number, z: number): boolean {
    const u = this.sim.units;
    if (!UNIT_TYPES[u.kind[i]].blast) return false;
    u.order[i] = Order.Dive;
    u.goalX[i] = x;
    u.goalZ[i] = z;
    return true;
  }

  update(): void {
    const sim = this.sim;
    const u = sim.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const t = UNIT_TYPES[u.kind[i]];
      if (!t.fly) continue;
      const bay = this.bayOf(i);

      // Battery: recharge parked at a powered bay, drain otherwise. Flat = crash.
      const docked =
        bay && u.order[i] === Order.Idle && Math.hypot(u.x[i] - (bay.tx + 1), u.z[i] - (bay.tz + 1)) < DOCK_RANGE;
      if (docked && bay.powered) u.battery[i] = Math.min(t.battery, u.battery[i] + RECHARGE * TICK_SEC);
      else if (!docked) u.battery[i] -= TICK_SEC;
      if (u.battery[i] <= 0) {
        this.crash(i);
        continue;
      }
      // Low battery: head home unless the player is flying it or it's committed to a dive.
      if (bay && u.battery[i] < RETURN_AT && u.order[i] !== Order.Control && u.order[i] !== Order.Dive && !docked) {
        const homeX = bay.tx + 1;
        const homeZ = bay.tz + 1;
        if (u.order[i] !== Order.Move || u.goalX[i] !== homeX || u.goalZ[i] !== homeZ) {
          u.order[i] = Order.Move;
          u.goalX[i] = homeX;
          u.goalZ[i] = homeZ;
          u.target[i] = -1;
          u.targetStruct[i] = -1;
        }
      }

      let height = t.fly;
      switch (u.order[i]) {
        case Order.Control:
          this.glide(i, u.vx[i], u.vz[i]);
          break;
        case Order.Move: {
          const d = this.steer(i, u.goalX[i], u.goalZ[i], t.speed);
          if (d < 0.25) {
            u.order[i] = Order.Idle;
            if (bay && u.goalX[i] === bay.tx + 1 && u.goalZ[i] === bay.tz + 1) height = 0.6;
          }
          break;
        }
        case Order.Follow: {
          const l = u.leader[i];
          if (!u.isAlive(l) || u.owner[l] !== u.owner[i]) {
            u.order[i] = Order.Idle;
            break;
          }
          const d = Math.hypot(u.x[l] - u.x[i], u.z[l] - u.z[i]);
          if (d > 2.5) this.steer(i, u.x[l], u.z[l], t.speed);
          else this.glide(i, 0, 0);
          break;
        }
        case Order.Attack: {
          const j = u.target[i];
          if (!u.isAlive(j) || u.owner[j] === u.owner[i]) {
            u.order[i] = Order.Idle;
            u.target[i] = -1;
            break;
          }
          const d = Math.hypot(u.x[j] - u.x[i], u.z[j] - u.z[i]);
          if (t.blast) {
            // Strike: chase it down and descend for the hit.
            this.steer(i, u.x[j], u.z[j], t.speed * 1.2);
            height = Math.min(t.fly, 0.4 + d * 0.5);
            if (d < STRIKE_REACH && Math.abs(u.elev[i] - u.elev[j]) < 1.5) this.detonate(i);
          } else if (d > 4) {
            this.steer(i, u.x[j], u.z[j], t.speed); // recon: shadow it from above
          } else {
            this.glide(i, 0, 0);
          }
          break;
        }
        case Order.Breach: {
          const s = sim.structureById(u.targetStruct[i]);
          if (!s || s.owner === u.owner[i]) {
            u.order[i] = Order.Idle;
            u.targetStruct[i] = -1;
            break;
          }
          const px = Math.min(Math.max(u.x[i], s.tx + 0.3), s.tx + s.w - 0.3);
          const pz = Math.min(Math.max(u.z[i], s.tz + 0.3), s.tz + s.h - 0.3);
          const d = this.steer(i, px, pz, t.speed * 1.2);
          height = Math.min(t.fly, 1 + d * 0.5);
          if (t.blast && distToRect(u.x[i], u.z[i], s) < STRIKE_REACH) this.detonate(i);
          else if (!t.blast && d < 3) u.order[i] = Order.Idle;
          break;
        }
        case Order.Dive: {
          const d = this.steer(i, u.goalX[i], u.goalZ[i], DIVE_SPEED);
          height = Math.min(u.elev[i], d * 0.55);
          if (d < 0.6 || u.elev[i] < 0.45) this.detonate(i);
          break;
        }
        default:
          this.glide(i, 0, 0);
      }
      if (!u.alive[i]) continue;
      u.elev[i] += (height - u.elev[i]) * (u.order[i] === Order.Dive ? 0.5 : 0.12);
    }
  }

  /** Accelerate toward a point; returns the remaining distance. */
  private steer(i: number, gx: number, gz: number, speed: number): number {
    const u = this.sim.units;
    const dx = gx - u.x[i];
    const dz = gz - u.z[i];
    const d = Math.hypot(dx, dz);
    const s = d > 1e-4 ? (speed * Math.min(1, d / 1.2)) / d : 0;
    this.glide(i, dx * s, dz * s);
    return d;
  }

  /** Ease the velocity toward (vx, vz) and move, ignoring walls (it's in the air). */
  private glide(i: number, vx: number, vz: number): void {
    const u = this.sim.units;
    const map = this.sim.map;
    const k = u.order[i] === Order.Control ? 1 : 0.2;
    u.vx[i] += (vx - u.vx[i]) * k;
    u.vz[i] += (vz - u.vz[i]) * k;
    u.x[i] = Math.min(Math.max(u.x[i] + u.vx[i] * TICK_SEC, 0.5), map.width - 0.5);
    u.z[i] = Math.min(Math.max(u.z[i] + u.vz[i] * TICK_SEC, 0.5), map.height - 0.5);
    if (u.order[i] !== Order.Control && Math.abs(u.vx[i]) + Math.abs(u.vz[i]) > 0.2) {
      u.heading[i] = turnToward(u.heading[i], Math.atan2(u.vx[i], u.vz[i]), 6 * TICK_SEC);
    }
  }

  detonate(i: number): void {
    const sim = this.sim;
    const u = sim.units;
    const b = UNIT_TYPES[u.kind[i]].blast;
    if (!b) return;
    const y = sim.map.heightAt(u.x[i], u.z[i]) + u.elev[i];
    const owner = u.owner[i];
    const x = u.x[i];
    const z = u.z[i];
    this.remove(i);
    sim.combat.blast(x, z, y, owner, b);
  }

  private crash(i: number): void {
    const u = this.sim.units;
    this.sim.emit({ type: 'notice', owner: u.owner[i], text: `${UNIT_TYPES[u.kind[i]].name} ran out of battery and crashed` });
    this.sim.emit({ type: 'explosion', x: u.x[i], z: u.z[i], owner: u.owner[i] });
    this.remove(i);
  }

  private remove(i: number): void {
    this.sim.economy.onUnitRemoved(i);
    this.sim.combat.assault[i] = 0;
    this.sim.units.kill(i);
  }
}
