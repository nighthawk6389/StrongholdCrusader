import * as THREE from 'three';
import type { Sim, SimEvent } from '../sim/sim';
import { CameraDirector, OtsCameraRig, RtsCameraRig } from './cameras';
import { getSettings } from '../game/settings';
import { DayNight } from './daynight';
import { Fx } from './fx';
import { STRUCTURE_DEFS, maxHp, type Structure, type StructureKind } from '../sim/structures';
import { PlacementGhost, SelectionFrame, StructureRenderer, WallLineGhost } from './structures';
import { buildScatter, buildSkirt, buildTerrain, TreeRenderer, WaterRenderer } from './terrain';
import { GroundSurface } from './ground';
import { PostFx } from './post';
import { UNIT_TYPES } from '../sim/unitTypes';
import { UnitRenderer } from './units';

export interface Quality {
  name: 'low' | 'high';
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  maxFloodlights: number;
  /** Post-processing: ambient occlusion, bloom, colour grade (high quality only, can be switched off). */
  post: boolean;
}

export function detectQuality(): Quality {
  const params = new URLSearchParams(location.search);
  const chosen = getSettings().quality;
  const forced = params.get('quality') ?? (chosen === 'auto' ? null : chosen);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const low = forced ? forced === 'low' : coarse || (navigator.hardwareConcurrency ?? 8) <= 4;
  const post = params.get('post') ? params.get('post') === '1' : getSettings().effects;
  return low
    ? { name: 'low', pixelRatio: Math.min(devicePixelRatio, 1.5), antialias: false, shadows: false, maxFloodlights: 4, post: false }
    : { name: 'high', pixelRatio: Math.min(devicePixelRatio, 2), antialias: true, shadows: true, maxFloodlights: 8, post };
}

export interface FrameState {
  alpha: number;
  dt: number;
  /** Game time this frame (0 while paused; scaled by game speed). Defaults to dt. */
  gameDt?: number;
  selected: ReadonlySet<number>;
  /** Possessed unit id or -1. */
  controlled: number;
  /** Gun tower / searchlight being aimed by hand, or -1. */
  controlledStruct: number;
  events: SimEvent[];
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rts: RtsCameraRig;
  readonly ots: OtsCameraRig;
  readonly director: CameraDirector;
  readonly units: UnitRenderer;
  readonly fx: Fx;
  readonly dayNight: DayNight;
  readonly terrain: THREE.Mesh;
  readonly ground: GroundSurface;
  readonly water: WaterRenderer;
  /** High-quality post-processing, or null (plain render). */
  readonly post: PostFx | null;
  readonly structures: StructureRenderer;
  readonly trees: TreeRenderer;
  readonly ghost: PlacementGhost;
  readonly wallGhost: WallLineGhost;
  readonly selectionFrame: SelectionFrame;
  /** Viewing team (enemies it can't see are hidden). */
  team = 1;
  /** True while looking through night-vision optics. */
  nvg = false;
  /** Player's night-vision switch (N). */
  nvgEnabled = true;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private eye = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** Sim tick of the last ground-wear pass. */
  private wearTick = 0;
  private clock = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private sim: Sim,
    readonly quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.scene.background = new THREE.Color(0xdcccab);

    this.ground = new GroundSurface(sim.map, quality.name);
    this.terrain = buildTerrain(sim.map, this.ground);
    this.water = new WaterRenderer(sim.map);
    this.scene.add(this.terrain, buildSkirt(sim.map, this.ground), this.water.group, buildScatter(sim.map));
    this.trees = new TreeRenderer(sim.map);
    this.scene.add(this.trees.group);
    this.structures = new StructureRenderer(sim, quality.maxFloodlights);
    this.scene.add(this.structures.group);
    this.ghost = new PlacementGhost(sim);
    this.wallGhost = new WallLineGhost(sim);
    this.selectionFrame = new SelectionFrame(sim);
    this.scene.add(this.ghost.group, this.wallGhost.mesh, this.selectionFrame.group);

    this.units = new UnitRenderer(sim, quality.shadows);
    this.scene.add(this.units.group);
    this.fx = new Fx(sim.map, quality.name === 'low');
    this.scene.add(this.fx.group);
    this.dayNight = new DayNight(this.scene, this.structures, quality.shadows);

    this.rts = new RtsCameraRig(sim.map);
    this.ots = new OtsCameraRig(sim.map);
    this.director = new CameraDirector(this.camera);
    this.post = quality.post ? new PostFx(this.renderer, this.scene, this.camera) : null;
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(f: FrameState): void {
    this.structures.handle(f.events);
    for (const e of f.events) if (e.type === 'treeFelled') this.trees.fell(e.index);
    const cs = f.controlledStruct >= 0 ? this.sim.structureById(f.controlledStruct) : undefined;
    this.fx.handle(f.events, f.controlled, cs ? { x: cs.tx + cs.w / 2, z: cs.tz + cs.h / 2 } : null);
    const gdt = f.gameDt ?? f.dt;
    this.fx.update(f.dt, gdt, this.camera);
    this.ambientFx(gdt);
    this.updateGround(f.events);

    let fov = 40;
    if (f.controlled >= 0 && this.sim.units.isAlive(f.controlled)) {
      const t = UNIT_TYPES[this.sim.units.kind[f.controlled]];
      const p = this.units.unitPosition(f.controlled, f.alpha, this.tmp);
      this.ots.mode = t.fly ? 'drone' : t.vehicle ? 'vehicle' : 'soldier';
      this.ots.update(p, this.eye, this.look);
      fov = this.ots.aiming ? 62 / t.zoom : 62;
      if (!t.fly && !t.vehicle) {
        // Flashlight from just above the shoulder along the aim direction.
        this.tmp2.copy(p).add(this.ots.forward(this.look.clone()).multiplyScalar(14));
        this.tmp2.y = this.sim.map.heightAt(this.tmp2.x, this.tmp2.z);
        this.dayNight.setFlashlight(true, this.tmp.clone().setY(p.y + 1.2), this.tmp2);
      } else {
        this.dayNight.setFlashlight(false, this.eye, this.look);
      }
    } else if (cs) {
      // Stand behind the gun (or the lamp) on top of the tower.
      const def = STRUCTURE_DEFS[cs.kind];
      const cx = cs.tx + cs.w / 2;
      const cz = cs.tz + cs.h / 2;
      const p = this.tmp.set(cx, this.sim.map.heightAt(cx, cz) + (def.deckH ?? 2.3) + 0.45, cz);
      this.ots.mode = 'turret';
      this.ots.update(p, this.eye, this.look);
      fov = this.ots.aiming ? 62 / 2.2 : 62;
      this.dayNight.setFlashlight(false, this.eye, this.look);
    } else {
      this.rts.update(f.dt, this.eye, this.look);
      this.dayNight.setFlashlight(false, this.eye, this.look);
    }
    this.director.apply(f.dt, this.eye, this.look, fov);

    // Night-vision optics when possessing a unit that has them (and they're switched on).
    const c = f.controlled;
    this.nvg =
      this.nvgEnabled && c >= 0 && this.sim.units.isAlive(c) && UNIT_TYPES[this.sim.units.kind[c]].nightVision >= 0.8 && this.dayNight.night > 0.3;
    this.dayNight.nvg = this.nvg;
    const focus = f.controlled >= 0 ? this.tmp.copy(this.director.look) : this.rts.target;
    this.dayNight.update(this.sim.cycle, focus);
    this.dayNight.followCamera(this.camera.position);
    this.clock += f.dt;
    this.water.update(this.clock, (this.scene.fog as THREE.Fog).color);
    const fog = this.scene.fog as THREE.Fog;
    const camDist = this.camera.position.distanceTo(this.director.look);
    fog.near = camDist * 1.4 + 10;
    fog.far = camDist * 3.2 + 60;

    const vision = this.sim.vision;
    this.ground.setLight(vision.light, vision.lightVersion, this.dayNight.night);
    this.fx.updateFlares(vision.flares, this.dayNight.night);
    this.fx.particles.setLight(this.nvg ? 1.6 : 1 - 0.82 * this.dayNight.night);
    const team = this.team;
    const u = this.sim.units;
    const owner = u.owner;
    const seen = vision.seen[team];
    // Aiming a tower's gun yourself: the crew up there would be in your face, so hide them.
    const crewed = (i: number): boolean =>
      !!cs && u.layer[i] === 1 && u.x[i] >= cs.tx && u.x[i] < cs.tx + cs.w && u.z[i] >= cs.tz && u.z[i] < cs.tz + cs.h;
    this.units.update({
      alpha: f.alpha,
      dt: f.dt,
      selected: f.selected,
      cameraQuat: this.camera.quaternion,
      visible: (i) => (owner[i] === team || seen[i] === 1) && !crewed(i),
    });
    this.renderer.toneMappingExposure = this.nvg ? 1 + 0.8 * this.dayNight.night : 1;
    if (this.post) this.post.render(f.dt, this.nvg ? 0 : this.dayNight.night);
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Effects that run on their own: burning fuel trenches, smoke from badly damaged buildings,
   * factory chimneys and the hub's cooking fire, dust behind moving vehicles.
   */
  private ambientFx(dt: number): void {
    if (dt <= 0) return;
    const p = this.fx.particles;
    const sim = this.sim;
    const map = sim.map;
    const chance = (rate: number): boolean => Math.random() < rate * dt;
    for (const s of sim.structures) {
      if (s.kind === 'mines') continue;
      const cx = s.tx + s.w / 2;
      const cz = s.tz + s.h / 2;
      if (s.burn > 0) {
        const y = map.heightAt(cx, cz);
        if (chance(9)) p.flame(s.tx + Math.random(), y, s.tz + Math.random(), 1.1);
        if (chance(1.2)) p.blackSmoke(cx, y + 0.8, cz, 0.7);
        continue;
      }
      const big = s.w * s.h >= 4;
      const hurt = s.hp / maxHp(s);
      if (big && hurt < 0.45) {
        const y = map.heightAt(cx, cz) + 1.4;
        if (hurt < 0.2) {
          if (chance(10)) p.flame(cx + (Math.random() - 0.5) * s.w * 0.6, y, cz + (Math.random() - 0.5) * s.h * 0.6, 1.8);
          if (chance(3)) p.blackSmoke(cx, y + 0.6, cz, 1.1);
        } else if (chance(1.6)) {
          p.greySmoke(cx + (Math.random() - 0.5), y, cz + (Math.random() - 0.5), 1, 3.5);
        }
      }
      if (s.kind === 'arms' && s.active && s.workers.length > 0 && chance(1.4)) {
        p.greySmoke(cx - 0.9, map.heightAt(cx, cz) + 2.85, cz - 0.9, 0.7, 4);
      } else if (s.kind === 'hub' && chance(0.7)) {
        p.greySmoke(cx + 0.3, map.heightAt(cx, cz) + 0.5, cz + 0.45, 0.4, 2.5);
      }
    }
    // Vehicles throw up dust when they drive over sand.
    const u = sim.units;
    const seen = sim.vision.seen[this.team];
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.layer[i] !== 0) continue;
      const t = UNIT_TYPES[u.kind[i]];
      if (!t.vehicle || t.fly) continue;
      if (u.owner[i] !== this.team && seen[i] !== 1) continue;
      const dx = u.x[i] - u.px[i];
      const dz = u.z[i] - u.pz[i];
      const sp = Math.hypot(dx, dz);
      if (sp < 0.02 || !chance(14 * Math.min(1, sp / 0.12))) continue;
      const bx = u.x[i] - (dx / sp) * 0.9;
      const bz = u.z[i] - (dz / sp) * 0.9;
      p.dust(bx + (Math.random() - 0.5) * 0.6, map.heightAt(bx, bz) + 0.15, bz + (Math.random() - 0.5) * 0.6, 0.55, 0.4, 1.4);
    }
  }

  /** Scorch marks from blasts; every half second of game time, units wear the ground where they stand. */
  private updateGround(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'explosion') this.ground.scorchAt(e.x, e.z, 1.5);
      else if (e.type === 'death' && UNIT_TYPES[e.kind]?.vehicle) this.ground.scorchAt(e.x, e.z, 2.2);
    }
    const sim = this.sim;
    const ticks = sim.tick - this.wearTick;
    if (ticks < 0) this.wearTick = sim.tick;
    if (ticks < 10) {
      this.ground.update(0, sim.structures);
      return;
    }
    this.wearTick = sim.tick;
    const k = Math.min(ticks, 40) / 10;
    const u = sim.units;
    const seen = sim.vision.seen[this.team];
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.layer[i] !== 0) continue;
      if (u.owner[i] !== this.team && seen[i] !== 1) continue;
      const t = UNIT_TYPES[u.kind[i]];
      if (t.fly) continue;
      this.ground.wearAt(u.x[i], u.z[i], (t.vehicle ? 0.05 : 0.014) * k);
    }
    this.ground.update(ticks * 0.05, sim.structures);
  }

  /** The ray through the crosshair (screen centre): camera position plus yaw/pitch. */
  aimRay(): { yaw: number; pitch: number; ex: number; ey: number; ez: number } {
    const d = this.camera.getWorldDirection(this.tmp2);
    const p = this.camera.position;
    return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))), ex: p.x, ey: p.y, ez: p.z };
  }

  /** World ground point under a client-space pixel, or null. */
  pickGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    const map = this.sim.map;
    if (d.y >= -1e-4) return null;
    let t = Math.max(0, (o.y - 4) / -d.y);
    const step = 0.4;
    let prevT = t;
    for (let i = 0; i < 2000; i++, t += step) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (y < -6) break;
      if (y <= map.heightAt(x, z)) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 10; k++) {
          const mid = (lo + hi) / 2;
          const my = o.y + d.y * mid;
          if (my <= map.heightAt(o.x + d.x * mid, o.z + d.z * mid)) hi = mid;
          else lo = mid;
        }
        const out = new THREE.Vector3(o.x + d.x * hi, 0, o.z + d.z * hi);
        if (out.x < 0 || out.z < 0 || out.x > map.width || out.z > map.height) return null;
        out.y = map.heightAt(out.x, out.z);
        return out;
      }
      prevT = t;
    }
    return null;
  }

  setGhost(kind: StructureKind | null, tx = 0, tz = 0, valid = false, rot = 0): void {
    this.ghost.set(kind, tx, tz, valid, rot);
  }

  /** Wall-line preview: flat [x, z, valid, ...]; empty to hide. */
  setWallGhost(tiles: number[]): void {
    this.wallGhost.set(tiles);
  }

  /**
   * Point under a client pixel, aware of wall tops: returns layer 1 when the ray hits a walkable
   * deck (wall, tower, gatehouse, stairs), otherwise the ground (layer 0).
   */
  pickPoint(clientX: number, clientY: number): { x: number; y: number; z: number; layer: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    const map = this.sim.map;
    if (d.y >= -1e-4) return null;
    let t = Math.max(0, (o.y - 7) / -d.y);
    for (let i = 0; i < 3000; i++, t += 0.15) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (y < -6) break;
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      if (!map.inBounds(tx, tz)) continue;
      const ground = map.heightAt(x, z);
      const ti = map.idx(tx, tz);
      if (map.deck[ti] && y <= ground + map.deckH[ti]) return { x, y, z, layer: 1 };
      if (y <= ground) return { x, y: ground, z, layer: 0 };
    }
    return null;
  }

  setSelectedStructure(s: Structure | undefined): void {
    this.selectionFrame.set(s);
  }

  /** Project a world point to client pixels. Returns null if behind the camera. */
  toScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    const v = this.tmp2.set(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return false;
    const rect = this.canvas.getBoundingClientRect();
    out.x = rect.left + ((v.x + 1) / 2) * rect.width;
    out.y = rect.top + ((1 - v.y) / 2) * rect.height;
    return true;
  }
}
