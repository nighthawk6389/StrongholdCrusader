import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { createM0Scenario, PLAYER } from '../src/sim/scenario';
import type { Sim } from '../src/sim/sim';
import { RES_INFO, type StructureKind } from '../src/sim/structures';

function spot(sim: Sim, kind: StructureKind, near: { x: number; z: number }): { tx: number; tz: number } | null {
  for (let r = 0; r < 30; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const tx = Math.floor(near.x + dx);
        const tz = Math.floor(near.z + dz);
        if (sim.economy.canPlace(PLAYER, kind, tx, tz).ok) return { tx, tz };
      }
    }
  }
  return null;
}

/** Throughput report (daytime, one building each) — a tuning aid, loosely asserted. */
describe('balance report', () => {
  it('measures per-building output per minute', () => {
    const rows: string[] = [];
    const cases: [StructureKind, (sim: Sim) => { x: number; z: number }][] = [
      ['lumber', () => ({ x: 14, z: 78 })],
      ['quarry', (sim) => sim.economy.hqOf(PLAYER)! && { x: 40, z: 60 }],
      ['orchard', (sim) => sim.map.oases[0]],
      ['ranch', () => ({ x: 28, z: 80 })],
    ];
    for (const [kind, near] of cases) {
      const { sim } = createM0Scenario(1337);
      sim.enqueue({ type: 'setRations', owner: PLAYER, level: 0 });
      const p = spot(sim, kind, near(sim));
      expect(p, kind).not.toBeNull();
      sim.enqueue({ type: 'build', owner: PLAYER, kind, tx: p!.tx, tz: p!.tz });
      // Intended play: a store near the producers.
      const storeKind: StructureKind = kind === 'orchard' || kind === 'ranch' ? 'rations' : 'depot';
      const sp = spot(sim, storeKind, { x: p!.tx + 4, z: p!.tz });
      if (sp) sim.enqueue({ type: 'build', owner: PLAYER, kind: storeKind, tx: sp.tx, tz: sp.tz });
      const out = new Map<string, number>();
      for (let i = 0; i < 180 * TICK_RATE; i++) {
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.type === 'delivered') out.set(RES_INFO[e.res].name, (out.get(RES_INFO[e.res].name) ?? 0) + e.amount);
        }
      }
      const [name, amt] = [...out.entries()][0] ?? ['nothing', 0];
      rows.push(`${kind.padEnd(8)} → ${(amt / 3).toFixed(1)} ${name}/min`);
      expect(amt).toBeGreaterThan(0);
    }
    console.log(rows.join('\n'));
  });
});
