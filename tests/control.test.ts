import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { GameMap, Tile } from '../src/sim/map';
import { ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim, type Command } from '../src/sim/sim';
import { Res } from '../src/sim/structures';
import { UNIT_TYPES, UnitKind } from '../src/sim/unitTypes';
import { Order } from '../src/sim/units';

/** Flat open map in daylight (startSec 100) unless told otherwise. */
function openSim(startSec = 100, w = 48, h = 48): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 5, startSec });
  sim.economy.player(PLAYER);
  sim.economy.player(ENEMY);
  return sim;
}

function runTicks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

type ControlCmd = Extract<Command, { type: 'control' }>;

/** Possess `id` for `ticks` ticks, sending the same intent every tick. */
function hold(sim: Sim, id: number, ticks: number, c: Partial<ControlCmd>): void {
  for (let i = 0; i < ticks; i++) {
    sim.enqueue({ type: 'control', owner: PLAYER, id, mx: 0, mz: 0, yaw: 0, fire: false, aim: false, ...c });
    sim.step();
  }
}

/** Pitch from the default eye (0.8 above the feet) at distance `d` to height `y`. */
const pitchTo = (d: number, y: number, eyeY = 0.8): number => Math.atan2(y - eyeY, d);

function wallRow(sim: Sim, owner: number, z: number, x0: number, x1: number): void {
  for (let x = x0; x <= x1; x++) sim.placeStructure('wall', owner, x, z);
}

describe('direct control: aimed fire', () => {
  it('a head hit does double damage, a body hit normal, a shot over the head misses', () => {
    const run = (y: number): number => {
      const sim = openSim();
      const me = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
      const foe = sim.spawnUnit(UnitKind.Civilian, ENEMY, 10.5, 20.5); // unarmed: doesn't shoot back
      sim.units.hp[foe] = 200;
      hold(sim, me, 1, { yaw: 0, pitch: pitchTo(10, y), aim: true, fire: true });
      return 200 - sim.units.hp[foe];
    };
    const dmg = UNIT_TYPES[UnitKind.Rifleman].damage;
    expect(run(0.97)).toBeCloseTo(dmg * 2, 3); // head
    expect(run(0.45)).toBeCloseTo(dmg, 3); // chest
    expect(run(1.6)).toBe(0); // over the head
  });

  it('the parapet covers a defender on a wall top, but not their head', () => {
    const run = (y: number): number => {
      const sim = openSim();
      wallRow(sim, ENEMY, 20, 5, 15);
      const me = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
      const foe = sim.spawnUnit(UnitKind.Civilian, ENEMY, 10.5, 20.5);
      sim.units.layer[foe] = 1;
      sim.units.elev[foe] = sim.units.pelev[foe] = 1.55;
      sim.units.hp[foe] = 200;
      hold(sim, me, 1, { yaw: 0, pitch: pitchTo(10, y), aim: true, fire: true });
      return 200 - sim.units.hp[foe];
    };
    expect(run(1.55 + 0.25)).toBe(0); // body behind the battlement
    expect(run(1.55 + 0.97)).toBeGreaterThan(UNIT_TYPES[UnitKind.Rifleman].damage * 1.5); // head
  });

  it('you can fire down from your own wall top', () => {
    const sim = openSim();
    wallRow(sim, PLAYER, 10, 5, 15);
    const me = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    sim.units.layer[me] = 1;
    sim.units.elev[me] = sim.units.pelev[me] = 1.55;
    const foe = sim.spawnUnit(UnitKind.Civilian, ENEMY, 10.5, 16.5);
    hold(sim, me, 1, { yaw: 0, pitch: pitchTo(6, 0.45, 1.55 + 0.8), aim: true, fire: true });
    expect(sim.units.hp[foe]).toBeLessThan(UNIT_TYPES[UnitKind.Civilian].hp);
  });

  it('magazines run dry and reload; R reloads early', () => {
    const sim = openSim();
    const m = sim.spawnUnit(UnitKind.Marksman, PLAYER, 10.5, 10.5);
    const t = UNIT_TYPES[UnitKind.Marksman];
    hold(sim, m, (t.cooldown + 1) * t.mag, { fire: true, pitch: 0.3 });
    expect(sim.units.ammo[m]).toBe(0);
    expect(sim.units.reload[m]).toBeGreaterThan(0);
    hold(sim, m, Math.ceil(t.reloadSec * TICK_RATE) + 1, {});
    expect(sim.units.ammo[m]).toBe(t.mag);

    const r = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 10.5);
    hold(sim, r, 12, { fire: true, pitch: 0.3 });
    const left = sim.units.ammo[r];
    expect(left).toBeLessThan(30);
    hold(sim, r, 1, { reload: true });
    expect(sim.units.reload[r]).toBeGreaterThan(0);
    hold(sim, r, Math.ceil(2.2 * TICK_RATE) + 1, { fire: false });
    expect(sim.units.ammo[r]).toBe(30);
  });
});

describe('direct control: movement and demolition', () => {
  it('an operator climbs a wall by walking into it and drops off the far side; a rifleman cannot', () => {
    const sim = openSim();
    wallRow(sim, ENEMY, 20, 5, 15);
    const op = sim.spawnUnit(UnitKind.Operator, PLAYER, 10.5, 18.5);
    const rf = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 13.5, 18.5);
    let sawDeck = false;
    for (let k = 0; k < 3 * TICK_RATE; k++) {
      sim.enqueue({ type: 'control', owner: PLAYER, id: rf, mx: 0, mz: 1, yaw: 0, fire: false, aim: false });
      hold(sim, op, 1, { mz: 1 });
      if (sim.units.layer[op] === 1) sawDeck = true;
    }
    expect(sawDeck).toBe(true);
    expect(sim.units.layer[op]).toBe(0);
    expect(sim.units.z[op]).toBeGreaterThan(21);
    expect(sim.units.z[rf]).toBeLessThan(20);
  });

  it('anyone can walk down stairs as well as up', () => {
    const sim = openSim();
    wallRow(sim, PLAYER, 20, 5, 15);
    sim.placeStructure('stairs', PLAYER, 10, 19);
    const r = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 17.5);
    hold(sim, r, 30, { mz: 1 });
    expect(sim.units.layer[r]).toBe(1);
    hold(sim, r, 40, { mz: -1, yaw: Math.PI });
    expect(sim.units.layer[r]).toBe(0);
    expect(sim.units.z[r]).toBeLessThan(19);
  });

  it('a possessed operator plants a charge on an enemy gate; walking away cancels it', () => {
    const sim = openSim();
    const gate = sim.placeStructure('gate', ENEMY, 10, 20)!;
    const op = sim.spawnUnit(UnitKind.Operator, PLAYER, 11.5, 19.6);
    hold(sim, op, 1, { plant: true });
    expect(sim.units.plantTimer[op]).toBeGreaterThan(0);
    hold(sim, op, 3, { mz: -1 });
    expect(sim.units.plantTimer[op]).toBe(0);
    expect(sim.units.charges[op]).toBe(1);

    const op2 = sim.spawnUnit(UnitKind.Operator, PLAYER, 11.5, 19.6);
    hold(sim, op2, 1, { plant: true });
    hold(sim, op2, Math.ceil(UNIT_TYPES[UnitKind.Operator].plantSec * TICK_RATE) + 1, {});
    expect(sim.units.charges[op2]).toBe(0);
    expect(gate.hp).toBeLessThan(1600);
  });

  it('the rest of the squad follows the possessed unit', () => {
    const sim = openSim();
    const lead = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 8.5);
    const squad = [0, 1, 2].map((k) => sim.spawnUnit(UnitKind.Rifleman, PLAYER, 8.5 + k, 6.5));
    sim.enqueue({ type: 'follow', owner: PLAYER, ids: squad, leader: lead });
    hold(sim, lead, 6 * TICK_RATE, { mz: 1 });
    hold(sim, lead, 2 * TICK_RATE, {});
    expect(sim.units.z[lead]).toBeGreaterThan(20);
    for (const id of squad) {
      expect(sim.units.order[id]).toBe(Order.Follow);
      expect(Math.hypot(sim.units.x[id] - sim.units.x[lead], sim.units.z[id] - sim.units.z[lead])).toBeLessThan(5);
    }
  });
});

describe('gun towers and searchlights', () => {
  it('a gun tower fires on its own only while a soldier is up top', () => {
    const sim = openSim();
    const tower = sim.placeStructure('guntower', PLAYER, 10, 10)!;
    const foe = sim.spawnUnit(UnitKind.Civilian, ENEMY, 11, 34); // beyond a rifleman's reach, inside the gun's
    sim.units.hp[foe] = 1000;
    runTicks(sim, 60);
    expect(sim.units.hp[foe]).toBe(1000);
    const crew = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 11, 11);
    sim.units.layer[crew] = 1;
    sim.units.elev[crew] = sim.units.pelev[crew] = 2.75;
    let towerShots = 0;
    for (let k = 0; k < 80; k++) {
      sim.step();
      towerShots += sim.drainEvents().filter((e) => e.type === 'shot' && e.unit === -1).length;
    }
    expect(towerShots).toBeGreaterThan(5);
    expect(sim.units.hp[foe]).toBeLessThan(1000);
    void tower;
  });

  it('you can aim a crewed gun tower by hand', () => {
    const sim = openSim();
    const tower = sim.placeStructure('guntower', PLAYER, 10, 10)!;
    const foe = sim.spawnUnit(UnitKind.Civilian, ENEMY, 11, 31);
    sim.units.hp[foe] = 1000;
    const aim = (n: number): void => {
      for (let k = 0; k < n; k++) {
        // Muzzle sits ~3.7 above the ground; the default eye is 0.4 above that.
        sim.enqueue({ type: 'controlStructure', owner: PLAYER, id: tower.id, yaw: 0, pitch: pitchTo(19.3, 0.45, 4.1), fire: true, aim: true });
        sim.step();
      }
    };
    aim(20);
    expect(sim.units.hp[foe]).toBe(1000); // nobody up top
    const crew = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    sim.units.layer[crew] = 1;
    aim(20);
    expect(sim.units.hp[foe]).toBeLessThan(1000 - 26 * 4);
    expect(tower.ammo).toBeLessThan(120);
  });

  it('a searchlight follows your aim while you hold it, then resumes its sweep', () => {
    const sim = openSim(400);
    const s = sim.placeStructure('searchlight', PLAYER, 10, 10)!;
    sim.enqueue({ type: 'controlStructure', owner: PLAYER, id: s.id, yaw: 1.2, fire: false, aim: false });
    sim.step();
    expect(sim.vision.beamAngle(s)).toBeCloseTo(1.2, 5);
    runTicks(sim, 10);
    expect(sim.vision.beamAngle(s)).not.toBeCloseTo(1.2, 3);
  });
});

describe('drones', () => {
  function bay(sim: Sim): number {
    sim.placeStructure('hq', PLAYER, 2, 2);
    const b = sim.placeStructure('dronebay', PLAYER, 10, 10)!;
    sim.economy.allocatePower();
    const p = sim.economy.player(PLAYER);
    p.funds = 500;
    p.stock[Res.Steel] = 40;
    p.stock[Res.Charges] = 3;
    return b.id;
  }

  it('a bay launches drones for funds and steel (strike drones also take a breach kit)', () => {
    const sim = openSim();
    const b = bay(sim);
    const p = sim.economy.player(PLAYER);
    sim.enqueue({ type: 'launchDrone', owner: PLAYER, bay: b, kind: UnitKind.ReconDrone });
    sim.enqueue({ type: 'launchDrone', owner: PLAYER, bay: b, kind: UnitKind.StrikeDrone });
    runTicks(sim, 40);
    const u = sim.units;
    const drones = [];
    for (let i = 0; i < u.count; i++) if (u.alive[i] && UNIT_TYPES[u.kind[i]].fly) drones.push(i);
    expect(drones.length).toBe(2);
    expect(p.funds).toBe(500 - 40 - 50);
    expect(p.stock[Res.Steel]).toBe(40 - 4 - 6);
    expect(p.stock[Res.Charges]).toBe(2);
    expect(u.elev[drones[0]]).toBeGreaterThan(5);
  });

  it('an unpowered bay cannot launch', () => {
    const sim = openSim();
    const b = sim.placeStructure('dronebay', PLAYER, 10, 10)!;
    sim.economy.allocatePower();
    sim.economy.player(PLAYER).funds = 500;
    sim.economy.player(PLAYER).stock[Res.Steel] = 40;
    expect(sim.drones.launchBlocker(PLAYER, b.id, UnitKind.ReconDrone)).toMatch(/power/);
  });

  it('a recon drone flies straight over walls', () => {
    const sim = openSim();
    const b = bay(sim);
    wallRow(sim, ENEMY, 20, 0, 47);
    const d = sim.drones.launch(PLAYER, b, UnitKind.ReconDrone);
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [d], x: 11, z: 32 });
    runTicks(sim, 6 * TICK_RATE);
    expect(sim.units.z[d]).toBeGreaterThan(30);
  });

  it('low battery sends a drone home to recharge; a flat battery away from a bay crashes it', () => {
    const sim = openSim();
    const b = bay(sim);
    const d = sim.drones.launch(PLAYER, b, UnitKind.ReconDrone);
    sim.units.battery[d] = 25;
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [d], x: 40, z: 40 });
    runTicks(sim, 20 * TICK_RATE);
    expect(sim.units.isAlive(d)).toBe(true);
    expect(Math.hypot(sim.units.x[d] - 11, sim.units.z[d] - 11)).toBeLessThan(2);
    const low = sim.units.battery[d];
    runTicks(sim, 5 * TICK_RATE);
    expect(sim.units.battery[d]).toBeGreaterThan(low);

    const stray = sim.spawnUnit(UnitKind.ReconDrone, PLAYER, 30.5, 30.5);
    sim.units.battery[stray] = 1;
    runTicks(sim, 25);
    expect(sim.units.isAlive(stray)).toBe(false);
  });

  it('a strike drone hunts down its target and explodes', () => {
    const sim = openSim();
    const b = bay(sim);
    const d = sim.drones.launch(PLAYER, b, UnitKind.StrikeDrone);
    const foe = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 30.5, 26.5);
    sim.enqueue({ type: 'attack', owner: PLAYER, ids: [d], target: foe });
    let boom = false;
    for (let k = 0; k < 10 * TICK_RATE && !boom; k++) {
      sim.step();
      boom = sim.drainEvents().some((e) => e.type === 'explosion');
    }
    expect(boom).toBe(true);
    expect(sim.units.isAlive(d)).toBe(false);
    expect(sim.units.isAlive(foe) ? sim.units.hp[foe] : 0).toBeLessThan(40);
  });

  it('a strike drone wrecks a gate, and a possessed one dives where you point', () => {
    const sim = openSim();
    const b = bay(sim);
    const gate = sim.placeStructure('gate', ENEMY, 20, 30)!;
    const d = sim.drones.launch(PLAYER, b, UnitKind.StrikeDrone);
    sim.enqueue({ type: 'attackStructure', owner: PLAYER, ids: [d], structure: gate.id });
    runTicks(sim, 8 * TICK_RATE);
    expect(sim.units.isAlive(d)).toBe(false);
    expect(gate.hp).toBeLessThan(1600 - 150);

    const d2 = sim.drones.launch(PLAYER, b, UnitKind.StrikeDrone);
    runTicks(sim, 2 * TICK_RATE);
    const y = sim.map.heightAt(sim.units.x[d2], sim.units.z[d2]) + sim.units.elev[d2];
    hold(sim, d2, 1, { fire: true, yaw: 0, pitch: -0.6, ex: sim.units.x[d2], ey: y, ez: sim.units.z[d2] });
    expect(sim.units.order[d2]).toBe(Order.Dive);
    runTicks(sim, 3 * TICK_RATE);
    expect(sim.units.isAlive(d2)).toBe(false);
  });

  it('soldiers shoot drones out of the sky', () => {
    const sim = openSim();
    const d = sim.spawnUnit(UnitKind.ReconDrone, PLAYER, 20.5, 20.5);
    sim.units.battery[d] = 999;
    sim.spawnUnit(UnitKind.Gunner, ENEMY, 20.5, 28.5);
    runTicks(sim, 15 * TICK_RATE);
    expect(sim.units.isAlive(d)).toBe(false);
  });

  it('stays deterministic with drones, towers and possessed units', () => {
    const play = (): number => {
      const sim = openSim(380);
      const b = bay(sim);
      const t = sim.placeStructure('guntower', PLAYER, 20, 10)!;
      const crew = sim.spawnUnit(UnitKind.Gunner, PLAYER, 21, 11);
      sim.units.layer[crew] = 1;
      const me = sim.spawnUnit(UnitKind.Operator, PLAYER, 12.5, 20.5);
      for (let k = 0; k < 4; k++) sim.spawnUnit(UnitKind.Rifleman, ENEMY, 15.5 + k, 34.5);
      sim.enqueue({ type: 'launchDrone', owner: PLAYER, bay: b, kind: UnitKind.StrikeDrone });
      for (let k = 0; k < 300; k++) {
        sim.enqueue({ type: 'control', owner: PLAYER, id: me, mx: 0, mz: 0.5, yaw: 0.1, pitch: -0.02, fire: k % 3 === 0, aim: true });
        if (k === 60) {
          for (let i = 0; i < sim.units.count; i++) {
            if (sim.units.alive[i] && sim.units.kind[i] === UnitKind.StrikeDrone) sim.enqueue({ type: 'move', owner: PLAYER, ids: [i], x: 16, z: 34 });
          }
        }
        sim.step();
      }
      void t;
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
