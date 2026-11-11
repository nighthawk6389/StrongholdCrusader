import type { StructureKind } from './structures';

export type Side = 'east' | 'west' | 'north' | 'south';

export interface Piece {
  kind: StructureKind;
  tx: number;
  tz: number;
  rot: number;
  side: Side | 'corner';
}

const QUARTER = Math.PI / 2;

/**
 * A square compound around (cx, cz): corner towers, a gatehouse in the middle of each listed side,
 * walls everywhere else on the ring, and stairs just inside each side. Order: towers, gates, walls, stairs.
 */
export function ringBlueprint(cx: number, cz: number, ring: number, gates: Side[]): Piece[] {
  const pieces: Piece[] = [];
  const corners: [number, number][] = [
    [cx - ring, cz - ring],
    [cx + ring - 1, cz - ring],
    [cx - ring, cz + ring - 1],
    [cx + ring - 1, cz + ring - 1],
  ];
  for (const [tx, tz] of corners) pieces.push({ kind: 'tower', tx, tz, rot: 0, side: 'corner' });

  const gateAt: Record<Side, Piece> = {
    east: { kind: 'gate', tx: cx + ring, tz: cz - 1, rot: QUARTER, side: 'east' },
    west: { kind: 'gate', tx: cx - ring, tz: cz - 1, rot: QUARTER, side: 'west' },
    north: { kind: 'gate', tx: cx - 1, tz: cz - ring, rot: 0, side: 'north' },
    south: { kind: 'gate', tx: cx - 1, tz: cz + ring, rot: 0, side: 'south' },
  };
  for (const g of gates) pieces.push(gateAt[g]);

  const sideOf = (x: number, z: number): Side => {
    if (x === cx - ring) return 'west';
    if (x === cx + ring) return 'east';
    return z === cz - ring ? 'north' : 'south';
  };
  const occupied = (x: number, z: number): boolean =>
    pieces.some((p) => {
      const big = p.kind === 'tower' || p.kind === 'guntower';
      const w = big ? 2 : p.kind === 'gate' ? (p.rot ? 1 : 3) : 1;
      const h = big ? 2 : p.kind === 'gate' ? (p.rot ? 3 : 1) : 1;
      return x >= p.tx && z >= p.tz && x < p.tx + w && z < p.tz + h;
    });
  for (let z = cz - ring; z <= cz + ring; z++) {
    for (let x = cx - ring; x <= cx + ring; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== ring || occupied(x, z)) continue;
      pieces.push({ kind: 'wall', tx: x, tz: z, rot: 0, side: sideOf(x, z) });
    }
  }

  const s = ring - 1;
  const off = Math.max(3, Math.round(ring / 2));
  const stairs: [number, number, Side][] = [
    [cx - s, cz - off, 'west'],
    [cx - s, cz + off, 'west'],
    [cx + s, cz - off, 'east'],
    [cx + s, cz + off, 'east'],
    [cx - off, cz - s, 'north'],
    [cx + off, cz - s, 'north'],
    [cx - off, cz + s, 'south'],
    [cx + off, cz + s, 'south'],
  ];
  for (const [tx, tz, side] of stairs) pieces.push({ kind: 'stairs', tx, tz, rot: 0, side });
  return pieces;
}

/** Tiles on (and one tile either side of) the ring: kept clear of other buildings. */
export function ringReserve(cx: number, cz: number, ring: number): (tx: number, tz: number) => boolean {
  return (tx, tz) => {
    const d = Math.max(Math.abs(tx - cx), Math.abs(tz - cz));
    return d >= ring - 1 && d <= ring + 1;
  };
}
