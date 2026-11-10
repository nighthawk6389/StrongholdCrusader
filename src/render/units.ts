import * as THREE from 'three';
import type { Sim } from '../sim/sim';
import { UNIT_TYPES, UnitKind } from '../sim/unitTypes';
import { CARRY_LOG, MAX_UNITS } from '../sim/units';
import { Res, type StructureKind } from '../sim/structures';
import { box, merge } from './geometry';
import { COLORS, COMMANDER_TINT, TEAM_COLORS } from './palette';

const HIP_Y = 0.46;
const HIP_X = 0.085;

/** Procedural low-poly soldier, split so team colour and walk cycle can be applied per instance. */
function soldierParts(): { team: THREE.BufferGeometry; gear: THREE.BufferGeometry; leg: THREE.BufferGeometry } {
  const team = merge([
    box(0.36, 0.4, 0.22, 0, 0.66, 0, 0xffffff), // vest
    box(0.25, 0.11, 0.26, 0, 1.04, 0.01, 0xd6d6d6), // helmet
    box(0.09, 0.09, 0.34, -0.16, 0.74, 0.14, 0xe8e8e8), // left arm
    box(0.09, 0.09, 0.3, 0.17, 0.72, 0.1, 0xe8e8e8), // right arm
  ]);
  const gear = merge([
    box(0.18, 0.18, 0.18, 0, 0.94, 0, COLORS.skin), // head
    box(0.26, 0.28, 0.12, 0, 0.68, -0.17, COLORS.pack), // backpack
    box(0.05, 0.07, 0.62, 0.08, 0.76, 0.32, COLORS.rifle), // rifle
    box(0.2, 0.05, 0.02, 0, 0.97, 0.1, 0x1c1c1c), // goggles band
  ]);
  const leg = merge([
    box(0.13, 0.4, 0.15, 0, -0.2, 0, COLORS.pants),
    box(0.14, 0.08, 0.21, 0, -0.42, 0.03, COLORS.boots),
  ]);
  return { team, gear, leg };
}

/** Civilian: shirt (tinted per job), head + hair. Legs are shared with soldiers. */
function civilianParts(): { shirt: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const shirt = merge([
    box(0.32, 0.38, 0.2, 0, 0.64, 0, 0xffffff),
    box(0.08, 0.32, 0.09, -0.2, 0.62, 0.02, 0xf0f0f0),
    box(0.08, 0.32, 0.09, 0.2, 0.62, 0.02, 0xf0f0f0),
  ]);
  const head = merge([
    box(0.17, 0.17, 0.17, 0, 0.92, 0, COLORS.skin),
    box(0.19, 0.06, 0.19, 0, 1.02, -0.01, 0x3b2a1e),
  ]);
  return { shirt, head };
}

const JOB_COLORS: Partial<Record<StructureKind, number>> = {
  lumber: 0x8a5a2b,
  quarry: 0x7d8288,
  orchard: 0x5f8a3a,
  ranch: 0xa0522d,
};
const IDLE_COLOR = 0xd8cfb8;

const CARGO_COLORS: Record<number, number> = {
  [Res.Timber]: 0xc8a06a,
  [Res.Concrete]: 0xb9b4a8,
  [Res.Produce]: 0xe08a2c,
  [Res.Meat]: 0xb5524a,
  [CARRY_LOG]: 0x6b4a2b,
};

export interface UnitDrawState {
  alpha: number;
  dt: number;
  selected: ReadonlySet<number>;
  cameraQuat: THREE.Quaternion;
}

export class UnitRenderer {
  readonly group = new THREE.Group();
  private team: THREE.InstancedMesh;
  private gear: THREE.InstancedMesh;
  private legL: THREE.InstancedMesh;
  private legR: THREE.InstancedMesh;
  private civShirt: THREE.InstancedMesh;
  private civHead: THREE.InstancedMesh;
  private cargo: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private barBg: THREE.InstancedMesh;
  private barFg: THREE.InstancedMesh;
  private phase = new Float32Array(MAX_UNITS);

  private m = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private col = new THREE.Color();
  private yAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private sim: Sim,
    castShadows: boolean,
  ) {
    const parts = soldierParts();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cap = MAX_UNITS;
    this.team = new THREE.InstancedMesh(parts.team, mat, cap);
    this.gear = new THREE.InstancedMesh(parts.gear, mat, cap);
    this.legL = new THREE.InstancedMesh(parts.leg, mat, cap);
    this.legR = new THREE.InstancedMesh(parts.leg, mat, cap);
    for (const im of [this.team, this.gear, this.legL, this.legR]) {
      im.frustumCulled = false;
      im.castShadow = castShadows;
      im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    // Instance colours for team tint (initialise so the attribute exists).
    for (let i = 0; i < cap; i++) this.team.setColorAt(i, this.col.setHex(0xffffff));

    const civ = civilianParts();
    this.civShirt = new THREE.InstancedMesh(civ.shirt, mat, cap);
    this.civHead = new THREE.InstancedMesh(civ.head, mat, cap);
    const cargoGeo = new THREE.BoxGeometry(0.3, 0.22, 0.24);
    this.cargo = new THREE.InstancedMesh(cargoGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
    for (const im of [this.civShirt, this.civHead, this.cargo]) {
      im.frustumCulled = false;
      im.castShadow = castShadows;
      im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    for (let i = 0; i < cap; i++) {
      this.civShirt.setColorAt(i, this.col.setHex(IDLE_COLOR));
      this.cargo.setColorAt(i, this.col.setHex(0xffffff));
    }

    const ringGeo = new THREE.RingGeometry(0.34, 0.44, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: COLORS.selection, transparent: true, opacity: 0.9, depthWrite: false }),
      cap,
    );
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.rings.renderOrder = 2;
    this.group.add(this.rings);

    const barGeo = new THREE.PlaneGeometry(0.6, 0.07);
    this.barBg = new THREE.InstancedMesh(
      barGeo,
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthWrite: false }),
      cap,
    );
    const fgGeo = new THREE.PlaneGeometry(0.6, 0.07);
    fgGeo.translate(0.3, 0, 0.001); // anchor at the left edge so x-scale shrinks rightwards
    this.barFg = new THREE.InstancedMesh(fgGeo, new THREE.MeshBasicMaterial({ depthWrite: false }), cap);
    for (const b of [this.barBg, this.barFg]) {
      b.frustumCulled = false;
      b.count = 0;
      b.renderOrder = 3;
      this.group.add(b);
    }
    for (let i = 0; i < cap; i++) this.barFg.setColorAt(i, this.col.setHex(0x55dd55));
  }

  /** Interpolated world position of a unit (for cameras / FX). */
  unitPosition(id: number, alpha: number, out: THREE.Vector3): THREE.Vector3 {
    const u = this.sim.units;
    const x = u.px[id] + (u.x[id] - u.px[id]) * alpha;
    const z = u.pz[id] + (u.z[id] - u.pz[id]) * alpha;
    return out.set(x, this.sim.map.heightAt(x, z), z);
  }

  update(s: UnitDrawState): void {
    const u = this.sim.units;
    const map = this.sim.map;
    let n = 0; // soldiers
    let c = 0; // civilians
    let legs = 0;
    let cargo = 0;
    let rings = 0;
    let bars = 0;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const x = u.px[i] + (u.x[i] - u.px[i]) * s.alpha;
      const z = u.pz[i] + (u.z[i] - u.pz[i]) * s.alpha;
      const y = map.heightAt(x, z);
      let dh = u.heading[i] - u.pheading[i];
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      const heading = u.pheading[i] + dh * s.alpha;

      const speed = Math.hypot(u.x[i] - u.px[i], u.z[i] - u.pz[i]) * 20; // tiles/sec
      const moving = Math.min(1, speed / 1.5);
      this.phase[i] += s.dt * (4 + speed * 3.2) * (moving > 0.05 ? 1 : 0);
      const swing = Math.sin(this.phase[i]) * 0.65 * moving;
      const bob = Math.abs(Math.cos(this.phase[i])) * 0.035 * moving;

      const kind = u.kind[i];
      const isCiv = kind === UnitKind.Civilian;
      const isCmd = kind === UnitKind.Commander;
      const k = isCmd ? 1.15 : isCiv ? 0.95 : 1;
      this.pos.set(x, y + bob, z);
      this.quat.setFromAxisAngle(this.yAxis, heading);
      this.scl.set(k, k, k);
      this.m.compose(this.pos, this.quat, this.scl);

      const owner = u.owner[i];
      if (isCiv) {
        this.civShirt.setMatrixAt(c, this.m);
        this.civHead.setMatrixAt(c, this.m);
        const job = u.job[i] >= 0 ? this.sim.structureById(u.job[i]) : undefined;
        this.civShirt.setColorAt(c, this.col.setHex((job && JOB_COLORS[job.kind]) ?? IDLE_COLOR));
        c++;
        const carry = u.carry[i];
        if (carry >= 0) {
          const log = carry === CARRY_LOG;
          this.local.makeTranslation(0, 0.62, 0.2);
          if (log) this.local.multiply(this.tmp.makeScale(0.6, 0.8, 2.6));
          this.cargo.setMatrixAt(cargo, this.tmp.multiplyMatrices(this.m, this.local));
          this.cargo.setColorAt(cargo, this.col.setHex(CARGO_COLORS[carry] ?? 0xffffff));
          cargo++;
        }
      } else {
        this.team.setMatrixAt(n, this.m);
        this.gear.setMatrixAt(n, this.m);
        this.team.setColorAt(n, this.col.setHex(isCmd ? COMMANDER_TINT[owner] : TEAM_COLORS[owner] ?? 0xffffff));
        n++;
      }

      this.local.makeRotationX(swing).setPosition(-HIP_X, HIP_Y, 0);
      this.tmp.multiplyMatrices(this.m, this.local);
      this.legL.setMatrixAt(legs, this.tmp);
      this.local.makeRotationX(-swing).setPosition(HIP_X, HIP_Y, 0);
      this.tmp.multiplyMatrices(this.m, this.local);
      this.legR.setMatrixAt(legs, this.tmp);
      legs++;

      const selected = s.selected.has(i);
      if (selected) {
        this.pos.set(x, y + 0.06, z);
        this.quat.identity();
        this.scl.set(k, 1, k);
        this.m.compose(this.pos, this.quat, this.scl);
        this.rings.setMatrixAt(rings++, this.m);
      }

      const maxHp = UNIT_TYPES[kind].hp;
      const frac = u.hp[i] / maxHp;
      if (selected || frac < 0.999) {
        this.pos.set(x, y + 1.32 * k, z);
        this.scl.set(1, 1, 1);
        this.m.compose(this.pos, s.cameraQuat, this.scl);
        this.barBg.setMatrixAt(bars, this.m);
        this.local.makeTranslation(-0.3, 0, 0).scale(this.scl.set(Math.max(frac, 0.001), 1, 1));
        this.tmp.multiplyMatrices(this.m, this.local);
        this.barFg.setMatrixAt(bars, this.tmp);
        this.barFg.setColorAt(bars, this.col.setHSL(0.33 * frac, 0.75, 0.5));
        bars++;
      }
    }
    this.team.count = this.gear.count = n;
    this.civShirt.count = this.civHead.count = c;
    this.legL.count = this.legR.count = legs;
    this.cargo.count = cargo;
    for (const im of [this.team, this.gear, this.legL, this.legR, this.civShirt, this.civHead, this.cargo]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.rings.count = rings;
    this.rings.instanceMatrix.needsUpdate = true;
    this.barBg.count = this.barFg.count = bars;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFg.instanceMatrix.needsUpdate = true;
    if (this.barFg.instanceColor) this.barFg.instanceColor.needsUpdate = true;
  }
}
