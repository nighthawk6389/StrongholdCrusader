import { describe, expect, it } from 'vitest';
import { AiCommander, OLD_SARGE } from '../src/sim/ai';
import { RATION_LEVELS, TAX_LEVELS } from '../src/sim/economy';
import { TICK_RATE } from '../src/sim/clock';
import { GameMap, Tile } from '../src/sim/map';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim, type Command } from '../src/sim/sim';
import { Res } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';
import { Order } from '../src/sim/units';

function runSec(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * TICK_RATE; i++) {
    sim.step();
    sim.drainEvents();
  }
}

/** Open ground with two HQs and an AI commander for ENEMY. */
function arena(startSec = 100): { sim: Sim; ai: AiCommander } {
  const map = new GameMap(128, 128, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 5, startSec });
  sim.economy.player(PLAYER).active = true;
  sim.economy.player(ENEMY).active = true;
  sim.placeStructure('hq', PLAYER, 26, 62);
  sim.placeStructure('hq', ENEMY, 98, 62);
  const ai = new AiCommander(ENEMY, PLAYER, { x: 100, z: 64 }, OLD_SARGE, 'normal');
  sim.controllers.push(ai);
  return { sim, ai };
}

type Peek = {
  planEconomy(sim: Sim): void;
  attackSide(sim: Sim, ex: number, ez: number): { x: number; z: number } | null;
  shelled: boolean;
  lastTaxChange: number;
};
const peek = (ai: AiCommander): Peek => ai as unknown as Peek;
const queued = (sim: Sim): Command[] => (sim as unknown as { queue: Command[] }).queue;

describe('a smarter AI commander', () => {
  it('runs taxes and rations for income: squeezes high morale, buys it back when it sags', () => {
    const { sim, ai } = createScenario('skirmish', 1337, 'normal');
    runSec(sim, 30);
    const p = sim.economy.player(ENEMY);
    p.stock[Res.Produce] = 400;
    p.population = p.housing; // no room to grow: cash in
    p.morale = 92;
    peek(ai!).lastTaxChange = -1e9;
    queued(sim).length = 0;
    peek(ai!).planEconomy(sim);
    const high = queued(sim).find((c) => c.type === 'setTax') as { level: number } | undefined;
    expect(high?.level ?? p.taxLevel).toBeGreaterThanOrEqual(4);

    // Morale sagging: whatever mix it picks (fewer taxes, or more and better food), morale must climb.
    p.morale = 40;
    peek(ai!).lastTaxChange = -1e9;
    queued(sim).length = 0;
    peek(ai!).planEconomy(sim);
    const tax = (queued(sim).find((c) => c.type === 'setTax') as { level: number } | undefined)?.level ?? p.taxLevel;
    const ration = (queued(sim).find((c) => c.type === 'setRations') as { level: number } | undefined)?.level ?? p.rationLevel;
    const others = p.factors.filter((f) => f.key !== 'rations' && f.key !== 'taxes').reduce((a, f) => a + f.value, 0);
    expect(others + RATION_LEVELS[ration].morale + TAX_LEVELS[tax].morale).toBeGreaterThan(0);
  });

  it('sends special forces at night to blow up the enemy generators', () => {
    const { sim } = arena(400); // night
    const gen = sim.placeStructure('generator', PLAYER, 34, 56)!;
    const ops = [0, 1, 2].map((k) => sim.spawnUnit(UnitKind.Operator, ENEMY, 104.5, 60.5 + k));
    runSec(sim, 3);
    const onIt = ops.filter((i) => sim.units.order[i] === Order.Breach && sim.units.targetStruct[i] === gen.id);
    expect(onIt.length).toBeGreaterThanOrEqual(2);
  });

  it('hunts down an enemy Commander caught out in the open', () => {
    const { sim } = arena(100);
    const cmd = sim.spawnUnit(UnitKind.Commander, PLAYER, 58.5, 64.5);
    const squad = [0, 1, 2, 3].map((k) => sim.spawnUnit(UnitKind.Rifleman, ENEMY, 66.5, 62.5 + k));
    runSec(sim, 2);
    expect(squad.some((i) => sim.units.target[i] === cmd)).toBe(true);
  });

  it('plans to hit the side of a base away from its gun towers', () => {
    const { sim, ai } = arena(100);
    // Player gun towers and walls face east, toward the AI.
    sim.placeStructure('guntower', PLAYER, 38, 58);
    sim.placeStructure('guntower', PLAYER, 38, 68);
    for (let z = 52; z < 78; z++) sim.placeStructure('wall', PLAYER, 41, z);
    const side = peek(ai).attackSide(sim, 28, 64);
    expect(side).not.toBeNull();
    expect(Math.abs(side!.z - 64)).toBeGreaterThan(15); // north or south, not straight in or round the back
    expect(side!.x).toBeGreaterThan(20);
  });

  it('answers incoming artillery with a mortar pit', () => {
    const { sim, ai } = createScenario('skirmish', 1337, 'normal');
    runSec(sim, 20);
    const p = sim.economy.player(ENEMY);
    p.stock[Res.Concrete] = 200;
    p.stock[Res.Steel] = 60;
    p.stock[Res.Timber] = 200;
    ai!.observe(sim, [{ type: 'shell', owner: PLAYER, fromX: 70, fromZ: 64, fromY: 1, toX: 100, toZ: 64, toY: 0, flight: 2 }]);
    expect(peek(ai!).shelled).toBe(true);
    runSec(sim, 15);
    expect(sim.structures.some((s) => s.owner === ENEMY && s.kind === 'mortar')).toBe(true);
  });
});
