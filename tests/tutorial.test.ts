import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { TUTORIAL_STEPS, Tutorial, type TutorialContext } from '../src/game/tutorial';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { UNIT_TYPES, UnitKind } from '../src/sim/unitTypes';

describe('tutorial', () => {
  it('sets up your core, a small squad with engineers, and a quiet walled outpost to take', () => {
    const { sim, ai, mode } = createScenario('tutorial');
    expect(mode).toBe('tutorial');
    expect(ai).toBeNull();
    const mine = (k: number): number => sim.units.kind.filter((x, i) => sim.units.alive[i] && sim.units.owner[i] === PLAYER && x === k).length;
    expect(mine(UnitKind.Engineer)).toBe(2);
    expect(mine(UnitKind.Rifleman)).toBe(6);
    expect(sim.structures.some((s) => s.owner === ENEMY && s.kind === 'gate')).toBe(true);
    expect(sim.commanderOf(ENEMY)).toBeGreaterThanOrEqual(0);
    expect(sim.economy.hqOf(ENEMY)).toBeDefined();
  });

  it('steps complete in order once their condition holds (and can be skipped)', () => {
    const { sim } = createScenario('tutorial');
    const t = new Tutorial();
    const ctx: TutorialContext = {
      sim,
      player: PLAYER,
      cameraMoved: false,
      selectedSoldiers: 0,
      controlling: false,
      moraleOpen: false,
      recruited: 0,
      moved: false,
    };
    expect(t.update(ctx, 0.1)).toBe(false);
    ctx.cameraMoved = true;
    expect(t.update(ctx, 0.1)).toBe(true);
    expect(t.celebrating).toBe(true);
    t.update(ctx, 1.5);
    expect(t.step?.id).toBe('select');
    t.skip();
    expect(t.step?.id).toBe('move');
    for (let k = 0; k < TUTORIAL_STEPS.length; k++) t.skip();
    expect(t.finished).toBe(true);
  });

  it('the outpost can be stormed with the starting squad', { timeout: 60_000 }, () => {
    const { sim } = createScenario('tutorial');
    const ids: number[] = [];
    for (let i = 0; i < sim.units.count; i++) {
      if (sim.units.alive[i] && sim.units.owner[i] === PLAYER && UNIT_TYPES[sim.units.kind[i]].armed && sim.units.kind[i] !== UnitKind.Commander) ids.push(i);
    }
    // Like a player would: storm the gate, then send everyone still standing after their Commander.
    sim.enqueue({ type: 'assault', owner: PLAYER, ids, target: ENEMY });
    for (let t = 0; t < 300 * TICK_RATE && !sim.result; t++) {
      if (t === 60 * TICK_RATE) {
        const live = ids.filter((i) => sim.units.isAlive(i) && sim.units.owner[i] === PLAYER);
        sim.enqueue({ type: 'attack', owner: PLAYER, ids: live, target: sim.commanderOf(ENEMY) });
      }
      sim.step();
      sim.drainEvents();
    }
    expect(sim.result?.result).toBe('victory');
  });
});
