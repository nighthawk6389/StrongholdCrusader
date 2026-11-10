import { it } from 'vitest';

/** Balancing aid: AI_REPORT=1 [DIFF=easy|normal|hard] npx vitest run tests/ai-report.test.ts --silent=false */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
import { TICK_RATE } from '../src/sim/clock';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { UNIT_TYPES } from '../src/sim/unitTypes';

it.runIf(!!env.AI_REPORT)('AI timeline (passive player)', { timeout: 300_000 }, () => {
  const diff = (env.DIFF ?? 'normal') as 'easy' | 'normal' | 'hard';
  const { sim, ai } = createScenario('skirmish', 1337, diff);
  const lines: string[] = [];
  const t0 = performance.now();
  for (let t = 0; t < 1200 * TICK_RATE && !sim.result; t++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'taunt') lines.push(`${sim.elapsed.toFixed(0)}s TAUNT ${e.text}`);
      if (e.type === 'structureDestroyed') lines.push(`${sim.elapsed.toFixed(0)}s destroyed ${e.kind} (owner ${e.owner})`);
      if (e.type === 'result') lines.push(`${sim.elapsed.toFixed(0)}s RESULT ${e.result}: ${e.reason}`);
      if (e.type === 'buildFailed' && e.owner === ENEMY) lines.push(`${sim.elapsed.toFixed(0)}s AI buildFailed ${e.reason}`);
    }
    if (t % (60 * TICK_RATE) === 0) {
      let mine = 0;
      for (let i = 0; i < sim.units.count; i++) if (sim.units.alive[i] && sim.units.owner[i] === PLAYER && UNIT_TYPES[sim.units.kind[i]].armed) mine++;
      lines.push(`${sim.elapsed.toFixed(0)}s AI ${ai!.summary(sim)} | player soldiers ${mine}`);
    }
  }
  lines.push(`sim ms/tick avg ${((performance.now() - t0) / sim.tick).toFixed(2)}`);
  console.log(lines.join('\n'));
});
