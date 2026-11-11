import { TICK_SEC } from './clock';
import type { Sim } from './sim';
import { STRUCTURE_DEFS, type Structure } from './structures';
import { UNIT_TYPES, UnitKind } from './unitTypes';

/** Mine warhead: kills infantry outright, wrecks light vehicles, badly hurts tanks. */
const MINE_BLAST = { damage: 180, radius: 1.5, structDamage: 0 };
/** Spotting range for engineers looking for mines (and the dogs' nose). */
const SWEEP_RANGE = 3.5;
/** Engineers defuse spotted mines within this distance... */
const DEFUSE_RANGE = 2.2;
/** ...taking this long. */
const DEFUSE_SEC = 2.5;
const BURN_SEC = 12;
/** Damage per second to anyone standing in burning fuel (armor helps a lot). */
const BURN_DPS = 34;
/** Fire creeps to the next stretch of trench after this long. */
const SPREAD_SEC = 0.3;
/** Speed multiplier for enemy infantry on razor wire. */
export const WIRE_SLOW = 0.35;

/**
 * Ground traps and obstacles: minefields (hidden until spotted; go off under the first enemy),
 * anti-tank ditches (handled as blocked tiles; engineers fill them, see Combat), fuel trenches
 * (lit by a flare, an explosion or on command; burn whoever stands in them and spread along the
 * trench) and razor wire (slows enemy infantry; vehicles flatten it).
 */
export class Traps {
  constructor(private sim: Sim) {}

  /** Is there an enemy wire tile under this unit? */
  onEnemyWire(i: number): boolean {
    const u = this.sim.units;
    const s = this.sim.structureAt(Math.floor(u.x[i]), Math.floor(u.z[i]));
    return !!s && s.kind === 'wire' && s.owner !== u.owner[i] && u.layer[i] === 0 && !UNIT_TYPES[u.kind[i]].vehicle;
  }

  /** Does `team` know about this minefield? (Its owner always does.) */
  knows(team: number, s: Structure): boolean {
    return s.owner === team || (s.seenBy & (1 << team)) !== 0;
  }

  /** Set a fuel trench alight (and with it, the rest of that trench in time). */
  ignite(s: Structure): void {
    if (s.kind !== 'trench' || s.burn > 0) return;
    s.burn = BURN_SEC;
    this.sim.emit({ type: 'ignited', id: s.id, x: s.tx + 0.5, z: s.tz + 0.5 });
  }

  /** Flares, explosions and shells light any fuel trench they land near. */
  igniteNear(x: number, z: number, r: number): void {
    for (const s of this.sim.structures) {
      if (s.kind === 'trench' && s.burn === 0 && Math.hypot(s.tx + 0.5 - x, s.tz + 0.5 - z) <= r + 0.5) this.ignite(s);
    }
  }

  update(): void {
    const sim = this.sim;
    const u = sim.units;
    const spot = (sim.tick & 3) === 0; // spotting 5×/s is plenty
    for (const s of [...sim.structures]) {
      const def = STRUCTURE_DEFS[s.kind];
      if (!def.trap) continue;
      if (def.trap === 'mine') this.mine(s, spot);
      else if (def.trap === 'trench') this.trench(s);
      else if (def.trap === 'wire') {
        // Vehicles roll right over wire and flatten it.
        for (let i = 0; i < u.count; i++) {
          if (!u.alive[i] || !UNIT_TYPES[u.kind[i]].vehicle || u.owner[i] === s.owner) continue;
          if (Math.floor(u.x[i]) === s.tx && Math.floor(u.z[i]) === s.tz) {
            sim.damageStructure(s, s.hp + 1);
            break;
          }
        }
      }
    }
  }

  private mine(s: Structure, spot: boolean): void {
    const sim = this.sim;
    const u = sim.units;
    const cx = s.tx + 0.5;
    const cz = s.tz + 0.5;
    let defusing = false;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] === s.owner || u.layer[i] !== 0) continue;
      const t = UNIT_TYPES[u.kind[i]];
      if (t.fly) continue;
      const dx = Math.abs(u.x[i] - cx);
      const dz = Math.abs(u.z[i] - cz);
      // Stepped on it.
      if (dx < 0.5 && dz < 0.5) {
        this.detonate(s);
        return;
      }
      if (u.kind[i] !== UnitKind.Engineer) continue;
      const d = Math.hypot(dx, dz);
      if (spot && d < SWEEP_RANGE) s.seenBy |= 1 << u.owner[i];
      if (d < DEFUSE_RANGE && (s.seenBy & (1 << u.owner[i])) !== 0) defusing = true;
    }
    // Dogs smell explosives.
    if (spot) {
      for (const k of sim.structures) {
        if (k.kind !== 'kennel' || k.owner === s.owner) continue;
        const r = STRUCTURE_DEFS.kennel.sensor?.range ?? 8;
        if (Math.hypot(k.tx + 1 - cx, k.tz + 1 - cz) < r) s.seenBy |= 1 << k.owner;
      }
    }
    if (defusing) {
      s.defuse += TICK_SEC;
      if (s.defuse >= DEFUSE_SEC) {
        sim.emit({ type: 'notice', owner: s.owner, text: 'The enemy is clearing your mines' });
        sim.damageStructure(s, s.hp + 1);
      }
    } else if (s.defuse > 0) {
      s.defuse = Math.max(0, s.defuse - TICK_SEC);
    }
  }

  private detonate(s: Structure): void {
    const sim = this.sim;
    const x = s.tx + 0.5;
    const z = s.tz + 0.5;
    sim.removeStructure(s);
    sim.combat.blast(x, z, sim.map.heightAt(x, z), s.owner, MINE_BLAST);
    // Anti-tank charge: whatever vehicle set it off takes the full force.
    const u = sim.units;
    for (let i = 0; i < u.count; i++) {
      if (u.alive[i] && u.owner[i] !== s.owner && UNIT_TYPES[u.kind[i]].vehicle && Math.hypot(u.x[i] - x, u.z[i] - z) < 1.1) {
        sim.combat.damageUnit(i, 420, -1, true);
      }
    }
  }

  private trench(s: Structure): void {
    if (s.burn <= 0) return;
    const sim = this.sim;
    const u = sim.units;
    const before = s.burn;
    s.burn -= TICK_SEC;
    // Spread along the trench.
    if (before > BURN_SEC - SPREAD_SEC && s.burn <= BURN_SEC - SPREAD_SEC) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const n = sim.structureAt(s.tx + dx, s.tz + dz);
        if (n && n.kind === 'trench' && n.burn === 0) this.ignite(n);
      }
    }
    // Burn whoever is standing in it (friend or foe: fire doesn't care).
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.layer[i] !== 0 || UNIT_TYPES[u.kind[i]].fly) continue;
      if (Math.floor(u.x[i]) !== s.tx || Math.floor(u.z[i]) !== s.tz) continue;
      sim.combat.damageUnit(i, BURN_DPS * TICK_SEC, -1);
    }
    if (s.burn <= 0) {
      s.burn = 0;
      sim.removeStructure(s); // the fuel is spent
    }
  }
}
