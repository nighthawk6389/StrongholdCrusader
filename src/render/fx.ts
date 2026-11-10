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
  private blasts: Timed[] = [];
  private nextBlast = 0;
  readonly blastLight: THREE.PointLight;
  private blastLife = 0;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();

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

    const blastGeo = new THREE.IcosahedronGeometry(0.5, 1);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        blastGeo,
        new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.visible = false;
      this.group.add(m);
      this.blasts.push({ mesh: m, life: 0, max: 0.45 });
    }
    this.blastLight = new THREE.PointLight(0xffa050, 0, 18, 1.4);
    this.group.add(this.blastLight);
  }

  handle(events: SimEvent[], controlled: number): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          const t = this.tracers[this.nextTracer++ % this.tracers.length];
          const from = this.v1.set(e.fromX, e.fromY, e.fromZ);
          const to = this.v2.set(e.toX, e.toY, e.toZ);
          const len = from.distanceTo(to);
          t.mesh.position.copy(from);
          t.mesh.lookAt(to);
          t.mesh.scale.set(1, 1, len);
          t.mesh.visible = true;
          t.life = t.max;
          if (!e.hit) this.puff(e.toX, e.toY - 0.3, e.toZ, 0xcdbb98, 0.35, 0.6);
          if (e.unit === controlled) {
            this.muzzleLight.position.set(e.fromX, e.fromY + 0.1, e.fromZ);
            this.muzzleLife = 0.05;
          }
          break;
        }
        case 'death':
          this.puff(e.x, e.y + 0.4, e.z, 0x9c8f7a, 0.6, 0.6);
          this.addBody(e.x, e.z, e.y, e.owner, e.unit);
          break;
        case 'explosion':
          this.blast(e.x, e.z);
          break;
        case 'structureDamaged':
          if (Math.random() < 0.25) this.puff(e.x + (Math.random() - 0.5), this.map.heightAt(e.x, e.z) + 1, e.z + (Math.random() - 0.5), 0xb8ad99, 0.5, 0.5);
          break;
        case 'structureDestroyed':
          for (let k = 0; k < 6; k++) {
            this.puff(e.x + (Math.random() - 0.5) * 2, this.map.heightAt(e.x, e.z) + 0.5 + Math.random(), e.z + (Math.random() - 0.5) * 2, 0x8f8576, 1.1, 1.4);
          }
          break;
      }
    }
  }

  private blast(x: number, z: number): void {
    const y = this.map.heightAt(x, z) + 0.6;
    const b = this.blasts[this.nextBlast++ % this.blasts.length];
    b.mesh.position.set(x, y, z);
    b.mesh.visible = true;
    b.life = b.max;
    this.blastLight.position.set(x, y + 1, z);
    this.blastLife = 0.25;
    for (let k = 0; k < 5; k++) this.puff(x + (Math.random() - 0.5) * 1.5, y + Math.random(), z + (Math.random() - 0.5) * 1.5, 0x5a5048, 1.2, 1.6);
  }

  private puff(x: number, y: number, z: number, color: number, life: number, size = 0.6): void {
    const p = this.puffs[this.nextPuff++ % this.puffs.length];
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(size);
    p.mesh.userData.size = size;
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    p.mesh.visible = true;
    p.max = p.life = life;
  }

  private addBody(x: number, z: number, y: number, owner: number, seed: number): void {
    const i = this.bodyCursor++ % 160;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (seed * 2.399) % (Math.PI * 2));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
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
      p.mesh.scale.setScalar((p.mesh.userData.size ?? 0.6) * (1 + k * 2.6));
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
    for (const b of this.blasts) {
      if (!b.mesh.visible) continue;
      b.life -= dt;
      const k = 1 - b.life / b.max;
      b.mesh.scale.setScalar(0.6 + k * 4);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (b.life <= 0) b.mesh.visible = false;
    }
    this.muzzleLife -= dt;
    this.muzzleLight.intensity = this.muzzleLife > 0 ? 6 : 0;
    this.blastLife -= dt;
    this.blastLight.intensity = this.blastLife > 0 ? 120 * (this.blastLife / 0.25) : 0;
  }
}
