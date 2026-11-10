import * as THREE from 'three';
import type { Sim, SimEvent } from '../sim/sim';
import { CameraDirector, OtsCameraRig, RtsCameraRig } from './cameras';
import { DayNight } from './daynight';
import { Fx } from './fx';
import type { Structure, StructureKind } from '../sim/structures';
import { PlacementGhost, SelectionFrame, StructureRenderer, WallLineGhost } from './structures';
import { buildScatter, buildTerrain, buildWater, LightOverlay, TreeRenderer } from './terrain';
import { UNIT_TYPES } from '../sim/unitTypes';
import { UnitRenderer } from './units';

export interface Quality {
  name: 'low' | 'high';
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  maxFloodlights: number;
}

export function detectQuality(): Quality {
  const params = new URLSearchParams(location.search);
  const forced = params.get('quality');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const low = forced ? forced === 'low' : coarse || (navigator.hardwareConcurrency ?? 8) <= 4;
  return low
    ? { name: 'low', pixelRatio: Math.min(devicePixelRatio, 1.5), antialias: false, shadows: false, maxFloodlights: 4 }
    : { name: 'high', pixelRatio: Math.min(devicePixelRatio, 2), antialias: true, shadows: true, maxFloodlights: 8 };
}

export interface FrameState {
  alpha: number;
  dt: number;
  selected: ReadonlySet<number>;
  /** Possessed unit id or -1. */
  controlled: number;
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
  readonly structures: StructureRenderer;
  readonly trees: TreeRenderer;
  readonly ghost: PlacementGhost;
  readonly wallGhost: WallLineGhost;
  readonly selectionFrame: SelectionFrame;
  readonly lightOverlay: LightOverlay;
  /** Viewing team (enemies it can't see are hidden). */
  team = 1;
  /** True while looking through night-vision optics. */
  nvg = false;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private eye = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
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

    this.terrain = buildTerrain(sim.map);
    this.scene.add(this.terrain, buildWater(sim.map), buildScatter(sim.map));
    this.lightOverlay = new LightOverlay(sim.map, this.terrain);
    this.scene.add(this.lightOverlay.mesh);
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
    this.fx = new Fx(sim.map);
    this.scene.add(this.fx.group);
    this.dayNight = new DayNight(this.scene, this.structures, quality.shadows);

    this.rts = new RtsCameraRig(sim.map);
    this.ots = new OtsCameraRig(sim.map);
    this.director = new CameraDirector(this.camera);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(f: FrameState): void {
    this.structures.handle(f.events);
    for (const e of f.events) if (e.type === 'treeFelled') this.trees.fell(e.index);
    this.fx.handle(f.events, f.controlled);
    this.fx.update(f.dt);

    let fov = 40;
    if (f.controlled >= 0 && this.sim.units.isAlive(f.controlled)) {
      const p = this.units.unitPosition(f.controlled, f.alpha, this.tmp);
      this.ots.update(p, this.eye, this.look);
      fov = this.ots.aiming ? 38 : 62;
      // Flashlight from just above the shoulder along the aim direction.
      this.tmp2.copy(p).add(this.ots.forward(this.look.clone()).multiplyScalar(14));
      this.tmp2.y = this.sim.map.heightAt(this.tmp2.x, this.tmp2.z);
      this.dayNight.setFlashlight(true, this.tmp.clone().setY(p.y + 1.2), this.tmp2);
    } else {
      this.rts.update(f.dt, this.eye, this.look);
      this.dayNight.setFlashlight(false, this.eye, this.look);
    }
    this.director.apply(f.dt, this.eye, this.look, fov);

    // Night-vision optics when possessing a unit that has them.
    const c = f.controlled;
    this.nvg = c >= 0 && this.sim.units.isAlive(c) && UNIT_TYPES[this.sim.units.kind[c]].nightVision >= 0.8 && this.dayNight.night > 0.3;
    this.dayNight.nvg = this.nvg;
    const focus = f.controlled >= 0 ? this.tmp.copy(this.director.look) : this.rts.target;
    this.dayNight.update(this.sim.cycle, focus);
    const fog = this.scene.fog as THREE.Fog;
    const camDist = this.camera.position.distanceTo(this.director.look);
    fog.near = camDist * 1.4 + 10;
    fog.far = camDist * 3.2 + 60;

    const vision = this.sim.vision;
    this.lightOverlay.update(vision.light, vision.lightVersion, this.dayNight.night);
    this.fx.updateFlares(vision.flares, this.dayNight.night);
    const team = this.team;
    const owner = this.sim.units.owner;
    const seen = vision.seen[team];
    this.units.update({
      alpha: f.alpha,
      dt: f.dt,
      selected: f.selected,
      cameraQuat: this.camera.quaternion,
      visible: (i) => owner[i] === team || seen[i] === 1,
    });
    this.renderer.toneMappingExposure = this.nvg ? 1 + 0.8 * this.dayNight.night : 1;
    this.renderer.render(this.scene, this.camera);
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
