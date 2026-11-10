/** Static structures (buildings, walls, lights). M0 only places them from the scenario. */

export type StructureKind = 'hq' | 'house' | 'depot' | 'wall' | 'tower' | 'floodlight' | 'gate';

export interface StructureDef {
  kind: StructureKind;
  name: string;
  w: number;
  h: number;
  /** Whether the footprint blocks movement. */
  blocks: boolean;
  hp: number;
}

export const STRUCTURE_DEFS: Record<StructureKind, StructureDef> = {
  hq: { kind: 'hq', name: 'Command HQ', w: 4, h: 4, blocks: true, hp: 3000 },
  house: { kind: 'house', name: 'Housing Block', w: 2, h: 2, blocks: true, hp: 400 },
  depot: { kind: 'depot', name: 'Supply Depot', w: 3, h: 3, blocks: true, hp: 600 },
  wall: { kind: 'wall', name: 'Concrete Wall', w: 1, h: 1, blocks: true, hp: 800 },
  tower: { kind: 'tower', name: 'Watchtower', w: 2, h: 2, blocks: true, hp: 1000 },
  floodlight: { kind: 'floodlight', name: 'Floodlight', w: 1, h: 1, blocks: true, hp: 150 },
  gate: { kind: 'gate', name: 'Checkpoint Gate', w: 1, h: 1, blocks: false, hp: 1200 },
};

export interface Structure {
  id: number;
  kind: StructureKind;
  owner: number;
  tx: number;
  tz: number;
  w: number;
  h: number;
  hp: number;
  /** Facing in radians (floodlight beam direction, gate orientation). */
  rot: number;
}
