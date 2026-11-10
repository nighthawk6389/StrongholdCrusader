import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import type { Sim } from '../src/sim/sim';
import { Res } from '../src/sim/structures';
import { UNIT_TYPES, UnitKind } from '../src/sim/unitTypes';

function runSec(sim: Sim, sec: number, onEvent?: (e: ReturnType<Sim['drainEvents']>[number]) => void): void {
  for (let i = 0; i < sec * TICK_RATE; i++) {
    sim.step();
    const ev = sim.drainEvents();
    if (onEvent) for (const e of ev) onEvent(e);
  }
}

const count = (sim: Sim, owner: number, kind: string): number =>
  sim.structures.filter((s) => s.owner === owner && s.kind === kind).length;

const soldiers = (sim: Sim, owner: number): number => {
  let n = 0;
  for (let i = 0; i < sim.units.count; i++) {
    if (sim.units.alive[i] && sim.units.owner[i] === owner && UNIT_TYPES[sim.units.kind[i]].armed) n++;
  }
  return n;
};

describe('skirmish AI (Old Sarge)', () => {
  it('builds an economy and starts walling in', { timeout: 30_000 }, () => {
    const { sim } = createScenario('skirmish', 1337, 'normal');
    let failed = 0;
    runSec(sim, 150, (e) => {
      if (e.type === 'buildFailed' && e.owner === ENEMY) failed++;
    });
    expect(count(sim, ENEMY, 'lumber')).toBeGreaterThanOrEqual(1);
    expect(count(sim, ENEMY, 'quarry')).toBeGreaterThanOrEqual(1);
    expect(count(sim, ENEMY, 'orchard') + count(sim, ENEMY, 'ranch')).toBeGreaterThanOrEqual(2);
    expect(count(sim, ENEMY, 'wall')).toBeGreaterThan(10);
    expect(failed).toBeLessThan(5);
  });

  it('recruits, garrisons its wall and attacks a passive player', { timeout: 60_000 }, () => {
    const { sim } = createScenario('skirmish', 1337, 'normal');
    const start = soldiers(sim, ENEMY);
    let assaulted = false;
    let taunts = 0;
    for (let t = 0; t < 560 * TICK_RATE && !assaulted; t++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'taunt') taunts++;
      if (t % TICK_RATE === 0) {
        for (let i = 0; i < sim.units.count; i++) if (sim.units.alive[i] && sim.units.owner[i] === ENEMY && sim.combat.assault[i]) assaulted = true;
      }
    }
    expect(soldiers(sim, ENEMY)).toBeGreaterThan(start);
    expect(assaulted).toBe(true);
    expect(taunts).toBeGreaterThanOrEqual(2); // greeting + attack call
    let onWall = 0;
    for (let i = 0; i < sim.units.count; i++) if (sim.units.alive[i] && sim.units.owner[i] === ENEMY && sim.units.layer[i] === 1) onWall++;
    expect(onWall).toBeGreaterThan(0);
  });

  it('is deterministic', { timeout: 30_000 }, () => {
    const run = (): number => {
      const { sim } = createScenario('skirmish', 4242, 'hard');
      runSec(sim, 200);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});

describe('skirmish rules', () => {
  it('killing the enemy Commander wins', () => {
    const { sim } = createScenario('skirmish', 1337, 'easy');
    const cmd = sim.commanderOf(ENEMY);
    sim.combat.damageUnit(cmd, 1e4, -1);
    runSec(sim, 2);
    expect(sim.result?.result).toBe('victory');
  });

  it('destroying the enemy HQ wins; losing yours loses', () => {
    const a = createScenario('skirmish', 1337, 'easy').sim;
    a.damageStructure(a.economy.hqOf(ENEMY)!, 1e6);
    runSec(a, 2);
    expect(a.result?.result).toBe('victory');
    const b = createScenario('skirmish', 1337, 'easy').sim;
    b.damageStructure(b.economy.hqOf(PLAYER)!, 1e6);
    runSec(b, 2);
    expect(b.result?.result).toBe('defeat');
  });
});

describe('Trade Post', () => {
  it('needs a trade post; buys at full price and sells at half', () => {
    const { sim } = createScenario('sandbox', 1337);
    const p = sim.economy.player(PLAYER);
    expect(sim.economy.trade(PLAYER, Res.Timber, -10)).toBe(0);
    p.stock[Res.Timber] = 100;
    let spot: { tx: number; tz: number } | null = null;
    for (let r = 0; r < 20 && !spot; r++) {
      for (let d = -r; d <= r && !spot; d++) if (sim.economy.canPlace(PLAYER, 'market', 20 + d, 82 + r).ok) spot = { tx: 20 + d, tz: 82 + r };
    }
    sim.enqueue({ type: 'build', owner: PLAYER, kind: 'market', tx: spot!.tx, tz: spot!.tz });
    sim.step();
    const funds = p.funds;
    expect(sim.economy.trade(PLAYER, Res.Timber, -10)).toBe(-10);
    expect(p.funds).toBe(funds + 20);
    expect(sim.economy.trade(PLAYER, Res.Rifle, 1)).toBe(1);
    expect(p.funds).toBe(funds + 20 - 30);
  });
});

describe('unit roster sanity', () => {
  it('every recruitable unit has gear and a cost', () => {
    for (const k of [UnitKind.Rifleman, UnitKind.Gunner, UnitKind.Marksman, UnitKind.Engineer]) {
      expect(UNIT_TYPES[k].gear).not.toBeNull();
      expect(UNIT_TYPES[k].funds).toBeGreaterThan(0);
    }
  });
});
