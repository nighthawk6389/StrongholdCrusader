import * as THREE from 'three';
import type { GameMap } from '../sim/map';
import type { SimEvent } from '../sim/sim';
import { COLORS, TEAM_COLORS } from './palette';

interface Timed {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

/** Lightweight pooled effects: tracers, impact puffs, move markers, fallen soldiers. */
export class Fx {
  readonly group = new THREE.Group();
  private tracers: Timed[] = [];
  private puffs: Timed[] = [];
  private markers: Timed[] = [];
  private nextTracer = 0;
  private nextPuff = 0;
  private nextMarker = 0;
  private bodies: THREE.InstancedMesh;
  private bodyCount = 0;
  private bodyCursor = 0;
  private col = new THREE.Color();
  /** Point light used for the possessed unit's muzzle flash. */
  readonly muzzleLight: THREE.PointLight;
  private muzzleLife = 0;

  constructor(private map: GameMap) {
    const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
    tracerGeo.translate(0, 0, 0.5);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: COLORS.tracer,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 96; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0.06 });
    }

    const puffGeo = new THREE.IcosahedronGeometry(0.18, 0);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(
        puffGeo,
        new THREE.MeshBasicMaterial({ color: 0xcdbb98, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      m.visible = false;
      this.group.add(m);
      this.puffs.push({ mesh: m, life: 0, max: 0.5 });
    }

    const ringGeo = new THREE.RingGeometry(0.3, 0.42, 28);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: COLORS.selection, transparent: true, opacity: 1, depthWrite: false }),
      );
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.markers.push({ mesh: m, life: 0, max: 0.7 });
    }

    const bodyGeo = new THREE.BoxGeometry(0.34, 0.14, 0.86);
    bodyGeo.translate(0, 0.07, 0);
    this.bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 160);
    this.bodies.count = 0;
    this.bodies.frustumCulled = false;
    for (let i = 0; i < 160; i++) this.bodies.setColorAt(i, this.col.setHex(0xffffff));
    this.group.add(this.bodies);

    this.muzzleLight = new THREE.PointLight(0xffc870, 0, 9, 1.6);
    this.group.add(this.muzzleLight);
  }

  /** Muzzle height above ground for tracers. */
  private static readonly MUZZLE_Y = 0.76;

  handle(events: SimEvent[], controlled: number): void {
    for (const e of events) {
      if (e.type === 'shot') {
        const t = this.tracers[this.nextTracer++ % this.tracers.length];
        const y0 = this.map.heightAt(e.fromX, e.fromZ) + Fx.MUZZLE_Y;
        const y1 = this.map.heightAt(e.toX, e.toZ) + (e.hit ? 0.7 : 0.5);
        const from = new THREE.Vector3(e.fromX, y0, e.fromZ);
        const to = new THREE.Vector3(e.toX, y1, e.toZ);
        const len = from.distanceTo(to);
        t.mesh.position.copy(from);
        t.mesh.lookAt(to);
        t.mesh.scale.set(1, 1, len);
        t.mesh.visible = true;
        t.life = t.max;
        if (!e.hit) this.puff(e.toX, y1 - 0.3, e.toZ, 0xcdbb98, 0.35);
        if (e.unit === controlled) {
          this.muzzleLight.position.set(e.fromX, y0 + 0.1, e.fromZ);
          this.muzzleLife = 0.05;
        }
      } else if (e.type === 'death') {
        this.puff(e.x, this.map.heightAt(e.x, e.z) + 0.4, e.z, 0x9c8f7a, 0.6);
        this.addBody(e.x, e.z, e.owner, e.unit);
      }
    }
  }

  private puff(x: number, y: number, z: number, color: number, life: number): void {
    const p = this.puffs[this.nextPuff++ % this.puffs.length];
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(0.6);
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    p.mesh.visible = true;
    p.max = p.life = life;
  }

  private addBody(x: number, z: number, owner: number, seed: number): void {
    const i = this.bodyCursor++ % 160;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (seed * 2.399) % (Math.PI * 2));
    m.compose(new THREE.Vector3(x, this.map.heightAt(x, z), z), q, new THREE.Vector3(1, 1, 1));
    this.bodies.setMatrixAt(i, m);
    this.col.setHex(TEAM_COLORS[owner] ?? 0xffffff).multiplyScalar(0.55);
    this.bodies.setColorAt(i, this.col);
    this.bodyCount = Math.min(160, this.bodyCount + 1);
    this.bodies.count = this.bodyCount;
    this.bodies.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
  }

  moveMarker(x: number, z: number): void {
    const m = this.markers[this.nextMarker++ % this.markers.length];
    m.mesh.position.set(x, this.map.heightAt(x, z) + 0.08, z);
    m.mesh.visible = true;
    m.life = m.max;
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.mesh.scale.setScalar(0.6 + k * 1.6);
      p.mesh.position.y += dt * 0.5;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (p.life <= 0) p.mesh.visible = false;
    }
    for (const m of this.markers) {
      if (!m.mesh.visible) continue;
      m.life -= dt;
      const k = 1 - m.life / m.max;
      m.mesh.scale.setScalar(1 + k * 1.5);
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (m.life <= 0) m.mesh.visible = false;
    }
    this.muzzleLife -= dt;
    this.muzzleLight.intensity = this.muzzleLife > 0 ? 6 : 0;
  }
}
