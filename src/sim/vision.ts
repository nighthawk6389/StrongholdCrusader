import { TICK_SEC } from './clock';
import type { Sim } from './sim';
import { STRUCTURE_DEFS, type Structure } from './structures';
import { UNIT_TYPES } from './unitTypes';
import { MAX_UNITS } from './units';

/** Ticks between light/detection recomputes (4 Hz). */
const VISION_TICKS = 5;
/** Unsilenced gunfire gives the shooter away for this long, to enemies within NOISE_RANGE. */
export const NOISE_SEC = 3;
const NOISE_RANGE = 30;
export const FLARE_SEC = 30;
export const FLARE_RANGE = 12;
/** Searchlight beam: half-angle and sweep. */
const BEAM_HALF = 0.17;
const SWEEP_AMP = 1.15;
const SWEEP_PERIOD = 10;
/** Floodlight cone half-angle cosine (~50°). */
const FLOOD_COS = 0.64;

export interface Flare {
  x: number;
  z: number;
  owner: number;
  ttl: number;
}

interface Observer {
  x: number;
  z: number;
  sight: number;
  nv: number;
}

interface Sensor {
  x: number;
  z: number;
  range: number;
  dogs: boolean;
}

/**
 * Light and detection. Each side only "sees" enemy units its lookouts can detect: full daylight
 * reveals everything; at night sight shrinks unless the target is lit (floodlights, searchlights,
 * flares, fires) or the observer has night vision. Stealthy units are harder to spot in the dark,
 * gunfire gives shooters away, and sensors/dogs catch what eyes miss.
 */
export class Vision {
  /** Artificial light per tile, 0..1. */
  readonly light: Float32Array;
  /** seen[team][unit] = 1 when `team` currently detects `unit`. */
  readonly seen: Uint8Array[] = [];
  readonly flares: Flare[] = [];
  /** Seconds a unit's position stays given away by its gunfire. */
  readonly reveal = new Float32Array(MAX_UNITS);
  /** Bumped whenever the light grid is recomputed (renderers watch this). */
  lightVersion = 0;
  private timer = 0;

  constructor(private sim: Sim) {
    this.light = new Float32Array(sim.map.width * sim.map.height);
    for (let t = 0; t <= 8; t++) this.seen.push(new Uint8Array(MAX_UNITS));
  }

  /** Is `unit` visible to `team`? (Your own units always are.) */
  isSeen(team: number, unit: number): boolean {
    return this.sim.units.owner[unit] === team || this.seen[team][unit] === 1;
  }

  /** Effective light at a point: daylight or artificial, whichever is brighter. */
  lightAt(x: number, z: number): number {
    const map = this.sim.map;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    const art = map.inBounds(tx, tz) ? this.light[map.idx(tx, tz)] : 0;
    return Math.max(this.sim.cycle.daylight, art);
  }

  /** Current beam heading of a searchlight: where you point it, else a sweep (deterministic from sim time). */
  beamAngle(s: Structure): number {
    if (this.sim.tick < s.manualUntil) return s.aim;
    return s.rot + Math.sin(((this.sim.elapsed + s.id * 1.7) * Math.PI * 2) / SWEEP_PERIOD) * SWEEP_AMP;
  }

  addFlare(x: number, z: number, owner: number): void {
    this.flares.push({ x, z, owner, ttl: FLARE_SEC });
    this.timer = 0; // light it up right away
  }

  update(): void {
    for (let k = this.flares.length - 1; k >= 0; k--) {
      this.flares[k].ttl -= TICK_SEC;
      if (this.flares[k].ttl <= 0) this.flares.splice(k, 1);
    }
    const u = this.sim.units;
    for (let i = 0; i < u.count; i++) if (this.reveal[i] > 0) this.reveal[i] = Math.max(0, this.reveal[i] - TICK_SEC);
    if (this.timer-- > 0) {
      // A searchlight you're aiming by hand: keep its beam on the ground in step with you.
      if (this.sim.structures.some((s) => s.manualUntil > this.sim.tick && STRUCTURE_DEFS[s.kind].light)) this.computeLight();
      return;
    }
    this.timer = VISION_TICKS - 1;
    this.computeLight();
    this.computeDetection();
  }

  // ------------------------------------------------------------------ light

  private computeLight(): void {
    const sim = this.sim;
    const map = sim.map;
    const L = this.light;
    L.fill(0);
    this.lightVersion++;
    if (sim.cycle.daylight >= 0.98) return;
    const w = map.width;
    const put = (tx: number, tz: number, v: number): void => {
      if (tx < 0 || tz < 0 || tx >= w || tz >= map.height) return;
      const i = tz * w + tx;
      if (v > L[i]) L[i] = v;
    };
    const disc = (cx: number, cz: number, r: number, peak: number): void => {
      for (let tz = Math.floor(cz - r); tz <= Math.ceil(cz + r); tz++) {
        for (let tx = Math.floor(cx - r); tx <= Math.ceil(cx + r); tx++) {
          const d = Math.hypot(tx + 0.5 - cx, tz + 0.5 - cz);
          if (d <= r) put(tx, tz, peak * (1 - 0.6 * (d / r) ** 2));
        }
      }
    };
    const cone = (cx: number, cz: number, angle: number, cosHalf: number, r: number, peak: number): void => {
      const fx = Math.sin(angle);
      const fz = Math.cos(angle);
      for (let tz = Math.floor(cz - r); tz <= Math.ceil(cz + r); tz++) {
        for (let tx = Math.floor(cx - r); tx <= Math.ceil(cx + r); tx++) {
          const dx = tx + 0.5 - cx;
          const dz = tz + 0.5 - cz;
          const d = Math.hypot(dx, dz);
          if (d > r) continue;
          if (d < 1.6) {
            put(tx, tz, peak * 0.9);
            continue;
          }
          if ((dx * fx + dz * fz) / d >= cosHalf) put(tx, tz, peak * (1 - 0.45 * (d / r) ** 2));
        }
      }
    };

    for (const s of sim.structures) {
      const def = STRUCTURE_DEFS[s.kind];
      const cx = s.tx + s.w / 2;
      const cz = s.tz + s.h / 2;
      // Burning buildings light their surroundings.
      if (s.hp < def.hp * 0.35 && s.kind !== 'wall' && !def.trap) disc(cx, cz, 4, 0.7);
      // Burning fuel trenches light up the night.
      if (s.burn > 0) disc(cx, cz, 3.5, 0.85);
      if (!def.light || !s.powered) continue;
      if (def.light.kind === 'area') disc(cx, cz, def.light.range, 0.75);
      else if (def.light.kind === 'flood') cone(cx, cz, s.rot, FLOOD_COS, def.light.range, 1);
      else cone(cx, cz, this.beamAngle(s), Math.cos(BEAM_HALF), def.light.range, 1);
    }
    for (const f of this.flares) disc(f.x, f.z, FLARE_RANGE, Math.min(1, f.ttl / 4));
  }

  // ------------------------------------------------------------------ detection

  private computeDetection(): void {
    const sim = this.sim;
    const u = sim.units;
    const daylight = sim.cycle.daylight;
    // In broad daylight lookouts see across the whole map (as in classic castle RTS);
    // the night rules fade in through dusk.
    const dayBoost = 1 + 5 * smoothstep(0.55, 1, daylight);

    const teams = new Set<number>();
    for (let i = 0; i < u.count; i++) if (u.alive[i]) teams.add(u.owner[i]);
    for (const s of sim.structures) teams.add(s.owner);

    for (const team of teams) {
      const seen = this.seen[team];
      seen.fill(0);
      const observers: Observer[] = [];
      const sensors: Sensor[] = [];
      for (let i = 0; i < u.count; i++) {
        if (!u.alive[i] || u.owner[i] !== team) continue;
        const t = UNIT_TYPES[u.kind[i]];
        observers.push({ x: u.x[i], z: u.z[i], sight: t.sight * (1 + 0.12 * Math.min(u.elev[i], 3)), nv: t.nightVision });
      }
      for (const s of sim.structures) {
        if (s.owner !== team) continue;
        const def = STRUCTURE_DEFS[s.kind];
        const cx = s.tx + s.w / 2;
        const cz = s.tz + s.h / 2;
        if (def.sight) observers.push({ x: cx, z: cz, sight: def.sight, nv: 0.35 });
        if (def.sensor && (s.powered || def.sensor.kind === 'dogs')) {
          sensors.push({ x: cx, z: cz, range: def.sensor.range, dogs: def.sensor.kind === 'dogs' });
        }
      }

      for (let j = 0; j < u.count; j++) {
        if (!u.alive[j] || u.owner[j] === team) continue;
        const x = u.x[j];
        const z = u.z[j];
        const lit = this.lightAt(x, z);
        const dark = 1 - lit;
        const t = UNIT_TYPES[u.kind[j]];
        const moving = Math.abs(x - u.px[j]) + Math.abs(z - u.pz[j]) > 0.004;
        // Stealth only works in the dark, and stealthy units are harder still to spot when lying still.
        const hide = t.stealth < 1 ? t.stealth * (moving ? 1 : 0.7) : 1;
        const stealth = 1 - (1 - hide) * dark;
        let found = false;
        if (this.reveal[j] > 0) {
          for (const o of observers) {
            if (Math.hypot(o.x - x, o.z - z) <= NOISE_RANGE) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          for (const o of observers) {
            const range = o.sight * (lit + dark * o.nv) * stealth * dayBoost;
            if (Math.abs(o.x - x) <= range && Math.abs(o.z - z) <= range && Math.hypot(o.x - x, o.z - z) <= range) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          for (const s of sensors) {
            if ((s.dogs || moving) && Math.hypot(s.x - x, s.z - z) <= s.range) {
              found = true;
              break;
            }
          }
        }
        if (found) seen[j] = 1;
      }
    }
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
