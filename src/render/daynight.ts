import * as THREE from 'three';
import type { CycleInfo } from '../sim/clock';
import type { StructureRenderer } from './structures';

const DAY_SKY = new THREE.Color(0xdcccab);
const DUSK_SKY = new THREE.Color(0xd98a5c);
const NIGHT_SKY = new THREE.Color(0x0a0f1e);
const HEMI_SKY_DAY = new THREE.Color(0xc9dcff);
const HEMI_GROUND_DAY = new THREE.Color(0xb08a5a);
const HEMI_SKY_NIGHT = new THREE.Color(0x30406a);
const HEMI_GROUND_NIGHT = new THREE.Color(0x14110d);
const SUN_LOW = new THREE.Color(0xffa25e);
const SUN_HIGH = new THREE.Color(0xfff4e2);

/** Drives sun/moon/ambient/fog/background and artificial lights from the sim clock. */
export class DayNight {
  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Flashlight on the possessed unit (on at night). */
  readonly flashlight: THREE.SpotLight;
  /** Night-vision optics on: lift the ambient light (the HUD adds the green phosphor tint). */
  nvg = false;
  /** 0 = full day, 1 = full night (smoothed). */
  night = 0;
  /** 0..1: artificial lights fade in as daylight fades. */
  lightsOn = 0;
  private sky = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    private structures: StructureRenderer,
    shadows: boolean,
  ) {
    this.hemi = new THREE.HemisphereLight(HEMI_SKY_DAY, HEMI_GROUND_DAY, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -40;
      c.right = c.top = 40;
      c.near = 1;
      c.far = 200;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.03;
    }
    this.moon = new THREE.DirectionalLight(0x8aa4ff, 0);
    this.moon.position.set(-40, 80, -20);
    this.flashlight = new THREE.SpotLight(0xf4f0ff, 0, 22, 0.42, 0.5, 1.2);
    scene.add(this.hemi, this.sun, this.sun.target, this.moon, this.moon.target, this.flashlight, this.flashlight.target);
    scene.fog = new THREE.Fog(DAY_SKY.getHex(), 60, 160);
  }

  update(info: CycleInfo, focus: THREE.Vector3): void {
    const daylight = info.daylight;
    // Ease so dusk/dawn feel like a quick fade rather than linear.
    const d = daylight * daylight * (3 - 2 * daylight);
    this.night = 1 - d;

    // Sun arc: rises ~06:00 in the east (+x), sets ~20:00 in the west.
    const t = (info.hour - 6) / 14;
    const elev = Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)) * 1.15 + 0.08;
    const az = Math.PI * t;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), 0.45);
    this.sun.position.copy(focus).addScaledVector(dir.normalize(), 90);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(SUN_LOW).lerp(SUN_HIGH, Math.min(1, elev / 0.8));
    this.sun.intensity = 2.7 * d;

    this.moon.target.position.copy(focus);
    this.moon.position.copy(focus).add(new THREE.Vector3(-30, 70, -25));
    this.moon.intensity = 0.55 * this.night;

    this.hemi.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, this.night);
    this.hemi.groundColor.copy(HEMI_GROUND_DAY).lerp(HEMI_GROUND_NIGHT, this.night);
    this.hemi.intensity = 1.25 - this.night * 0.9;
    if (this.nvg) {
      // Image intensifier: amplify the starlight into a flat, bright (green-tinted in CSS) picture.
      this.hemi.intensity = Math.max(this.hemi.intensity, 1.1);
      this.hemi.color.copy(HEMI_SKY_DAY);
      this.hemi.groundColor.copy(HEMI_GROUND_DAY);
      this.moon.intensity = Math.max(this.moon.intensity, 0.9);
    }

    // Sky/fog: day → warm dusk tint → night.
    const duskAmount = info.phase === 'dusk' || info.phase === 'dawn' ? Math.sin(Math.PI * info.phaseT) : 0;
    this.sky.copy(DAY_SKY).lerp(NIGHT_SKY, this.night).lerp(DUSK_SKY, duskAmount * 0.55);
    (this.scene.background as THREE.Color | null)?.copy(this.sky);
    if (!this.scene.background) this.scene.background = this.sky.clone();
    (this.scene.fog as THREE.Fog).color.copy(this.sky);

    // Artificial lights switch on as daylight fades.
    const lightsOn = Math.min(1, Math.max(0, (0.65 - daylight) / 0.4));
    this.structures.update(lightsOn);
    this.lightsOn = lightsOn;
    this.structures.lampMaterial.emissiveIntensity = 2.2 * lightsOn;
    this.structures.windowMaterial.emissiveIntensity = 0.9 * lightsOn;
  }

  setFlashlight(on: boolean, pos: THREE.Vector3, target: THREE.Vector3): void {
    this.flashlight.intensity = on ? 45 * this.night : 0;
    this.flashlight.position.copy(pos);
    this.flashlight.target.position.copy(target);
  }
}
