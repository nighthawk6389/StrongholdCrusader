import { describe, expect, it } from 'vitest';
import { OPPONENTS, PERSONALITIES, type AiCommander } from '../src/sim/ai';
import { TICK_RATE } from '../src/sim/clock';
import { createScenario, ENEMY, PLAYER, type MatchOptions } from '../src/sim/scenario';
import { loadSim, saveSim, type SimSave } from '../src/sim/save';
import type { Sim, SimEvent } from '../src/sim/sim';
import { UnitKind } from '../src/sim/unitTypes';
import { maxHp } from '../src/sim/structures';

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

  it('every opponent has signature catchphrases', () => {
    for (const key of OPPONENTS) expect(PERSONALITIES[key].lines.catchphrase?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('Duchess Varga names her first tank Rosie, mourns her and rolls out Rosie the Second', { timeout: 90_000 }, () => {
    const { sim, ai } = match({ opponent: 'varga' });
    const lines: string[] = [];
    const said = (e: SimEvent): void => {
      if (e.type === 'taunt' && e.owner === ENEMY) lines.push(e.text);
    };
    // The player does nothing, so keep their HQ standing long enough for the motor pool to deliver.
    const hold = (): void => {
      const hq = sim.economy.hqOf(PLAYER);
      if (hq) hq.hp = maxHp(hq);
    };
    for (let t = 0; t < 900 && ai.namedTankId < 0; t += 10) {
      hold();
      runSec(sim, 10, said);
    }
    expect(ai.namedTankId).toBeGreaterThanOrEqual(0);
    expect(sim.units.kind[ai.namedTankId]).toBe(UnitKind.Tank);
    expect(lines.some((l) => l.includes('Rosie'))).toBe(true);

    lines.length = 0;
    sim.combat.damageUnit(ai.namedTankId, 1e6, -1, true);
    runSec(sim, 2, said);
    expect(ai.namedTankId).toBe(-1);
    expect(lines.some((l) => /Rosie/.test(l))).toBe(true);

    lines.length = 0;
    for (let t = 0; t < 900 && ai.namedTankId < 0 && !sim.result; t += 10) {
      hold();
      runSec(sim, 10, said);
    }
    expect(ai.namedTankGen).toBe(2);
    expect(lines.some((l) => l.includes('Rosie the Second'))).toBe(true);
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

  it('Duchess Varga rolls out armor early: tanks, then a Breacher', { timeout: 60_000 }, () => {
    const { sim } = match({ opponent: 'varga' });
    runSec(sim, 450);
    const armor = sim.units.kind.filter((k, i) => sim.units.alive[i] && sim.units.owner[i] === ENEMY && (k === UnitKind.Tank || k === UnitKind.Breacher));
    expect(armor.length).toBeGreaterThanOrEqual(1);
    expect(count(sim, ENEMY, ['motorpool'])).toBe(1);
  });

  it('Nightshade holds its main attack for darkness and sends special forces after your power', { timeout: 60_000 }, () => {
    const { sim } = match({ opponent: 'nightshade' });
    const hq = sim.economy.hqOf(PLAYER)!;
    hq.hp = 1e9; // keep the match going
    sim.units.hp[sim.commanderOf(PLAYER)] = 1e9;
    let dayAssault = false;
    let opsSent = false;
    const gens = new Set(sim.structures.filter((s) => s.owner === PLAYER && s.kind === 'generator').map((s) => s.id));
    for (let t = 0; t < 640 * 20; t++) {
      sim.step();
      sim.drainEvents();
      if (t % 20) continue;
      const u = sim.units;
      for (let i = 0; i < u.count; i++) {
        if (!u.alive[i] || u.owner[i] !== ENEMY) continue;
        if (sim.combat.assault[i] && sim.cycle.daylight > 0.6 && sim.elapsed < 300) dayAssault = true;
        if (u.kind[i] === UnitKind.Operator && gens.has(u.targetStruct[i])) opsSent = true;
      }
    }
    expect(dayAssault).toBe(false);
    expect(opsSent).toBe(true);
  });

  it('The Quartermaster raises a second ring of walls', { timeout: 90_000 }, () => {
    const { sim } = match({ opponent: 'quartermaster' });
    sim.economy.hqOf(PLAYER)!.hp = 1e9;
    sim.units.hp[sim.commanderOf(PLAYER)] = 1e9;
    runSec(sim, 900);
    const outer = sim.structures.filter(
      (s) => s.owner === ENEMY && s.kind === 'wall' && Math.max(Math.abs(s.tx - 100), Math.abs(s.tz - 64)) === 15,
    ).length;
    expect(outer).toBeGreaterThan(20);
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
