import { UNIT_TYPES } from './unitTypes';

export const MAX_UNITS = 2048;

export const Order = {
  Idle: 0,
  Move: 1,
  /** Possessed by the player in over-the-shoulder mode. */
  Control: 2,
  /** Hunt a specific enemy unit (`target`). */
  Attack: 3,
  /** Attack a structure (`targetStruct`): engineers plant charges, others shoot soft buildings. */
  Breach: 4,
  /** Wave AI: push toward the goal, blowing through walls on the way. */
  Assault: 5,
  /** Keep close to `leader` (your squad while you possess one of them). */
  Follow: 6,
  /** Strike drone diving onto (goalX, goalZ). */
  Dive: 7,
} as const;

/** Civilian work-cycle states (see Economy). */
export const Task = {
  Idle: 0,
  ToWork: 1,
  Working: 2,
  ToTree: 3,
  Chopping: 4,
  ToStore: 5,
  Wait: 6,
  /** Walking to a depot to pick up inputs (arms factory). */
  ToFetch: 7,
  /** Walking to the barracks to be trained. */
  Recruit: 8,
} as const;

/** `carry` value for an unsawn log (not a stockpiled resource). */
export const CARRY_LOG = 100;
export const CARRY_NONE = -1;

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

  // --- civilian work state
  /** Workplace structure id, -1 if idle. */
  readonly job = new Int32Array(MAX_UNITS).fill(-1);
  readonly task = new Uint8Array(MAX_UNITS);
  readonly taskTimer = new Float32Array(MAX_UNITS);
  /** Destination: storage structure id (ToStore) or tree index (ToTree). */
  readonly dest = new Int32Array(MAX_UNITS).fill(-1);
  /** Carried resource id, CARRY_LOG, or CARRY_NONE. */
  readonly carry = new Int16Array(MAX_UNITS).fill(CARRY_NONE);
  readonly carryAmt = new Uint8Array(MAX_UNITS);
  /** Path retries for the current leg. */
  readonly retries = new Uint8Array(MAX_UNITS);
  /** Kind a recruit becomes on reaching the barracks. */
  readonly recruitKind = new Int8Array(MAX_UNITS).fill(-1);

  // --- navigation layers
  /** 0 = ground, 1 = deck (wall tops). */
  readonly layer = new Uint8Array(MAX_UNITS);
  readonly goalLayer = new Uint8Array(MAX_UNITS);
  /** Visual elevation above ground (eases toward the deck height). */
  readonly elev = new Float32Array(MAX_UNITS);
  readonly pelev = new Float32Array(MAX_UNITS);

  // --- combat
  /** Seconds of suppression left. */
  readonly suppressed = new Float32Array(MAX_UNITS);
  readonly charges = new Uint8Array(MAX_UNITS);
  /** Structure being attacked/breached, -1 if none. */
  readonly targetStruct = new Int32Array(MAX_UNITS).fill(-1);
  /** Seconds left planting a breach charge (0 = not planting). */
  readonly plantTimer = new Float32Array(MAX_UNITS);
  /** Ticks until the next re-path for Attack/Assault. */
  readonly repath = new Uint8Array(MAX_UNITS);

  // Direct control & drones (M5)
  /** Rounds left in the magazine (direct-control fire). */
  readonly ammo = new Uint8Array(MAX_UNITS);
  /** Seconds left reloading (0 = ready). */
  readonly reload = new Float32Array(MAX_UNITS);
  /** Extra aim error from sustained fire; recovers quickly. */
  readonly bloom = new Float32Array(MAX_UNITS);
  /** Unit this one follows (Order.Follow). */
  readonly leader = new Int32Array(MAX_UNITS).fill(-1);
  /** Drones: seconds of flight left. */
  readonly battery = new Float32Array(MAX_UNITS);
  /** Drones: the bay they launched from (where they recharge). */
  readonly home = new Int32Array(MAX_UNITS).fill(-1);
  /** Artillery: how set up it is (0 = limbered, 1 = ready to fire). */
  readonly deploy = new Float32Array(MAX_UNITS);

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
    this.job[id] = -1;
    this.task[id] = Task.Idle;
    this.taskTimer[id] = 0;
    this.dest[id] = -1;
    this.carry[id] = CARRY_NONE;
    this.carryAmt[id] = 0;
    this.retries[id] = 0;
    this.recruitKind[id] = -1;
    this.layer[id] = 0;
    this.goalLayer[id] = 0;
    this.elev[id] = this.pelev[id] = 0;
    this.suppressed[id] = 0;
    this.charges[id] = UNIT_TYPES[kind].charges;
    this.targetStruct[id] = -1;
    this.plantTimer[id] = 0;
    this.repath[id] = 0;
    this.ammo[id] = UNIT_TYPES[kind].mag;
    this.reload[id] = 0;
    this.bloom[id] = 0;
    this.leader[id] = -1;
    this.battery[id] = UNIT_TYPES[kind].battery;
    this.home[id] = -1;
    this.deploy[id] = 0;
    if (UNIT_TYPES[kind].fly) this.elev[id] = this.pelev[id] = UNIT_TYPES[kind].fly;
    return id;
  }

  kill(id: number): void {
    this.alive[id] = 0;
    this.order[id] = Order.Idle;
    this.field[id] = -1;
    this.target[id] = -1;
    this.job[id] = -1;
    this.carry[id] = CARRY_NONE;
    this.targetStruct[id] = -1;
    this.leader[id] = -1;
  }

  /** Turn a unit into another kind in place (recruit → soldier). */
  convert(id: number, kind: number): void {
    this.kind[id] = kind;
    this.hp[id] = UNIT_TYPES[kind].hp;
    this.charges[id] = UNIT_TYPES[kind].charges;
    this.ammo[id] = UNIT_TYPES[kind].mag;
    this.job[id] = -1;
    this.task[id] = 0;
    this.carry[id] = CARRY_NONE;
    this.recruitKind[id] = -1;
    this.order[id] = Order.Idle;
  }

  isAlive(id: number): boolean {
    return id >= 0 && id < this.count && this.alive[id] === 1;
  }
}
