import * as THREE from 'three';
import type { GameMap } from '../sim/map';

/**
 * Smoke, dust, fire, sparks and flying debris. Each kind of particle is a camera-facing quad drawn
 * in one instanced call (smoke and dust blended and sorted back to front, fire and sparks added
 * on top), simulated on the CPU with drag, buoyancy, gravity and a light wind. The puff and glow
 * images are painted into canvases at start-up, so there are no image files.
 */

interface Spec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  /** Size at birth and at death (world units). */
  s0: number;
  s1: number;
  /** Colour at birth and at death (linear; above 1 glows on high quality). */
  c0: number | [number, number, number];
  c1?: number | [number, number, number];
  /** Peak opacity. */
  a?: number;
  /** Upward acceleration (smoke rises) and gravity (sparks fall). */
  lift?: number;
  grav?: number;
  drag?: number;
  /** Share of life spent fading in. */
  fadeIn?: number;
}

const tmpC = new THREE.Color();
function rgb(c: number | [number, number, number]): [number, number, number] {
  if (typeof c !== 'number') return c;
  tmpC.setHex(c);
  return [tmpC.r, tmpC.g, tmpC.b];
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** A soft, lumpy puff (white, alpha in the image). */
function puffTexture(): THREE.Texture {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * size * 0.22;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const r = size * (0.14 + rnd() * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Fade the whole thing to nothing at the edge so quads never show.
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  edge.addColorStop(0, 'rgba(255,255,255,1)');
  edge.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A round glow, hot in the middle. */
function glowTexture(): THREE.Texture {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iCol;
  attribute vec2 iSizeRot;
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vShade;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iSizeRot.y);
    float s = sin(iSizeRot.y);
    vec2 q = position.xy * iSizeRot.x;
    mvPosition.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    vUv = uv;
    vCol = iCol;
    vShade = position.y + 0.5;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float light;
  uniform float shaded;
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vShade;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(map, vUv);
    // Smoke is lit from above (darker underneath) and dims at night; fire isn't.
    vec3 col = vCol.rgb * mix(1.0, light * mix(0.72, 1.12, vShade), shaded);
    gl_FragColor = vec4(col, t.a * vCol.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** One batch of particles of a kind (one draw call). */
class Pool {
  readonly mesh: THREE.Mesh;
  private max: number;
  count = 0;
  // Simulation state, struct-of-arrays.
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c: Float32Array;
  private a: Float32Array;
  private rot: Float32Array;
  private vrot: Float32Array;
  private lift: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private fadeIn: Float32Array;
  // GPU attributes.
  private iPos: THREE.InstancedBufferAttribute;
  private iCol: THREE.InstancedBufferAttribute;
  private iSizeRot: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private order: Uint16Array;
  private depth: Float32Array;
  readonly uniforms: { light: { value: number } };

  constructor(
    max: number,
    texture: THREE.Texture,
    private additive: boolean,
  ) {
    this.max = max;
    const f = (n = 1): Float32Array => new Float32Array(max * n);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.s0 = f();
    this.s1 = f();
    this.c = f(6);
    this.a = f();
    this.rot = f();
    this.vrot = f();
    this.lift = f();
    this.grav = f();
    this.drag = f();
    this.fadeIn = f();
    this.order = new Uint16Array(max);
    this.depth = new Float32Array(max);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iCol', this.iCol);
    this.geo.setAttribute('iSizeRot', this.iSizeRot);
    this.geo.instanceCount = 0;

    this.uniforms = { light: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture }, shaded: { value: additive ? 0 : 1 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.uniforms.map.value = texture;
    mat.uniforms.light = this.uniforms.light;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    this.mesh.userData.noAO = true;
  }

  spawn(p: Spec): void {
    let i = this.count;
    if (i >= this.max) {
      // Full: recycle the oldest-looking slot.
      i = Math.floor(Math.random() * this.max);
    } else {
      this.count++;
    }
    this.px[i] = p.x;
    this.py[i] = p.y;
    this.pz[i] = p.z;
    this.vx[i] = p.vx ?? 0;
    this.vy[i] = p.vy ?? 0;
    this.vz[i] = p.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.s0[i] = p.s0;
    this.s1[i] = p.s1;
    const c0 = rgb(p.c0);
    const c1 = rgb(p.c1 ?? p.c0);
    this.c.set(c0, i * 6);
    this.c.set(c1, i * 6 + 3);
    this.a[i] = p.a ?? 1;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.vrot[i] = (Math.random() - 0.5) * 1.2;
    this.lift[i] = p.lift ?? 0;
    this.grav[i] = p.grav ?? 0;
    this.drag[i] = p.drag ?? 1;
    this.fadeIn[i] = p.fadeIn ?? 0.1;
  }

  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.px[i] = this.px[j];
    this.py[i] = this.py[j];
    this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.vz[i] = this.vz[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.s0[i] = this.s0[j];
    this.s1[i] = this.s1[j];
    this.c.copyWithin(i * 6, j * 6, j * 6 + 6);
    this.a[i] = this.a[j];
    this.rot[i] = this.rot[j];
    this.vrot[i] = this.vrot[j];
    this.lift[i] = this.lift[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
    this.fadeIn[i] = this.fadeIn[j];
  }

  update(dt: number, wind: THREE.Vector3, ground: (x: number, z: number) => number, cam: THREE.Camera): void {
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        this.kill(i);
        i--;
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      // Rising smoke drifts with the wind; heavy sparks don't.
      const w = this.lift[i] > 0 ? dt * 0.6 : 0;
      this.vx[i] = this.vx[i] * k + wind.x * w;
      this.vz[i] = this.vz[i] * k + wind.z * w;
      this.vy[i] = this.vy[i] * k + (this.lift[i] - this.grav[i]) * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.grav[i] > 0) {
        const g = ground(this.px[i], this.pz[i]) + 0.05;
        if (this.py[i] < g) {
          this.py[i] = g;
          this.vy[i] *= -0.3;
          this.vx[i] *= 0.6;
          this.vz[i] *= 0.6;
        }
      }
      this.rot[i] += this.vrot[i] * dt;
    }

    // Blended particles draw back to front.
    const n = this.count;
    const order = this.order;
    for (let i = 0; i < n; i++) order[i] = i;
    if (!this.additive && n > 1) {
      const e = cam.matrixWorldInverse.elements;
      const d = this.depth;
      for (let i = 0; i < n; i++) d[i] = e[2] * this.px[i] + e[6] * this.py[i] + e[10] * this.pz[i];
      order.subarray(0, n).sort((a, b) => d[a] - d[b]);
    }

    const P = this.iPos.array as Float32Array;
    const C = this.iCol.array as Float32Array;
    const S = this.iSizeRot.array as Float32Array;
    for (let o = 0; o < n; o++) {
      const i = order[o];
      const t = this.age[i] / this.life[i];
      const fi = this.fadeIn[i];
      const alpha = this.a[i] * Math.min(1, t / fi) * (1 - t) * (1 - t * 0.4);
      const c = i * 6;
      P[o * 3] = this.px[i];
      P[o * 3 + 1] = this.py[i];
      P[o * 3 + 2] = this.pz[i];
      C[o * 4] = this.c[c] + (this.c[c + 3] - this.c[c]) * t;
      C[o * 4 + 1] = this.c[c + 1] + (this.c[c + 4] - this.c[c + 1]) * t;
      C[o * 4 + 2] = this.c[c + 2] + (this.c[c + 5] - this.c[c + 2]) * t;
      C[o * 4 + 3] = alpha;
      S[o * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      S[o * 2 + 1] = this.rot[i];
    }
    this.geo.instanceCount = n;
    if (n > 0) {
      this.iPos.addUpdateRange(0, n * 3);
      this.iCol.addUpdateRange(0, n * 4);
      this.iSizeRot.addUpdateRange(0, n * 2);
      this.iPos.needsUpdate = this.iCol.needsUpdate = this.iSizeRot.needsUpdate = true;
    }
  }
}

/** Chunks of earth, concrete and metal thrown by blasts; they bounce, settle and sink away. */
class Debris {
  readonly mesh: THREE.InstancedMesh;
  private n = 64;
  private next = 0;
  private live: { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; t: number; life: number; s: number }[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private col = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), this.n);
    for (let i = 0; i < this.n; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.col.setHex(0xffffff));
      this.live.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, t: 0, life: 0, s: 0 });
    }
    this.mesh.frustumCulled = false;
  }

  throw(x: number, y: number, z: number, power: number, color: number): void {
    const i = this.next++ % this.n;
    const a = Math.random() * Math.PI * 2;
    const h = rand(0.4, 1) * power;
    Object.assign(this.live[i], {
      x,
      y,
      z,
      vx: Math.cos(a) * h * rand(0.4, 0.9),
      vy: rand(3.5, 7) * power,
      vz: Math.sin(a) * h * rand(0.4, 0.9),
      rx: rand(-9, 9),
      ry: rand(-9, 9),
      t: 0,
      life: rand(2.5, 4.5),
      s: rand(0.12, 0.26) * Math.sqrt(power),
    });
    this.col.setHex(color).multiplyScalar(rand(0.75, 1.1));
    this.mesh.setColorAt(i, this.col);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, ground: (x: number, z: number) => number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const d = this.live[i];
      if (d.life <= 0) continue;
      any = true;
      d.t += dt;
      if (d.t >= d.life) {
        d.life = 0;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      const g = ground(d.x, d.z);
      d.vy -= 14 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < g + d.s * 0.4) {
        d.y = g + d.s * 0.4;
        d.vy = Math.abs(d.vy) > 1.2 ? -d.vy * 0.3 : 0;
        d.vx *= 0.5;
        d.vz *= 0.5;
        d.rx *= 0.5;
        d.ry *= 0.5;
      }
      // Sink into the sand at the end.
      const sink = Math.max(0, d.t - (d.life - 0.6)) * d.s * 1.4;
      this.e.set(d.rx * d.t, d.ry * d.t, 0);
      this.q.setFromEuler(this.e);
      this.v.set(d.x, d.y - sink, d.z);
      this.sc.setScalar(d.s);
      this.mesh.setMatrixAt(i, this.m4.compose(this.v, this.q, this.sc));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private smoke: Pool;
  /** Flames and fireballs: lumpy, additive. */
  private fire: Pool;
  /** Sparks and muzzle flashes: round, additive. */
  private glow: Pool;
  private debris = new Debris();
  /** Wrecks and hits that keep burning for a while. */
  private fires: { x: number; y: number; z: number; t: number; scale: number }[] = [];
  readonly wind = new THREE.Vector3(0.9, 0, 0.35);
  private ground: (x: number, z: number) => number;

  constructor(
    private map: GameMap,
    low: boolean,
  ) {
    const puff = puffTexture();
    this.smoke = new Pool(low ? 700 : 1600, puff, false);
    this.fire = new Pool(low ? 300 : 700, puff, true);
    this.glow = new Pool(low ? 300 : 600, glowTexture(), true);
    this.group.add(this.smoke.mesh, this.fire.mesh, this.glow.mesh, this.debris.mesh);
    this.ground = (x, z) => this.map.heightAt(x, z);
  }

  /** Smoke dims to near black at night. */
  setLight(light: number): void {
    this.smoke.uniforms.light.value = light;
  }

  update(dt: number, cam: THREE.Camera): void {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.fires.splice(i, 1);
        continue;
      }
      const k = Math.min(1, f.t / 6) * f.scale;
      if (Math.random() < dt * 14 * k) this.flame(f.x + rand(-0.4, 0.4) * f.scale, f.y, f.z + rand(-0.4, 0.4) * f.scale, 0.9 * f.scale);
      if (Math.random() < dt * 5 * f.scale) this.blackSmoke(f.x, f.y + 0.6, f.z, f.scale * (0.6 + k * 0.6));
    }
    this.smoke.update(dt, this.wind, this.ground, cam);
    this.fire.update(dt, this.wind, this.ground, cam);
    this.glow.update(dt, this.wind, this.ground, cam);
    this.debris.update(dt, this.ground);
  }

  // ------------------------------------------------------------------ building blocks

  /** A tongue of flame (rises and fades from yellow-white to deep red). */
  flame(x: number, y: number, z: number, size = 1): void {
    this.fire.spawn({
      x,
      y: y + 0.1,
      z,
      vx: rand(-0.2, 0.2),
      vy: rand(0.6, 1.4) * size,
      vz: rand(-0.2, 0.2),
      life: rand(0.35, 0.7),
      s0: 0.7 * size,
      s1: 0.2 * size,
      c0: [1.9, 0.9, 0.28],
      c1: [0.9, 0.15, 0.02],
      a: 0.8,
      lift: 1.2,
      drag: 1.5,
      fadeIn: 0.15,
    });
  }

  blackSmoke(x: number, y: number, z: number, size = 1): void {
    this.smoke.spawn({
      x: x + rand(-0.2, 0.2),
      y,
      z: z + rand(-0.2, 0.2),
      vx: rand(-0.2, 0.2),
      vy: rand(0.9, 1.5),
      vz: rand(-0.2, 0.2),
      life: rand(3.5, 5.5),
      s0: 0.8 * size,
      s1: 3.6 * size,
      c0: 0x2e2b28,
      c1: 0x6a6560,
      a: 0.62,
      lift: 0.25,
      drag: 0.5,
      fadeIn: 0.08,
    });
  }

  /** Light smoke (chimneys, smouldering, gun smoke). */
  greySmoke(x: number, y: number, z: number, size = 1, life = 3): void {
    this.smoke.spawn({
      x,
      y,
      z,
      vx: rand(-0.15, 0.15),
      vy: rand(0.5, 0.9),
      vz: rand(-0.15, 0.15),
      life: rand(life * 0.7, life * 1.2),
      s0: 0.35 * size,
      s1: 1.8 * size,
      c0: 0x8c8780,
      c1: 0xb8b2a8,
      a: 0.5,
      lift: 0.2,
      drag: 0.6,
      fadeIn: 0.15,
    });
  }

  /** Kicked-up sand, spreading along the ground. */
  dust(x: number, y: number, z: number, size = 1, out = 0, life = 1.6): void {
    const a = Math.random() * Math.PI * 2;
    this.smoke.spawn({
      x,
      y,
      z,
      vx: Math.cos(a) * out * rand(0.6, 1.2),
      vy: rand(0.1, 0.5),
      vz: Math.sin(a) * out * rand(0.6, 1.2),
      life: rand(life * 0.7, life * 1.3),
      s0: 0.5 * size,
      s1: 2.2 * size,
      c0: 0xd4c4a2,
      c1: 0xe8dfcc,
      a: 0.6,
      lift: 0.05,
      drag: 2.2,
      fadeIn: 0.05,
    });
  }

  // ------------------------------------------------------------------ effects

  /** Rifle fire: a brief flash at the muzzle. */
  muzzleFlash(x: number, y: number, z: number): void {
    this.glow.spawn({ x, y, z, life: 0.06, s0: 0.5, s1: 0.3, c0: [3, 2.2, 1], a: 0.9, fadeIn: 0.01, drag: 0 });
  }

  /** A round hitting the ground or a wall. */
  impact(x: number, y: number, z: number): void {
    this.dust(x, y, z, 0.35, 0.6, 0.8);
    if (Math.random() < 0.4) {
      this.glow.spawn({ x, y: y + 0.05, z, vx: rand(-2, 2), vy: rand(1, 3), vz: rand(-2, 2), life: 0.25, s0: 0.12, s1: 0.06, c0: [3, 2, 0.8], grav: 9, drag: 0.5, fadeIn: 0.01 });
    }
  }

  /** Shell, rocket, mine, C4 or strike drone: fireball, sparks, debris, a ring of dust, rising smoke. */
  explosion(x: number, z: number, scale = 1, debrisColor = 0xa58a62): void {
    const y = this.ground(x, z);
    for (let i = 0; i < 5; i++) {
      this.fire.spawn({
        x: x + rand(-0.5, 0.5) * scale,
        y: y + rand(0.2, 0.9) * scale,
        z: z + rand(-0.5, 0.5) * scale,
        vx: rand(-1.5, 1.5) * scale,
        vy: rand(0.8, 2.5) * scale,
        vz: rand(-1.5, 1.5) * scale,
        life: rand(0.35, 0.6),
        s0: 1.1 * scale,
        s1: 2.8 * scale,
        c0: [1.9, 0.95, 0.32],
        c1: [0.8, 0.2, 0.03],
        a: 0.8,
        drag: 3,
        lift: 1,
        fadeIn: 0.02,
      });
    }
    for (let i = 0; i < 12 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(4, 10) * scale;
      this.glow.spawn({
        x,
        y: y + 0.4,
        z,
        vx: Math.cos(a) * sp,
        vy: rand(3, 8) * scale,
        vz: Math.sin(a) * sp,
        life: rand(0.4, 0.9),
        s0: 0.16,
        s1: 0.06,
        c0: [4, 2.4, 0.8],
        c1: [1.5, 0.3, 0.05],
        grav: 12,
        drag: 0.8,
        fadeIn: 0.01,
      });
    }
    for (let i = 0; i < 6 * scale; i++) this.debris.throw(x, y + 0.4, z, scale, i % 3 === 0 ? 0x5a524a : debrisColor);
    for (let i = 0; i < 10 * scale; i++) this.dust(x, y + 0.2, z, 0.9 * scale, 5 * scale, 2.2);
    for (let i = 0; i < 5 * scale; i++) this.blackSmoke(x + rand(-0.6, 0.6), y + 0.6 + i * 0.3, z + rand(-0.6, 0.6), 0.8 * scale);
  }

  /** Howitzer or tank gun firing: flash, a ring of dust and a cloud of gun smoke. */
  gunBlast(x: number, y: number, z: number): void {
    for (let i = 0; i < 2; i++) this.fire.spawn({ x, y, z, life: 0.14, s0: 1.4, s1: 2.2, c0: [3.5, 2.2, 1], a: 0.8, fadeIn: 0.01, drag: 0 });
    const g = this.ground(x, z);
    for (let i = 0; i < 7; i++) this.dust(x, g + 0.2, z, 0.8, 4, 1.8);
    for (let i = 0; i < 3; i++) this.greySmoke(x + rand(-0.4, 0.4), y, z + rand(-0.4, 0.4), 1.2, 2.5);
  }

  /** A soldier falls: a little puff of dust. */
  bodyFall(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i++) this.dust(x, y + 0.15, z, 0.45, 0.8, 1.0);
  }

  /** A drone shot down. */
  droneDown(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i++) this.fire.spawn({ x, y, z, vx: rand(-1, 1), vy: rand(-0.5, 1), vz: rand(-1, 1), life: 0.3, s0: 0.5, s1: 1.2, c0: [3, 1.8, 0.8], c1: [1, 0.2, 0.05], drag: 2, fadeIn: 0.02 });
    for (let i = 0; i < 4; i++) this.blackSmoke(x, y, z, 0.4);
  }

  /** A vehicle brews up: a big blast, then a wreck that burns for a while. */
  vehicleKill(x: number, z: number): void {
    this.explosion(x, z, 1.4, 0x4a4d52);
    this.fires.push({ x, y: this.ground(x, z) + 0.5, z, t: 24, scale: 1 });
  }

  /** A building comes down: a rolling cloud of dust and debris. */
  collapse(x: number, z: number, size: number): void {
    const y = this.ground(x, z);
    for (let i = 0; i < 18 * size; i++) {
      this.smoke.spawn({
        x: x + rand(-1, 1) * size,
        y: y + rand(0.2, 1.5),
        z: z + rand(-1, 1) * size,
        vx: rand(-2, 2) * size,
        vy: rand(0.2, 1.2),
        vz: rand(-2, 2) * size,
        life: rand(2.5, 4.5),
        s0: 1.2 * size,
        s1: 3.8 * size,
        c0: 0xa49a8a,
        c1: 0xcbbfa8,
        a: 0.7,
        lift: 0.08,
        drag: 1.2,
        fadeIn: 0.05,
      });
    }
    for (let i = 0; i < 10 * size; i++) this.debris.throw(x + rand(-1, 1), y + 1, z + rand(-1, 1), 0.8, i % 2 ? 0xbdb3a1 : 0x938a7b);
  }

  /** Something knocked off a building by gunfire. */
  chip(x: number, y: number, z: number): void {
    this.smoke.spawn({ x, y, z, vx: rand(-0.6, 0.6), vy: rand(0.3, 0.9), vz: rand(-0.6, 0.6), life: 1.0, s0: 0.3, s1: 1.2, c0: 0xb8ad99, a: 0.6, drag: 1.5, fadeIn: 0.05 });
    if (Math.random() < 0.3) this.debris.throw(x, y, z, 0.35, 0xbdb3a1);
  }
}
