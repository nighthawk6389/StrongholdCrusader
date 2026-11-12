import { describe, expect, it } from 'vitest';
import type { AiCommander } from '../src/sim/ai';
import { TICK_RATE } from '../src/sim/clock';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { loadSim, saveSim, type SimSave } from '../src/sim/save';
import { angleDiff, flankRoute, planBreaches, type SiegeMemory } from '../src/sim/siege';
import type { Sim, SimEvent } from '../src/sim/sim';
import { maxHp, type Structure } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';

function runSec(sim: Sim, sec: number, onEvent?: (e: SimEvent) => void): void {
  for (let i = 0; i < sec * TICK_RATE && !sim.result; i++) {
    sim.step();
    for (const e of sim.drainEvents()) onEvent?.(e);
  }
}

const freshMem = (): SiegeMemory => ({ failures: [], heat: new Float32Array(16 * 16), heatCell: 8 });

/**
 * The player's core walled in with a square ring; the east face (toward the AI) gets gun towers just
 * inside it. Returns the HQ centre and ring radius.
 */
function fortifyPlayer(sim: Sim, R = 13): { cx: number; cz: number; R: number } {
  const hq = sim.economy.hqOf(PLAYER)!;
  const cx = Math.floor(hq.tx + hq.w / 2);
  const cz = Math.floor(hq.tz + hq.h / 2);
  for (let d = -R; d <= R; d++) {
    for (const [x, z] of [
      [cx + d, cz - R],
      [cx + d, cz + R],
      [cx - R, cz + d],
      [cx + R, cz + d],
    ]) {
      if (!sim.structureAt(x, z)) sim.placeStructure('wall', PLAYER, x, z);
    }
  }
  for (const dz of [-8, -3, 2, 7]) {
    const t = sim.placeStructure('guntower', PLAYER, cx + R - 3, cz + dz);
    // A soldier up top: a crewed gun tower fires on its own.
    if (t) {
      const id = sim.spawnUnit(UnitKind.Gunner, PLAYER, t.tx + t.w / 2, t.tz + t.h / 2);
      sim.units.layer[id] = 1;
    }
  }
  return { cx, cz, R };
}

describe('smart sieges', () => {
  it('picks a weak flank over a gun-tower front, even though it is a longer walk', () => {
    const s = createScenario('skirmish', 4242, 'hard', { opponent: 'sarge', map: 'basin' });
    const sim = s.sim;
    const { cx, cz } = fortifyPlayer(sim);
    const aiHq = sim.economy.hqOf(ENEMY)!;
    const home = { x: aiHq.doorX, z: aiHq.doorZ };
    const plans = planBreaches(sim, ENEMY, PLAYER, home, freshMem(), { max: 2, spread: 1.2, noise: 0 });
    expect(plans.length).toBe(2);
    // The AI is to the east (bearing 0 from the player's HQ): neither breach goes through the towers' face.
    const east = Math.atan2(home.z - cz, home.x - cx);
    for (const p of plans) expect(angleDiff(p.angle, east)).toBeGreaterThan(0.8);
    // The staging points are out of reach of the gun towers (range 21).
    for (const p of plans) expect(Math.hypot(p.sx - (cx + 10), p.sz - cz)).toBeGreaterThan(12);
  });

  it('prefers a damaged stretch of wall and avoids a side where it was beaten back', () => {
    const s = createScenario('skirmish', 4242, 'hard', { opponent: 'sarge', map: 'basin' });
    const sim = s.sim;
    const { cx, cz, R } = fortifyPlayer(sim);
    const aiHq = sim.economy.hqOf(ENEMY)!;
    const home = { x: aiHq.doorX, z: aiHq.doorZ };
    // Batter the middle of the north wall.
    const north = sim.structureAt(cx, cz - R) as Structure;
    north.hp = maxHp(north) * 0.1;
    const first = planBreaches(sim, ENEMY, PLAYER, home, freshMem(), { max: 1, spread: 1, noise: 0 })[0];
    expect(Math.abs(first.oz - (cz - R - 0.5))).toBeLessThan(1.5);
    // After a bloody nose up north, it looks elsewhere.
    const mem = freshMem();
    mem.failures.push({ angle: first.angle, at: sim.elapsed });
    const next = planBreaches(sim, ENEMY, PLAYER, home, mem, { max: 1, spread: 1, noise: 0 })[0];
    expect(angleDiff(next.angle, first.angle)).toBeGreaterThan(0.9);
  });

  it('marches round the outside instead of past the front gate', () => {
    const s = createScenario('skirmish', 4242, 'hard', { opponent: 'sarge', map: 'basin' });
    const sim = s.sim;
    const { cx, cz, R } = fortifyPlayer(sim);
    const from = { x: cx + 40, z: cz };
    const to = { x: cx, z: cz - R - 10 };
    const route = flankRoute(sim, ENEMY, PLAYER, from, to);
    expect(route.length).toBeGreaterThan(1);
    // Every waypoint stays well clear of the walls.
    for (const p of route) expect(Math.hypot(p.x - cx, p.z - cz)).toBeGreaterThan(R + 6);
  });

  it('in a real match the first hole is not in the gun-tower wall, and the plan survives a save', { timeout: 120_000 }, () => {
    const s = createScenario('skirmish', 4242, 'hard', { opponent: 'sarge', map: 'basin' });
    const sim = s.sim;
    const ai = s.ai as AiCommander;
    const { cx, R } = fortifyPlayer(sim);
    let firstHole: { x: number; z: number } | null = null;
    let saved = false;
    const watch = (e: SimEvent): void => {
      if (e.type === 'structureDestroyed' && e.owner === PLAYER && e.kind === 'wall' && !firstHole) firstHole = { x: e.x, z: e.z };
    };
    for (let t = 0; t < 1500 && !firstHole && !sim.result; t += 10) {
      runSec(sim, 10, watch);
      // Save and reload mid-siege once: the attack carries on.
      if (!saved && (ai as unknown as { sieges: unknown[] }).sieges.length) {
        saved = true;
        const data = JSON.parse(JSON.stringify(saveSim(sim, 'skirmish', 4242, 'hard', { opponent: 'sarge', map: 'basin' }))) as SimSave;
        const back = loadSim(data);
        expect((back.ai as unknown as { sieges: unknown[] }).sieges.length).toBeGreaterThan(0);
      }
    }
    expect(saved).toBe(true);
    expect(firstHole).not.toBeNull();
    // Not the east face (x = cx + R).
    expect(Math.abs(firstHole!.x - (cx + R + 0.5))).toBeGreaterThan(1.5);
  });
});
