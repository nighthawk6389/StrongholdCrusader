import * as THREE from 'three';
import type { GameMap } from '../sim/map';

const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Classic RTS camera: orbits a ground target at a zoom-dependent pitch. */
export class RtsCameraRig {
  readonly target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  yaw = 0;
  private goalYaw = 0;
  dist = 44;
  private goalDist = 44;
  readonly minDist = 8;
  readonly maxDist = 85;

  constructor(private map: GameMap) {}

  jumpTo(x: number, z: number): void {
    this.goal.set(x, 0, z);
    this.target.set(x, this.map.heightAt(x, z), z);
  }

  lookAtSoft(x: number, z: number): void {
    this.goal.set(x, 0, z);
  }

  /** Screen-relative pan in world units: +right, +up (away from camera). */
  pan(right: number, up: number): void {
    const s = Math.sin(this.goalYaw);
    const c = Math.cos(this.goalYaw);
    // right = (cos, -sin), up/forward = (-sin, -cos)
    this.goal.x += right * c - up * s;
    this.goal.z += -right * s - up * c;
    this.clampGoal();
  }

  /** Pan by a world-space delta (used for touch "grab" panning). */
  panWorld(dx: number, dz: number): void {
    this.goal.x += dx;
    this.goal.z += dz;
    this.clampGoal();
  }

  zoom(factor: number): void {
    this.goalDist = Math.min(this.maxDist, Math.max(this.minDist, this.goalDist * factor));
  }

  rotate(dyaw: number): void {
    this.goalYaw += dyaw;
  }

  private clampGoal(): void {
    this.goal.x = Math.min(Math.max(this.goal.x, 0), this.map.width);
    this.goal.z = Math.min(Math.max(this.goal.z, 0), this.map.height);
  }

  pitch(): number {
    const t = (this.dist - this.minDist) / (this.maxDist - this.minDist);
    return 0.72 + t * 0.36;
  }

  /** Advance smoothing; write the desired eye/look points. */
  update(dt: number, eye: THREE.Vector3, look: THREE.Vector3): void {
    const k = damp(14, dt);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    this.target.y += (this.map.heightAt(this.target.x, this.target.z) - this.target.y) * k;
    this.yaw += (this.goalYaw - this.yaw) * damp(12, dt);
    this.dist += (this.goalDist - this.dist) * damp(10, dt);
    const p = this.pitch();
    eye.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(p) * this.dist,
      this.target.y + Math.sin(p) * this.dist,
      this.target.z + Math.cos(this.yaw) * Math.cos(p) * this.dist,
    );
    look.copy(this.target);
  }
}

/** Over-the-shoulder camera for a possessed unit. */
export class OtsCameraRig {
  yaw = 0;
  pitch = -0.08;
  aiming = false;

  constructor(private map: GameMap) {}

  addLook(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.min(0.55, Math.max(-0.6, this.pitch + dPitch));
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(unitPos: THREE.Vector3, eye: THREE.Vector3, look: THREE.Vector3): void {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    const back = this.aiming ? 1.25 : 2.3;
    const side = this.aiming ? 0.42 : 0.6;
    const up = this.aiming ? 1.15 : 1.3;
    // Camera boom: shorten it if a wall/building/rock sits between the unit and the camera.
    // (Units up on a wall or tower already look over everything around them.)
    const ex = -fx * back + rx * side;
    const ez = -fz * back + rz * side;
    const boom = Math.hypot(ex, ez);
    const elevated = unitPos.y - this.map.heightAt(unitPos.x, unitPos.z) > 0.5;
    let k = 1;
    for (let t = 0.1; !elevated && t <= boom + 0.3; t += 0.1) {
      const f = t / boom;
      if (!this.map.isWalkable(unitPos.x + ex * f, unitPos.z + ez * f)) {
        k = Math.max(0.12, (t - 0.35) / boom);
        break;
      }
    }
    // Pitch also raises/lowers the camera a little so looking up/down feels natural.
    eye.set(unitPos.x + ex * k, unitPos.y + up - this.pitch * 0.9, unitPos.z + ez * k);
    const ground = this.map.heightAt(eye.x, eye.z) + 0.35;
    if (eye.y < ground) eye.y = ground;
    look.set(
      unitPos.x + rx * side + fx * 20 * Math.cos(this.pitch),
      unitPos.y + 1.0 + Math.sin(this.pitch) * 20,
      unitPos.z + rz * side + fz * 20 * Math.cos(this.pitch),
    );
  }
}

/** Smoothly moves the real camera toward desired eye/look points (gives mode-switch swoops). */
export class CameraDirector {
  readonly eye = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  private initialized = false;
  private swoop = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  startSwoop(): void {
    this.swoop = 0.6;
  }

  apply(dt: number, eye: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    if (!this.initialized) {
      this.eye.copy(eye);
      this.look.copy(look);
      this.initialized = true;
    }
    const rate = this.swoop > 0 ? 7 : 40;
    this.swoop = Math.max(0, this.swoop - dt);
    const k = damp(rate, dt);
    this.eye.lerp(eye, k);
    this.look.lerp(look, k);
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * damp(10, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
