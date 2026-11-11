import { describe, expect, it } from 'vitest';
import { OPPONENTS, PERSONALITIES, type AiCommander } from '../src/sim/ai';
import { TICK_RATE } from '../src/sim/clock';
import { createScenario, ENEMY, PLAYER, type MatchOptions } from '../src/sim/scenario';
import { loadSim, saveSim, type SimSave } from '../src/sim/save';
import type { Sim, SimEvent } from '../src/sim/sim';
import { UnitKind } from '../src/sim/unitTypes';

function runSec(sim: Sim, sec: number, onEvent?: (e: SimEvent) => void): void {
  for (let i = 0; i < sec * TICK_RATE && !sim.result; i++) {
    sim.step();
    for (const e of sim.drainEvents()) onEvent?.(e);
  }
}

function match(opts: MatchOptions, seed = 1337): { sim: Sim; ai: AiCommander } {
  const s = createScenario('skirmish', seed, 'normal', opts);
  return { sim: s.sim, ai: s.ai! };
}

const count = (sim: Sim, owner: number, kinds: string[]): number =>
  sim.structures.filter((s) => s.owner === owner && kinds.includes(s.kind)).length;

describe('AI personalities', () => {
  it('every opponent has a name, a style, lines for every occasion and a build order', () => {
    for (const key of OPPONENTS) {
      const p = PERSONALITIES[key];
      expect(p.key).toBe(key);
      expect(p.title.length).toBeGreaterThan(2);
      for (const lines of [p.lines.start, p.lines.attack, p.lines.lostBuilding, p.lines.hqHit, p.lines.attackFailed, p.lines.win, p.lines.lose]) {
        expect(lines.length).toBeGreaterThan(0);
      }
      expect(p.build.length).toBeGreaterThan(10);
    }
  });

  it('Jackal raids your work sites early', { timeout: 60_000 }, () => {
    const { sim, ai } = match({ opponent: 'jackal' });
    let hit = 0;
    runSec(sim, 300, (e) => {
      if (e.type === 'structureDamaged' && sim.structureById(e.id)?.owner === PLAYER) hit++;
    });
    expect(ai.raidsLaunched).toBeGreaterThanOrEqual(1);
    expect(hit).toBeGreaterThan(0);
  });

  it('The Engineer digs in: wire, mines, ditches and fuel trenches outside his front wall', { timeout: 60_000 }, () => {
    const { sim } = match({ opponent: 'engineer' });
    runSec(sim, 420);
    const works = count(sim, ENEMY, ['wire', 'ditch', 'trench', 'mines']);
    expect(works).toBeGreaterThan(30);
    // All of it in front of (west of) his front wall at x = 89.
    for (const s of sim.structures) if (s.owner === ENEMY && ['wire', 'ditch', 'trench', 'mines'].includes(s.kind)) expect(s.tx).toBeLessThan(89);
  });

  it('The Engineer sets a fuel trench alight under an enemy squad', { timeout: 60_000 }, () => {
    const { sim } = match({ opponent: 'engineer' });
    runSec(sim, 420);
    const trench = sim.structures.find((s) => s.owner === ENEMY && s.kind === 'trench');
    expect(trench).toBeDefined();
    let lit = false;
    for (let k = 0; k < 3; k++) {
      const id = sim.spawnUnit(UnitKind.Rifleman, PLAYER, trench!.tx + 0.5, trench!.tz + 0.5 + k * 0.4);
      sim.units.hp[id] = 1e5;
    }
    runSec(sim, 8, (e) => {
      if (e.type === 'ignited') lit = true;
    });
    expect(lit).toBe(true);
  });

  it('Warden raises gun towers on more than one wall and extra searchlights', { timeout: 60_000 }, () => {
    const { sim } = match({ opponent: 'warden' });
    runSec(sim, 560);
    const guns = sim.structures.filter((s) => s.owner === ENEMY && s.kind === 'guntower');
    expect(guns.length).toBeGreaterThanOrEqual(2);
    expect(count(sim, ENEMY, ['searchlight'])).toBeGreaterThanOrEqual(2);
    expect(sim.units.kind.filter((_, i) => sim.units.alive[i] && sim.units.owner[i] === ENEMY && sim.units.layer[i] === 1).length).toBeGreaterThanOrEqual(8);
  });

  it('The Broker opens a Contracts Office and hires PMC teams', { timeout: 60_000 }, () => {
    const { sim, ai } = match({ opponent: 'broker' });
    let hired = 0;
    runSec(sim, 470, (e) => {
      if (e.type === 'hired' && e.owner === ENEMY) hired++;
    });
    expect(count(sim, ENEMY, ['contracts'])).toBe(1);
    expect(hired).toBeGreaterThanOrEqual(1);
    expect(ai.hires).toBe(hired);
  });

  it('a personality match saves and reloads exactly (raids in flight)', { timeout: 60_000 }, () => {
    const { sim } = match({ opponent: 'jackal', map: 'dunes' });
    runSec(sim, 200);
    const json = JSON.stringify(saveSim(sim, 'skirmish', 1337, 'normal', { opponent: 'jackal', map: 'dunes' }));
    const copy = loadSim(JSON.parse(json) as SimSave).sim;
    expect(copy.hash()).toBe(sim.hash());
    runSec(sim, 60);
    runSec(copy, 60);
    expect(copy.hash()).toBe(sim.hash());
  });
});
