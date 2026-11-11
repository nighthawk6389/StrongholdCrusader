import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { createScenario, PLAYER, type GameMode } from '../src/sim/scenario';
import { loadSim, packBytes, saveSim, unpackBytes, type SimSave } from '../src/sim/save';
import type { Sim } from '../src/sim/sim';
import type { Difficulty } from '../src/sim/ai';
import { Res } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';

function runSec(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * TICK_RATE; i++) {
    sim.step();
    sim.drainEvents();
  }
}

/** Save → JSON (as stored) → load. */
function roundTrip(sim: Sim, mode: GameMode, seed: number, diff: Difficulty): Sim {
  const json = JSON.stringify(saveSim(sim, mode, seed, diff));
  return loadSim(JSON.parse(json) as SimSave).sim;
}

describe('save games', () => {
  it('packs typed-array bytes losslessly, collapsing zero runs', () => {
    const a = new Uint8Array(5000);
    for (let i = 0; i < a.length; i += 97) a[i] = (i * 7) & 255;
    a.set([0, 0, 1, 0, 0, 0, 0, 2, 0], 100);
    const s = packBytes(a);
    expect(unpackBytes(s, a.length)).toEqual(a);
    expect(s.length).toBeLessThan(1200);
    const f = new Float32Array([1.5, -2, 0, 0, 0, Infinity, 3e-9]);
    const back = new Float32Array(unpackBytes(packBytes(new Uint8Array(f.buffer)), f.byteLength).buffer);
    expect([...back]).toEqual([...f]);
  });

  it('a reloaded skirmish carries on exactly as the original (AI, economy, combat)', { timeout: 120_000 }, () => {
    const { sim } = createScenario('skirmish', 1337, 'normal');
    runSec(sim, 200);
    const copy = roundTrip(sim, 'skirmish', 1337, 'normal');
    expect(copy.hash()).toBe(sim.hash());
    runSec(sim, 260);
    runSec(copy, 260);
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.structures.length).toBe(sim.structures.length);
  });

  it('a reloaded Hold the Line keeps its waves going', { timeout: 60_000 }, () => {
    const { sim } = createScenario('hold', 1337);
    runSec(sim, 170); // wave 1 is on its way
    const copy = roundTrip(sim, 'hold', 1337, 'normal');
    expect(copy.director?.next).toBe(sim.director?.next);
    expect(copy.director?.alive.size).toBe(sim.director?.alive.size);
    runSec(sim, 120);
    runSec(copy, 120);
    expect(copy.hash()).toBe(sim.hash());
  });

  it('keeps drones, gun towers, flares and night state', { timeout: 60_000 }, () => {
    const { sim } = createScenario('sandbox', 7);
    const p = sim.economy.player(PLAYER);
    p.funds = 900;
    p.stock[Res.Steel] = 60;
    p.stock[Res.Charges] = 3;
    const bay = sim.placeStructure('dronebay', PLAYER, 20, 70)!;
    sim.placeStructure('guntower', PLAYER, 38, 60);
    sim.economy.allocatePower();
    sim.skipToPhase('night');
    sim.drones.launch(PLAYER, bay.id, UnitKind.ReconDrone);
    sim.enqueue({ type: 'flare', owner: PLAYER, x: 40, z: 64 });
    runSec(sim, 5);
    const copy = roundTrip(sim, 'sandbox', 7, 'normal');
    expect(copy.vision.flares.length).toBe(sim.vision.flares.length);
    expect(copy.cycle.daylight).toBe(sim.cycle.daylight);
    runSec(sim, 30);
    runSec(copy, 30);
    expect(copy.hash()).toBe(sim.hash());
  });

  it('is compact enough for browser storage', { timeout: 60_000 }, () => {
    const { sim } = createScenario('skirmish', 1337, 'hard');
    runSec(sim, 300);
    const json = JSON.stringify(saveSim(sim, 'skirmish', 1337, 'hard'));
    expect(json.length).toBeLessThan(1_500_000);
    console.log(`save size ${(json.length / 1024).toFixed(0)} KB`);
  });
});
