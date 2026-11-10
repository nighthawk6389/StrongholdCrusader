import { UNIT_TYPES } from './unitTypes';

export const MAX_UNITS = 2048;

export const Order = {
  Idle: 0,
  Move: 1,
  /** Possessed by the player in over-the-shoulder mode. */
  Control: 2,
} as const;

/** Structure-of-arrays unit storage. A unit id is its slot index. */
export class UnitStore {
  /** High-water mark: iterate 0..count-1 and check `alive`. */
  count = 0;
  readonly alive = new Uint8Array(MAX_UNITS);
  readonly owner = new Uint8Array(MAX_UNITS);
  readonly kind = new Uint8Array(MAX_UNITS);
  readonly x = new Float32Array(MAX_UNITS);
  readonly z = new Float32Array(MAX_UNITS);
  /** Previous-tick position/heading, for render interpolation. */
  readonly px = new Float32Array(MAX_UNITS);
  readonly pz = new Float32Array(MAX_UNITS);
  readonly vx = new Float32Array(MAX_UNITS);
  readonly vz = new Float32Array(MAX_UNITS);
  readonly heading = new Float32Array(MAX_UNITS);
  readonly pheading = new Float32Array(MAX_UNITS);
  readonly hp = new Float32Array(MAX_UNITS);
  readonly order = new Uint8Array(MAX_UNITS);
  readonly goalX = new Float32Array(MAX_UNITS);
  readonly goalZ = new Float32Array(MAX_UNITS);
  /** Goal tile index for the flow field, -1 if none. */
  readonly field = new Int32Array(MAX_UNITS).fill(-1);
  readonly stuck = new Float32Array(MAX_UNITS);
  readonly cooldown = new Uint8Array(MAX_UNITS);
  /** Current auto-engage target id, -1 if none. */
  readonly target = new Int32Array(MAX_UNITS).fill(-1);
  /** Tick of the last shot fired (for muzzle-flash rendering). */
  readonly lastShot = new Int32Array(MAX_UNITS).fill(-1000);

  spawn(kind: number, owner: number, x: number, z: number, heading: number): number {
    let id = -1;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        id = i;
        break;
      }
    }
    if (id < 0) {
      if (this.count >= MAX_UNITS) return -1;
      id = this.count++;
    }
    this.alive[id] = 1;
    this.owner[id] = owner;
    this.kind[id] = kind;
    this.x[id] = this.px[id] = x;
    this.z[id] = this.pz[id] = z;
    this.vx[id] = this.vz[id] = 0;
    this.heading[id] = this.pheading[id] = heading;
    this.hp[id] = UNIT_TYPES[kind].hp;
    this.order[id] = Order.Idle;
    this.goalX[id] = x;
    this.goalZ[id] = z;
    this.field[id] = -1;
    this.stuck[id] = 0;
    this.cooldown[id] = 0;
    this.target[id] = -1;
    this.lastShot[id] = -1000;
    return id;
  }

  kill(id: number): void {
    this.alive[id] = 0;
    this.order[id] = Order.Idle;
    this.field[id] = -1;
    this.target[id] = -1;
  }

  isAlive(id: number): boolean {
    return id >= 0 && id < this.count && this.alive[id] === 1;
  }
}
