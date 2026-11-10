import { it } from 'vitest';

/** Balancing aid: HOLD_REPORT=1 [GARRISON=1] npx vitest run tests/hold-report.test.ts --silent=false */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
import { TICK_RATE } from '../src/sim/clock';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { UNIT_TYPES } from '../src/sim/unitTypes';

it.runIf(!!env.HOLD_REPORT)('Hold the Line simulation report', () => {
  const { sim } = createScenario('hold', 1337);
  // Garrison: move the starting soldiers onto the east wall (where waves arrive).
  const ids: number[] = [];
  for (let i = 0; i < sim.units.count; i++) if (sim.units.alive[i] && sim.units.owner[i] === PLAYER && UNIT_TYPES[sim.units.kind[i]].armed && sim.units.kind[i] !== 1) ids.push(i);
  if (env.GARRISON) sim.enqueue({ type: 'move', owner: PLAYER, ids, x: 40.5, z: 60.5, layer: 1 });
  const lines: string[] = [];
  let destroyed = 0;
  for (let t = 0; t < 1100 * TICK_RATE && !sim.result; t++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'wave') lines.push(`${sim.elapsed.toFixed(0)}s wave ${e.index}/${e.total} (${e.size})`);
      if (e.type === 'structureDestroyed') { destroyed++; lines.push(`${sim.elapsed.toFixed(0)}s destroyed ${e.kind} (owner ${e.owner})`); }
      if (e.type === 'result') lines.push(`${sim.elapsed.toFixed(0)}s RESULT ${e.result}: ${e.reason}`);
    }
    if (t % (60 * TICK_RATE) === 0) {
      let mine = 0, theirs = 0, onWall = 0;
      for (let i = 0; i < sim.units.count; i++) {
        if (!sim.units.alive[i] || !UNIT_TYPES[sim.units.kind[i]].armed) continue;
        if (sim.units.owner[i] === PLAYER) { mine++; if (sim.units.layer[i]) onWall++; }
        if (sim.units.owner[i] === ENEMY && sim.combat.wave[i]) theirs++;
      }
      lines.push(`${sim.elapsed.toFixed(0)}s soldiers ${mine} (on wall ${onWall}) vs attackers ${theirs}, HQ hp ${sim.economy.hqOf(PLAYER)?.hp ?? 0}`);
    }
  }
  console.log(lines.join('\n'));
});
