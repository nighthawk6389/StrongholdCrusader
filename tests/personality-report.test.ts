import { it } from 'vitest';

/**
 * Balancing aid: how fast does each AI opponent beat a passive player, and does it play to type?
 * PERSONALITY_REPORT=1 [DIFF=normal] [WHO=jackal,warden] [MAPS=basin,pass] npx vitest run tests/personality-report.test.ts --silent=false
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
import { AiCommander, OPPONENTS, PERSONALITIES, type Difficulty, type OpponentKey } from '../src/sim/ai';
import { TICK_RATE } from '../src/sim/clock';
import { MAP_KEYS, type MapKey } from '../src/sim/maps';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { STRUCTURE_DEFS } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';

it.runIf(!!env.PERSONALITY_REPORT)('personality report (passive player)', { timeout: 3_600_000 }, () => {
  const diff = (env.DIFF ?? 'normal') as Difficulty;
  const who = (env.WHO?.split(',') ?? OPPONENTS) as OpponentKey[];
  const maps = (env.MAPS?.split(',') ?? MAP_KEYS) as MapKey[];
  const rows: string[] = [];
  for (const opponent of who) {
    for (const map of maps) {
      const { sim, ai, playerBase } = createScenario('skirmish', Number(env.SEED ?? 1337), diff, { opponent, map });
      // VS=sarge: an AI plays your side too (a stand-in for a real defender).
      if (env.VS) sim.controllers.push(new AiCommander(PLAYER, ENEMY, playerBase, PERSONALITIES[env.VS as OpponentKey], (env.VSDIFF ?? 'normal') as Difficulty, 11, 'east'));
      let firstAssault = -1;
      let hired = 0;
      let ramps = 0;
      const lost = { [PLAYER]: 0, [ENEMY]: 0 };
      const killed = { [PLAYER]: 0, [ENEMY]: 0 };
      for (let t = 0; t < 1200 * TICK_RATE && !sim.result; t++) {
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.type === 'hired' && e.owner === ENEMY) hired++;
          if (e.type === 'ramp' && e.owner === ENEMY) ramps++;
          if (e.type === 'structureDestroyed' && (e.owner === PLAYER || e.owner === ENEMY)) lost[e.owner]++;
          if (e.type === 'death' && (e.owner === PLAYER || e.owner === ENEMY) && e.kind !== UnitKind.Civilian) killed[e.owner]++;
        }
        if (firstAssault < 0 && t % TICK_RATE === 0) {
          for (let i = 0; i < sim.units.count; i++) {
            if (sim.units.alive[i] && sim.units.owner[i] === ENEMY && sim.combat.assault[i]) firstAssault = Math.round(sim.elapsed);
          }
        }
      }
      const n = (k: string): number => sim.structures.filter((s) => s.owner === ENEMY && s.kind === k).length;
      const v = (k: number): number => sim.units.kind.filter((x, i) => sim.units.alive[i] && sim.units.owner[i] === ENEMY && x === k).length;
      const hq = (o: number): string => {
        const h = sim.economy.hqOf(o);
        return h ? `${Math.round((100 * h.hp) / STRUCTURE_DEFS.hq.hp)}%` : 'gone';
      };
      rows.push(
        `${opponent.padEnd(9)} ${map.padEnd(10)} ${sim.result ? `${sim.result.result} @${Math.round(sim.elapsed)}s` : 'no result'} ` +
          `| you: lost ${lost[PLAYER]} bldg ${killed[PLAYER]} troops, HQ ${hq(PLAYER)} | AI: lost ${lost[ENEMY]} bldg ${killed[ENEMY]} troops, HQ ${hq(ENEMY)} | ` +
          `firstAssault ${firstAssault}s raids ${ai!.raidsLaunched} hires ${hired} ramps ${ramps} ` +
          `guntowers ${n('guntower')} searchlights ${n('searchlight')} mines ${n('mines')} ditch ${n('ditch')} wire ${n('wire')} trench ${n('trench')} ` +
          `cars ${v(UnitKind.ArmoredCar)} tanks ${v(UnitKind.Tank)} howitzers ${v(UnitKind.Howitzer)} breachers ${v(UnitKind.Breacher)}`,
      );
      console.log(rows[rows.length - 1]);
    }
  }
  console.log(`\n=== ${diff}\n${rows.join('\n')}`);
});
