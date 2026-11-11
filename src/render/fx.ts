import * as THREE from 'three';
import { UNIT_TYPES } from '../sim/unitTypes';
import type { GameMap } from '../sim/map';
import type { SimEvent } from '../sim/sim';
import type { Flare } from '../sim/vision';
import { FLARE_SEC } from '../sim/vision';
import { COLORS, TEAM_COLORS } from './palette';
import { Particles } from './particles';

interface Timed {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

/** Pooled effects: tracers, smoke/dust/fire particles, shells, move markers, fallen soldiers. */
export class Fx {
  readonly group = new THREE.Group();
  private tracers: Timed[] = [];
  private markers: Timed[] = [];
  private nextTracer = 0;
  private nextMarker = 0;
  readonly particles: Particles;
  private bodies: THREE.InstancedMesh;
  private bodyCount = 0;
  private bodyCursor = 0;
  private col = new THREE.Color();
  /** Point light used for the possessed unit's muzzle flash. */
  readonly muzzleLight: THREE.PointLight;
  private muzzleLife = 0;
  readonly blastLight: THREE.PointLight;
  private blastLife = 0;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private flareMeshes: THREE.Mesh[] = [];
  /** Howitzer shells in flight: arc from gun to impact. */
  private shells: { mesh: THREE.Mesh; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t: number; T: number }[] = [];
  private shellGeo = new THREE.SphereGeometry(0.12, 6, 4);
  private shellMat = new THREE.MeshBasicMaterial({ color: 0x2a2620 });
  private flareLights: THREE.PointLight[] = [];

  constructor(
    private map: GameMap,
    low = false,
  ) {
    this.particles = new Particles(map, low);
    this.group.add(this.particles.group);
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

    this.blastLight = new THREE.PointLight(0xffa050, 0, 18, 1.4);
    this.group.add(this.blastLight);

    const flareGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const flareMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(flareGeo, flareMat);
      m.visible = false;
      this.group.add(m);
      this.flareMeshes.push(m);
    }
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xfff0c0, 0, 26, 1.2);
      this.group.add(l);
      this.flareLights.push(l);
    }
  }

  /** `turret`: centre of the gun tower you're aiming by hand (its shots get the muzzle flash). */
  handle(events: SimEvent[], controlled: number, turret: { x: number; z: number } | null = null): void {
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
          if (!e.hit) this.particles.impact(e.toX, e.toY - 0.3, e.toZ);
          this.particles.muzzleFlash(e.fromX, e.fromY, e.fromZ);
          const mine =
            (controlled >= 0 && e.unit === controlled) ||
            (turret !== null && e.unit === -1 && Math.hypot(e.fromX - turret.x, e.fromZ - turret.z) < 1.6);
          if (mine) {
            this.muzzleLight.position.set(e.fromX, e.fromY + 0.1, e.fromZ);
            this.muzzleLife = 0.05;
          }
          break;
        }
        case 'death':
          if (UNIT_TYPES[e.kind]?.vehicle) {
            // A vehicle brews up: fireball, then the wreck burns for a while.
            this.flash(e.x, e.z);
            this.particles.vehicleKill(e.x, e.z);
            break;
          }
          if (UNIT_TYPES[e.kind]?.fly) {
            // A drone shot down: a puff of smoke where it was, then it drops out of the sky.
            this.particles.droneDown(e.x, e.y, e.z);
            this.flash(e.x, e.z);
            break;
          }
          this.particles.bodyFall(e.x, e.y, e.z);
          this.addBody(e.x, e.z, e.y, e.owner, e.unit);
          break;
        case 'explosion':
          this.flash(e.x, e.z);
          this.particles.explosion(e.x, e.z);
          break;
        case 'shell': {
          // Muzzle blast at the gun, then a shell arcing toward the target.
          this.particles.gunBlast(e.fromX, e.fromY + 0.4, e.fromZ);
          let s = this.shells.find((x) => !x.mesh.visible);
          if (!s) {
            const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
            this.group.add(mesh);
            s = { mesh, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, t: 0, T: 1 };
            this.shells.push(s);
          }
          Object.assign(s, { fx: e.fromX, fy: e.fromY, fz: e.fromZ, tx: e.toX, ty: e.toY, tz: e.toZ, t: 0, T: e.flight });
          s.mesh.visible = true;
          break;
        }
        case 'ignited': {
          const y = this.map.heightAt(e.x, e.z);
          for (let k = 0; k < 6; k++) this.particles.flame(e.x + (Math.random() - 0.5), y, e.z + (Math.random() - 0.5), 1.3);
          break;
        }
        case 'structureDamaged':
          if (Math.random() < 0.25) this.particles.chip(e.x + (Math.random() - 0.5), this.map.heightAt(e.x, e.z) + 1, e.z + (Math.random() - 0.5));
          break;
        case 'structureDestroyed':
          this.particles.collapse(e.x, e.z, 1);
          break;
      }
    }
  }

  /** The light of a blast on its surroundings. */
  private flash(x: number, z: number): void {
    this.blastLight.position.set(x, this.map.heightAt(x, z) + 1.6, z);
    this.blastLife = 0.25;
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

  /** Flares drift down on their parachutes while they burn. */
  updateFlares(flares: readonly Flare[], night: number): void {
    this.flareMeshes.forEach((m, i) => {
      const f = flares[i];
      m.visible = !!f;
      if (!f) return;
      const k = f.ttl / FLARE_SEC;
      m.position.set(f.x, this.map.heightAt(f.x, f.z) + 2 + 8 * k, f.z);
      m.scale.setScalar(0.8 + Math.random() * 0.4);
    });
    this.flareLights.forEach((l, i) => {
      const f = flares[i];
      l.intensity = f ? 40 * Math.min(1, f.ttl / 4) * Math.max(0.25, night) : 0;
      if (f) l.position.copy(this.flareMeshes[i].position);
    });
  }

  /** `dt`: real time (tracers, markers); `gameDt`: game time (particles freeze while paused). */
  update(dt: number, gameDt: number, cam: THREE.Camera): void {
    this.particles.update(gameDt, cam);
    for (const s of this.shells) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      const k = Math.min(1, s.t / s.T);
      const d = Math.hypot(s.tx - s.fx, s.tz - s.fz);
      s.mesh.position.set(
        s.fx + (s.tx - s.fx) * k,
        s.fy + (s.ty - s.fy) * k + 4 * (d * 0.28) * k * (1 - k),
        s.fz + (s.tz - s.fz) * k,
      );
      if (k >= 1) s.mesh.visible = false;
    }
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
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
    this.blastLife -= dt;
    this.blastLight.intensity = this.blastLife > 0 ? 80 * (this.blastLife / 0.25) : 0;
  }
}
