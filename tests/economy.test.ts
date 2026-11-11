import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { Tile } from '../src/sim/map';
import { createM0Scenario, PLAYER } from '../src/sim/scenario';
import type { Sim } from '../src/sim/sim';
import { Res, STRUCTURE_DEFS, type StructureKind } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';

function runSec(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * TICK_RATE; i++) sim.step();
}

/** First spot (scanning outward from the HQ) where `kind` can be placed. */
function findSpot(sim: Sim, kind: StructureKind, near?: { x: number; z: number }): { tx: number; tz: number } {
  const hq = sim.economy.hqOf(PLAYER)!;
  const cx = near?.x ?? hq.tx + 2;
  const cz = near?.z ?? hq.tz + 2;
  for (let r = 0; r < 40; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const tx = Math.floor(cx + dx);
        const tz = Math.floor(cz + dz);
        if (sim.economy.canPlace(PLAYER, kind, tx, tz).ok) return { tx, tz };
      }
    }
  }
  throw new Error(`no spot for ${kind}`);
}

function civilians(sim: Sim): number {
  let n = 0;
  for (let i = 0; i < sim.units.count; i++) {
    if (sim.units.alive[i] && sim.units.owner[i] === PLAYER && sim.units.kind[i] === UnitKind.Civilian) n++;
  }
  return n;
}

describe('economy: starting state', () => {
  it('has the pre-built core, 8 civilians and starting stock', () => {
    const { sim } = createM0Scenario(1337);
    const kinds = sim.structures.filter((s) => s.owner === PLAYER).map((s) => s.kind);
    for (const k of ['hq', 'hub', 'house', 'depot', 'rations'] as StructureKind[]) expect(kinds).toContain(k);
    expect(civilians(sim)).toBe(8);
    const p = sim.economy.player(PLAYER);
    expect(p.stock[Res.Timber]).toBe(60);
    expect(p.funds).toBe(300);
    sim.economy.recount();
    expect(p.housing).toBe(24); // HQ 8 + 2 houses
    expect(sim.map.trees.length).toBeGreaterThan(50);
  });
});

describe('economy: placement', () => {
  it('rejects blocked ground, enforces requirements and charges the cost', () => {
    const { sim } = createM0Scenario(1337);
    const hq = sim.economy.hqOf(PLAYER)!;
    expect(sim.economy.canPlace(PLAYER, 'house', hq.tx, hq.tz).ok).toBe(false);

    // Orchard needs fertile ground; find a sand tile near the base and check the refusal reason.
    const sand = findSpot(sim, 'house');
    const orchardOnSand = sim.economy.canPlace(PLAYER, 'orchard', sand.tx, sand.tz);
    if (sim.map.tileAt(sand.tx, sand.tz) === Tile.Sand) expect(orchardOnSand.reason).toBe('Needs fertile ground');

    const timber0 = sim.economy.player(PLAYER).stock[Res.Timber];
    sim.enqueue({ type: 'build', owner: PLAYER, kind: 'house', tx: sand.tx, tz: sand.tz });
    sim.step();
    expect(sim.structures.some((s) => s.kind === 'house' && s.tx === sand.tx && s.tz === sand.tz)).toBe(true);
    expect(sim.economy.player(PLAYER).stock[Res.Timber]).toBe(timber0 - STRUCTURE_DEFS.house.cost.timber!);
  });

  it('refuses when you cannot afford it and reports why', () => {
    const { sim } = createM0Scenario(1337);
    const spot = findSpot(sim, 'house');
    sim.economy.player(PLAYER).stock[Res.Timber] = 2;
    expect(sim.economy.canPlace(PLAYER, 'house', spot.tx, spot.tz).reason).toBe('Not enough timber');
    sim.enqueue({ type: 'build', owner: PLAYER, kind: 'house', tx: spot.tx, tz: spot.tz });
    sim.step();
    expect(sim.drainEvents().some((e) => e.type === 'buildFailed')).toBe(true);
  });

  it('quarries must touch rock', () => {
    const { sim } = createM0Scenario(1337);
    const spot = findSpot(sim, 'quarry');
    let rock = 0;
    for (let z = spot.tz - 1; z <= spot.tz + 3; z++) {
      for (let x = spot.tx - 1; x <= spot.tx + 3; x++) if (sim.map.tileAt(x, z) === Tile.Rock) rock++;
    }
    expect(rock).toBeGreaterThanOrEqual(2);
  });

  it('demolish refunds half and frees the tiles', () => {
    const { sim } = createM0Scenario(1337);
    const spot = findSpot(sim, 'depot');
    sim.enqueue({ type: 'build', owner: PLAYER, kind: 'depot', tx: spot.tx, tz: spot.tz });
    sim.step();
    const s = sim.structures.find((st) => st.kind === 'depot' && st.tx === spot.tx)!;
    const timber = sim.economy.player(PLAYER).stock[Res.Timber];
    sim.enqueue({ type: 'demolish', owner: PLAYER, id: s.id });
    sim.step();
    expect(sim.structureById(s.id)).toBeUndefined();
    expect(sim.economy.player(PLAYER).stock[Res.Timber]).toBe(timber + 5);
    expect(sim.map.isWalkableTile(spot.tx, spot.tz)).toBe(true);
  });
});

describe('economy: production chains', () => {
  it('a lumber camp fells trees and hauls timber to storage', () => {
    const { sim } = createM0Scenario(1337);
    const spot = findSpot(sim, 'lumber', { x: 14, z: 78 });
    sim.enqueue({ type: 'build', owner: PLAYER, kind: 'lumber', tx: spot.tx, tz: spot.tz });
    runSec(sim, 1);
    const p = sim.economy.player(PLAYER);
    const t0 = p.stock[Res.Timber];
    const woodBefore = sim.map.trees.reduce((a, t) => a + t.wood, 0);
    runSec(sim, 120);
    expect(p.stock[Res.Timber]).toBeGreaterThanOrEqual(t0 + 6);
    expect(sim.map.trees.reduce((a, t) => a + t.wood, 0)).toBeLessThan(woodBefore);
  });

  it('an orchard on fertile ground delivers produce', () => {
    const { sim } = createM0Scenario(1337);
    const o = sim.map.oases[0];
    const spot = findSpot(sim, 'orchard', { x: o.x, z: o.z });
    sim.enqueue({ type: 'build', owner: PLAYER, kind: 'orchard', tx: spot.tx, tz: spot.tz });
    sim.enqueue({ type: 'setRations', owner: PLAYER, level: 0 }); // don't eat, so we can count deliveries
    runSec(sim, 1);
    const p = sim.economy.player(PLAYER);
    p.morale = 100; // hungry people leave eventually; keep them around for the measurement
    const before = p.stock[Res.Produce];
    let delivered = 0;
    for (let i = 0; i < 120 * TICK_RATE; i++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'delivered' && e.res === Res.Produce) delivered += e.amount;
    }
    expect(delivered).toBeGreaterThanOrEqual(6);
    expect(p.stock[Res.Produce]).toBeCloseTo(before + delivered, 5);
  });

  it('work slows down at night', () => {
    const measure = (phase: 'day' | 'night'): number => {
      const { sim } = createM0Scenario(1337);
      const spot = findSpot(sim, 'ranch');
      sim.enqueue({ type: 'build', owner: PLAYER, kind: 'ranch', tx: spot.tx, tz: spot.tz });
      sim.enqueue({ type: 'setRations', owner: PLAYER, level: 0 });
      sim.skipToPhase(phase);
      let meat = 0;
      for (let i = 0; i < 100 * TICK_RATE; i++) {
        sim.step();
        for (const e of sim.drainEvents()) if (e.type === 'delivered') meat += e.amount;
      }
      return meat;
    };
    expect(measure('day')).toBeGreaterThan(measure('night'));
  });
});

describe('economy: morale & population', () => {
  it('fills free housing when morale is good', () => {
    const { sim } = createM0Scenario(1337);
    sim.enqueue({ type: 'setTax', owner: PLAYER, level: 1 }); // no taxes: +morale
    runSec(sim, 90);
    sim.economy.recount();
    expect(civilians(sim)).toBe(24);
    expect(sim.economy.player(PLAYER).morale).toBeGreaterThan(60);
  });

  it('starvation and high taxes drive people away', () => {
    const { sim } = createM0Scenario(1337);
    const p = sim.economy.player(PLAYER);
    p.stock[Res.Produce] = 0;
    sim.enqueue({ type: 'setTax', owner: PLAYER, level: 5 });
    runSec(sim, 60);
    expect(p.morale).toBeLessThan(50);
    expect(p.factors.find((f) => f.key === 'rations')?.value).toBeLessThan(0);
    runSec(sim, 40);
    expect(civilians(sim)).toBeLessThan(8);
  });

  it('collects taxes and eats rations', () => {
    const { sim } = createM0Scenario(1337);
    const p = sim.economy.player(PLAYER);
    const f0 = p.funds;
    const food0 = p.stock[Res.Produce];
    runSec(sim, 30);
    expect(p.funds).toBeGreaterThan(f0);
    expect(p.stock[Res.Produce]).toBeLessThan(food0);
  });
});
