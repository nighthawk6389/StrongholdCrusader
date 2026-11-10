import { describe, expect, it } from 'vitest';
import { createM0Scenario, ENEMY, PLAYER } from '../src/sim/scenario';

describe('perf', () => {
  it('ticks 600 units well inside the 50 ms budget', () => {
    const { sim } = createM0Scenario(5);
    const mine: number[] = [];
    const theirs: number[] = [];
    for (let i = 0; i < 300; i++) {
      mine.push(sim.spawnUnit(0, PLAYER, 40 + (i % 20) * 0.8, 50 + Math.floor(i / 20) * 0.8));
      theirs.push(sim.spawnUnit(0, ENEMY, 80 + (i % 20) * 0.8, 50 + Math.floor(i / 20) * 0.8));
    }
    sim.enqueue({ type: 'move', owner: PLAYER, ids: mine, x: 85, z: 56 });
    sim.enqueue({ type: 'move', owner: ENEMY, ids: theirs, x: 45, z: 56 });
    const t0 = performance.now();
    const ticks = 400;
    for (let i = 0; i < ticks; i++) sim.step();
    const ms = (performance.now() - t0) / ticks;
    console.log(`avg tick: ${ms.toFixed(2)} ms, flow builds: ${sim.flow.builds}`);
    expect(ms).toBeLessThan(25);
  });
});
