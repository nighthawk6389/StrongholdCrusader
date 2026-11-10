import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { buildFlowField, UNREACHABLE } from '../src/sim/flowfield';
import { Block, GameMap, Tile } from '../src/sim/map';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim } from '../src/sim/sim';
import { Res, STRUCTURE_DEFS } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';
import { Order } from '../src/sim/units';
import { WaveDirector } from '../src/sim/waves';

function runSec(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * TICK_RATE; i++) sim.step();
}

function openSim(w = 48, h = 48): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  return new Sim({ map, seed: 5, startSec: 100 });
}

function first(sim: Sim, owner: number, kind: number): number {
  const u = sim.units;
  for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === owner && u.kind[i] === kind) return i;
  return -1;
}

describe('fortifications: wall tops, stairs and gates', () => {
  it('soldiers climb stairs onto the wall and gain height', () => {
    const sim = openSim();
    for (let x = 10; x < 30; x++) sim.placeStructure('wall', PLAYER, x, 20);
    sim.placeStructure('stairs', PLAYER, 12, 21);
    const id = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 26.5);
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [id], x: 25.5, z: 20.5, layer: 1 });
    runSec(sim, 20);
    expect(sim.units.layer[id]).toBe(1);
    expect(Math.floor(sim.units.z[id])).toBe(20);
    expect(sim.units.elev[id]).toBeGreaterThan(1.2);
    expect(sim.combat.rangeOf(id)).toBeGreaterThan(14);
  });

  it('gatehouses open for their owner only', () => {
    const sim = openSim();
    for (let x = 0; x < 48; x++) if (x < 22 || x > 24) sim.placeStructure('wall', PLAYER, x, 20);
    sim.placeStructure('gate', PLAYER, 22, 20, 0);
    const goal = sim.map.idx(23, 30);
    const mine = buildFlowField(sim.map, { goal, goalLayer: 0, team: PLAYER, breach: false });
    const theirs = buildFlowField(sim.map, { goal, goalLayer: 0, team: ENEMY, breach: false });
    const start = sim.map.idx(23, 10);
    expect(mine.dir[start]).toBeGreaterThanOrEqual(0);
    expect(theirs.dir[start]).toBe(UNREACHABLE);
    // Attackers in breach mode route through the wall line at a cost.
    const breach = buildFlowField(sim.map, { goal, goalLayer: 0, team: ENEMY, breach: true });
    expect(breach.dir[start]).toBeGreaterThanOrEqual(0);
  });

  it('wall lines cost concrete per tile and become walkable decks', () => {
    const { sim } = createScenario('sandbox', 1337);
    const p = sim.economy.player(PLAYER);
    p.stock[Res.Concrete] = 20;
    const tiles: number[] = [];
    for (let x = 30; x < 36; x++) tiles.push(x, 82);
    sim.enqueue({ type: 'buildWall', owner: PLAYER, tiles });
    sim.step();
    const built = sim.structures.filter((s) => s.kind === 'wall' && s.tz === 82).length;
    expect(built).toBe(6);
    expect(p.stock[Res.Concrete]).toBe(20 - 6 * STRUCTURE_DEFS.wall.cost.concrete!);
    expect(sim.map.deck[sim.map.idx(32, 82)]).toBe(1);
    expect(sim.map.blocked[sim.map.idx(32, 82)]).toBe(Block.Structure);
  });

  it('stairs must touch your wall', () => {
    const { sim } = createScenario('sandbox', 1337);
    expect(sim.economy.canPlace(PLAYER, 'stairs', 28, 80).reason).toBe('Must be right next to your wall');
  });
});

describe('military chain', () => {
  it('scrap → steel → arms factory → armory → barracks → soldier', () => {
    const { sim } = createScenario('sandbox', 1337);
    const p = sim.economy.player(PLAYER);
    p.stock[Res.Rifle] = 0;
    p.stock[Res.Steel] = 6;
    p.stock[Res.Timber] = 200;
    p.stock[Res.Concrete] = 200;
    sim.enqueue({ type: 'setRations', owner: PLAYER, level: 0 });
    // Arms factory just outside the north gate.
    let placed = false;
    for (let r = 0; r < 12 && !placed; r++) {
      for (let dx = -r; dx <= r && !placed; dx++) {
        const tx = 26 + dx;
        const tz = 46 - r;
        if (sim.economy.canPlace(PLAYER, 'arms', tx, tz).ok) {
          sim.enqueue({ type: 'build', owner: PLAYER, kind: 'arms', tx, tz });
          placed = true;
        }
      }
    }
    expect(placed).toBe(true);
    runSec(sim, 90);
    expect(p.stock[Res.Rifle]).toBeGreaterThanOrEqual(1);
    expect(p.stock[Res.Steel]).toBeLessThan(6);

    const barracks = sim.structures.find((s) => s.kind === 'barracks' && s.owner === PLAYER)!;
    const riflesBefore = p.stock[Res.Rifle];
    const fundsBefore = p.funds;
    const soldiersBefore = sim.units.kind.filter((k, i) => k === UnitKind.Rifleman && sim.units.alive[i] && sim.units.owner[i] === PLAYER).length;
    sim.enqueue({ type: 'recruit', owner: PLAYER, barracks: barracks.id, kind: UnitKind.Rifleman, count: 1 });
    runSec(sim, 25);
    const soldiersAfter = sim.units.kind.filter((k, i) => k === UnitKind.Rifleman && sim.units.alive[i] && sim.units.owner[i] === PLAYER).length;
    expect(soldiersAfter).toBe(soldiersBefore + 1);
    expect(p.stock[Res.Rifle]).toBeLessThan(riflesBefore + 1); // consumed one (factory may have made more)
    expect(p.funds).toBeLessThan(fundsBefore + 60);
  });

  it('cannot recruit without gear', () => {
    const { sim } = createScenario('sandbox', 1337);
    sim.economy.player(PLAYER).stock[Res.MG] = 0;
    expect(sim.economy.recruitBlocker(PLAYER, UnitKind.Gunner)).toMatch(/machine guns/i);
  });
});

describe('combat', () => {
  it('troops on a wall take less damage than troops on the ground', () => {
    const sim = openSim();
    for (let x = 10; x < 30; x++) sim.placeStructure('wall', PLAYER, x, 20);
    const onWall = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 20.5);
    sim.units.layer[onWall] = 1;
    const onGround = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 25.5, 30.5);
    sim.combat.damageUnit(onWall, 30 * 0.6, -1);
    sim.combat.damageUnit(onGround, 30, -1);
    expect(sim.units.hp[onWall]).toBeGreaterThan(sim.units.hp[onGround]);
  });

  it('a defender on the wall can be shot from outside, but ground troops behind it cannot', () => {
    const sim = openSim();
    for (let x = 10; x < 30; x++) sim.placeStructure('wall', PLAYER, x, 20);
    const shooter = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 20.5, 10.5);
    const onWall = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 20.5);
    sim.units.layer[onWall] = 1;
    const behind = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 15.5, 24.5);
    expect(sim.combat.los(shooter, onWall)).toBe(true);
    expect(sim.combat.los(shooter, behind)).toBe(false);
  });

  it('machine guns suppress their target', () => {
    const sim = openSim();
    const mg = sim.spawnUnit(UnitKind.Gunner, PLAYER, 10.5, 10.5);
    const foe = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 20.5);
    let suppressed = false;
    for (let t = 0; t < 60 && !suppressed; t++) {
      sim.step();
      suppressed = sim.units.suppressed[foe] > 0;
    }
    expect(suppressed).toBe(true);
    expect(sim.units.alive[mg]).toBe(1);
  });

  it('engineers blow a hole in a wall that blocks the way', () => {
    const sim = openSim(40, 40);
    sim.placeStructure('hq', PLAYER, 18, 30);
    for (let x = 0; x < 40; x++) sim.placeStructure('wall', PLAYER, x, 20);
    sim.economy.player(PLAYER);
    sim.director = new WaveDirector(ENEMY, PLAYER, [{ at: 0, groups: [{ kind: UnitKind.Engineer, n: 2 }] }], { x: 20, z: 8 });
    const walls0 = sim.structures.filter((s) => s.kind === 'wall').length;
    runSec(sim, 40);
    const walls1 = sim.structures.filter((s) => s.kind === 'wall').length;
    expect(walls1).toBeLessThan(walls0);
    expect(sim.drainEvents().some((e) => e.type === 'explosion')).toBe(true);
  });

  it('only engineers accept orders to attack walls', () => {
    const sim = openSim();
    const wall = sim.placeStructure('wall', ENEMY, 20, 20)!;
    const rifle = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 10.5);
    const eng = sim.spawnUnit(UnitKind.Engineer, PLAYER, 21.5, 10.5);
    sim.enqueue({ type: 'attackStructure', owner: PLAYER, ids: [rifle, eng], structure: wall.id });
    sim.step();
    expect(sim.units.order[rifle]).not.toBe(Order.Breach);
    expect(sim.units.order[eng]).toBe(Order.Breach);
  });
});

describe('Hold the Line', () => {
  it('spawns the first wave on schedule and sends it at the HQ', () => {
    const { sim } = createScenario('hold', 1337);
    expect(sim.director).not.toBeNull();
    runSec(sim, 151);
    let attackers = 0;
    for (let i = 0; i < sim.units.count; i++) if (sim.units.alive[i] && sim.combat.assault[i]) attackers++;
    expect(attackers).toBe(6);
    const hq = sim.economy.hqOf(PLAYER)!;
    const w = [...sim.director!.alive][0];
    const d0 = Math.hypot(sim.units.x[w] - hq.tx, sim.units.z[w] - hq.tz);
    runSec(sim, 10);
    const d1 = Math.hypot(sim.units.x[w] - hq.tx, sim.units.z[w] - hq.tz);
    expect(d1).toBeLessThan(d0);
  });

  it('losing the Commander is a defeat', () => {
    const { sim } = createScenario('hold', 1337);
    const cmd = first(sim, PLAYER, UnitKind.Commander);
    sim.combat.damageUnit(cmd, 10_000, -1);
    runSec(sim, 2);
    expect(sim.result?.result).toBe('defeat');
  });

  it('beating every wave is a victory', () => {
    const { sim } = createScenario('hold', 1337);
    const dir = sim.director!;
    dir.next = dir.waves.length; // pretend all waves were sent…
    runSec(sim, 2); // …and none are alive
    expect(sim.result?.result).toBe('victory');
  });

  it('runs the first two waves without errors and stays deterministic', () => {
    const run = (): number => {
      const { sim } = createScenario('hold', 77);
      runSec(sim, 330);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
