import type { Sim } from './sim';
import type { Structure } from './structures';
import { Order } from './units';

export interface WaveGroup {
  kind: number;
  n: number;
}

export interface Wave {
  /** Seconds after the match starts. */
  at: number;
  groups: WaveGroup[];
}

/** Spawns attack waves for `owner` and sends them at `target`'s HQ (Hold the Line). */
export class WaveDirector {
  next = 0;
  readonly alive = new Set<number>();

  constructor(
    readonly owner: number,
    readonly target: number,
    readonly waves: Wave[],
    readonly spawn: { x: number; z: number },
  ) {}

  get total(): number {
    return this.waves.length;
  }

  /** All waves spawned and every attacker dead. */
  get done(): boolean {
    return this.next >= this.waves.length && this.alive.size === 0;
  }

  /** Seconds until the next wave, or null if none left. */
  nextIn(sim: Sim): number | null {
    if (this.next >= this.waves.length) return null;
    return Math.max(0, this.waves[this.next].at - sim.elapsed);
  }

  /** Where attackers are headed: the target's HQ entrance. */
  goal(sim: Sim): { x: number; z: number; hq: Structure | undefined } | null {
    const hq = sim.economy.hqOf(this.target);
    if (!hq) return null;
    return { x: hq.doorX, z: hq.doorZ, hq };
  }

  update(sim: Sim): void {
    if (sim.tick % 20 === 0) {
      for (const id of this.alive) if (!sim.units.isAlive(id) || sim.units.owner[id] !== this.owner) this.alive.delete(id);
    }
    if (this.next < this.waves.length && sim.elapsed >= this.waves[this.next].at && !sim.result) this.spawnWave(sim);
  }

  private spawnWave(sim: Sim): void {
    const wave = this.waves[this.next];
    const map = sim.map;
    let k = 0;
    for (const g of wave.groups) {
      for (let n = 0; n < g.n; n++, k++) {
        // Spiral out from the spawn point onto free ground.
        const a = k * 2.399;
        const r = 0.9 * Math.sqrt(k);
        const t = map.nearestOnLayer(
          Math.floor(this.spawn.x + Math.cos(a) * r),
          Math.floor(this.spawn.z + Math.sin(a) * r),
          0,
          this.owner,
          6,
        );
        if (t < 0) continue;
        const x = (t % map.width) + 0.5 + (sim.rng.next() - 0.5) * 0.4;
        const z = Math.floor(t / map.width) + 0.5 + (sim.rng.next() - 0.5) * 0.4;
        const id = sim.spawnUnit(g.kind, this.owner, x, z, -Math.PI / 2);
        if (id < 0) continue;
        sim.combat.wave[id] = 1;
        sim.units.order[id] = Order.Assault;
        sim.units.repath[id] = 0;
        this.alive.add(id);
      }
    }
    this.next++;
    sim.emit({ type: 'wave', owner: this.owner, index: this.next, total: this.waves.length, size: k });
  }
}
