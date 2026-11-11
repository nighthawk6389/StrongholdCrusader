import * as THREE from 'three';
import { Tile, type GameMap } from '../sim/map';
import type { Structure } from '../sim/structures';
import { COLORS } from './palette';

/**
 * The ground's look. Each tile's surface (sand, rock, grass, oil, rubble, water bed) goes into a
 * small data texture, one texel per tile. The shader blends neighbouring tiles bilinearly, breaks the
 * edges up with world-space noise and draws the fine detail (sand ripples, rock cracks, grass clumps,
 * oil sheen) procedurally, so there are no image files and no tile grid. A second texture holds what
 * changes during a match: worn paths where units walk, packed dirt around buildings and scorch marks
 * from explosions.
 */

/** Texels per tile in the wear texture (finer than the tiles, so paths and scorch marks look round). */
const WEAR_RES = 2;

const GROUND_PARS = /* glsl */ `
varying vec3 vGPos;
uniform sampler2D gSurf;
uniform sampler2D gWear;
uniform vec2 gSize;
uniform vec3 gSand;
uniform vec3 gSandLo;
uniform vec3 gWet;
uniform vec3 gRock;
uniform vec3 gRockLo;
uniform vec3 gFert;
uniform vec3 gFertDry;
uniform vec3 gOil;
uniform vec3 gRuin;
uniform vec3 gBed;
uniform vec3 gDirt;
uniform vec3 gScorch;
uniform sampler2D gLight;
uniform float gLightK;

float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float gFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < G_OCT; i++) {
    s += a * gNoise(p);
    p = p * 2.03 + vec2(17.1, 5.3);
    a *= 0.5;
  }
  return s / (1.0 - a);
}
/** Hard-ish edge where a blended weight crosses one half, wobbled by noise so tile edges disappear. */
float gEdge(float w, float n, float soft) {
  return smoothstep(0.5 - soft, 0.5 + soft, w + (n - 0.5) * 0.7);
}

vec3 groundColor(vec2 p, float y, out float h) {
  vec2 uv = p / gSize;
  vec4 s = texture2D(gSurf, uv);
  vec4 w = texture2D(gWear, uv);
  // Past the map edge the ground turns into plain open desert.
  vec2 o = max(max(-p, p - gSize), 0.0);
  float inside = 1.0 - smoothstep(1.0, 7.0, length(o));
  s *= inside;
  w *= inside;

  float pix = length(fwidth(p));
  float fineFade = 1.0 - smoothstep(0.06, 0.22, pix);
  float macro = gNoise(p * 0.045) * 0.6 + gNoise(p * 0.13 + 7.0) * 0.4;
  float mid = gFbm(p * 0.55);
  float fine = mix(0.5, gNoise(p * 3.1), fineFade);

  // Sand: two tones in broad patches, lighter on dune crests, wind ripples and grain.
  vec3 col = mix(gSandLo, gSand, smoothstep(0.2, 0.8, macro));
  col *= 1.0 + clamp(y, -2.0, 2.5) * 0.028;
  // Ripples come and go in wind-swept patches rather than covering everything.
  float ripFade = (1.0 - smoothstep(0.035, 0.11, pix)) * smoothstep(0.35, 0.75, gNoise(p * 0.06 + 20.0));
  float rip = sin(dot(p, vec2(0.83, 0.56)) * 5.6 + mid * 4.0 + macro * 3.0);
  col *= 1.0 - 0.03 * smoothstep(0.1, 1.0, rip) * ripFade;
  col *= 0.965 + 0.07 * fine;
  h = rip * 0.02 * ripFade;

  // Damp sand around the water, then the muddy bed itself.
  col = mix(col, gWet, smoothstep(0.0, 0.7, w.r) * 0.55);
  col = mix(col, gBed, gEdge(w.r, mid, 0.2));

  // Oil: a dark soaked halo, then the seep with an oily sheen.
  float oilRaw = s.b;
  col = mix(col, gOil * 1.5, smoothstep(0.0, 0.55, oilRaw) * 0.4);
  float oil = gEdge(oilRaw, mid, 0.12);
  vec3 oilC = gOil * (0.8 + 0.4 * fine) + vec3(0.04, 0.05, 0.09) * smoothstep(0.55, 0.85, gNoise(p * 1.7 + 3.0));
  col = mix(col, oilC, oil);

  // Grass around oases: dry at the fringe, lush in the middle, in clumps.
  float fert = gEdge(s.g, gNoise(p * 0.9 + 11.0), 0.2);
  if (fert > 0.001) {
    vec3 grass = mix(gFertDry, gFert, smoothstep(0.35, 0.75, mid + (s.g - 0.6) * 0.8));
    float clump = gNoise(p * 5.0);
    grass *= mix(1.0, 0.8 + 0.34 * clump, fineFade);
    col = mix(col, grass, fert);
    h += fert * clump * 0.06 * fineFade;
  }

  // Ruins: broken concrete and gravel.
  float ruin = gEdge(s.a, mid, 0.15);
  if (ruin > 0.001) col = mix(col, gRuin * (0.84 + 0.26 * gNoise(p * 4.0)), ruin);

  // Rock: two tones, layered strata and dark cracks.
  float rock = gEdge(s.r, mid, 0.14);
  if (rock > 0.001) {
    float rn = gFbm(p * 0.9 + 3.7);
    vec3 rk = mix(gRockLo, gRock, smoothstep(0.25, 0.75, rn));
    float crack = smoothstep(0.0, 0.045, abs(gNoise(p * 1.8) - 0.5));
    rk *= mix(0.7, 1.0, mix(1.0, crack, fineFade));
    rk *= 0.94 + 0.1 * sin(y * 9.0 + rn * 4.0);
    col = mix(col, rk, rock);
    h += rock * (rn * 0.4 - (1.0 - crack) * 0.08 * fineFade);
  }

  // Worn paths and packed earth around buildings.
  float dirt = smoothstep(0.15, 0.7, w.g + (fine - 0.5) * 0.2 + (mid - 0.5) * 0.45) * (1.0 - rock);
  vec3 dirtC = gDirt * (0.9 + 0.18 * gNoise(p * 2.3 + 5.0));
  col = mix(col, dirtC, dirt * 0.75);
  h *= 1.0 - dirt * 0.7;

  // Scorch marks.
  float sc = smoothstep(0.12, 0.8, w.b + (mid - 0.5) * 0.55);
  col = mix(col, gScorch * (0.8 + 0.4 * fine), sc * 0.88);
  return col;
}

/** Bump the shading normal by a height field (screen-space derivatives; view space). */
vec3 gPerturb(vec3 pos, vec3 n, float hgt) {
  vec3 sx = dFdx(pos);
  vec3 sy = dFdy(pos);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  return normalize(abs(det) * n - grad);
}
`;

function tinted(hex: number, map: GameMap): THREE.Color {
  return new THREE.Color(hex).offsetHSL(map.tint.hue, map.tint.sat, map.tint.light);
}

export class GroundSurface {
  readonly material: THREE.MeshLambertMaterial;
  private wearTex: THREE.DataTexture;
  private wearData: Uint8Array;
  /** Accumulated foot and wheel traffic per wear texel, 0..1. */
  private tread: Float32Array;
  /** Packed earth around structures, 0..1 (rebuilt when structures change). */
  private apron: Float32Array;
  private scorch: Float32Array;
  private ww: number;
  private wh: number;
  private dirty = true;
  private uploadIn = 0;
  private apronSig = '';
  private lightTex: THREE.DataTexture;
  private lightData: Uint8Array;
  private lightBlur: Float32Array;
  private lightVersion = -1;
  private lightK = { value: 0 };
  private lightSize: { width: number; height: number };

  constructor(
    map: GameMap,
    detail: 'low' | 'high',
  ) {
    const { width: w, height: h } = map;
    this.lightSize = { width: w, height: h };
    const surf = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const t = map.tiles[i];
      surf[i * 4] = t === Tile.Rock ? 255 : 0;
      surf[i * 4 + 1] = t === Tile.Fertile ? 255 : 0;
      surf[i * 4 + 2] = t === Tile.Oil ? 255 : 0;
      surf[i * 4 + 3] = t === Tile.Ruin ? 255 : 0;
    }
    const surfTex = dataTexture(surf, w, h);

    this.ww = w * WEAR_RES;
    this.wh = h * WEAR_RES;
    const n = this.ww * this.wh;
    this.wearData = new Uint8Array(n * 4);
    this.tread = new Float32Array(n);
    this.apron = new Float32Array(n);
    this.scorch = new Float32Array(n);
    for (let wz = 0; wz < this.wh; wz++) {
      for (let wx = 0; wx < this.ww; wx++) {
        const t = map.tiles[Math.floor(wz / WEAR_RES) * w + Math.floor(wx / WEAR_RES)];
        this.wearData[(wz * this.ww + wx) * 4] = t === Tile.Water ? 255 : 0;
      }
    }
    this.wearTex = dataTexture(this.wearData, this.ww, this.wh);

    this.lightData = new Uint8Array(w * h * 4);
    this.lightBlur = new Float32Array(w * h);
    this.lightTex = dataTexture(this.lightData, w, h);

    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const uniforms = {
      gSurf: { value: surfTex },
      gWear: { value: this.wearTex },
      gSize: { value: new THREE.Vector2(w, h) },
      gSand: { value: tinted(0xdcbc80, map) },
      gSandLo: { value: tinted(0xc9a56c, map) },
      gWet: { value: tinted(0xa98c5c, map) },
      gRock: { value: tinted(COLORS.rock[2], map) },
      gRockLo: { value: tinted(0x765a44, map) },
      gFert: { value: new THREE.Color(0x5f8a35) },
      gFertDry: { value: new THREE.Color(0x9c9a52) },
      gOil: { value: tinted(0x2f2924, map) },
      gRuin: { value: tinted(0xa19b8e, map) },
      gBed: { value: new THREE.Color(COLORS.waterBed) },
      gDirt: { value: tinted(0xbe9d68, map) },
      gScorch: { value: new THREE.Color(0x2c2520) },
      gLight: { value: this.lightTex },
      gLightK: this.lightK,
    };
    const high = detail === 'high';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.defines = { ...(shader.defines ?? {}), G_OCT: high ? 4 : 2, ...(high ? { G_BUMP: 1 } : {}) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GROUND_PARS)
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nfloat gH = 0.0;\ndiffuseColor.rgb = groundColor(vGPos.xz, vGPos.y, gH);',
        )
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\n#ifdef G_BUMP\nnormal = gPerturb(-vViewPosition, normal, gH * 0.7);\n#endif',
        )
        .replace(
          '#include <opaque_fragment>',
          // Night light pools from floodlights, searchlights, flares and fires (the sim's light grid).
          'float gL = texture2D(gLight, vGPos.xz / gSize).r * 2.0 * gLightK;\n' +
            'outgoingLight += (diffuseColor.rgb * vec3(1.05, 0.95, 0.8) + vec3(0.05, 0.04, 0.02)) * gL;\n' +
            '#include <opaque_fragment>',
        );
    };
    this.material.customProgramCacheKey = () => 'ground-' + detail;
  }

  /**
   * Artificial light on the ground at night. The per-tile grid is softened (3×3) before upload and then
   * filtered on the GPU, so pools have round, smooth edges instead of steps.
   */
  setLight(light: Float32Array, version: number, night: number): void {
    this.lightK.value = night > 0.03 ? 0.8 * night : 0;
    if (version === this.lightVersion || night <= 0.03) return;
    this.lightVersion = version;
    const { width: w, height: h } = this.lightSize;
    const b = this.lightBlur;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let wt = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const k = (dx === 0 ? 2 : 1) * (dz === 0 ? 2 : 1);
            sum += light[zz * w + xx] * k;
            wt += k;
          }
        }
        b[z * w + x] = sum / wt;
      }
    }
    const d = this.lightData;
    for (let i = 0; i < b.length; i++) d[i * 4] = Math.min(255, b[i] * 127.5);
    this.lightTex.needsUpdate = true;
  }

  /** Packed earth around buildings and along walls (not around mines: that would give them away). */
  private stampAprons(structures: readonly Structure[]): void {
    const a = this.apron;
    a.fill(0);
    const R = WEAR_RES;
    for (const s of structures) {
      if (s.kind === 'mines') continue;
      const pad = s.w * s.h >= 4 ? 3.2 : 1.8;
      const x0 = Math.max(0, Math.floor((s.tx - pad) * R));
      const z0 = Math.max(0, Math.floor((s.tz - pad) * R));
      const x1 = Math.min(this.ww - 1, Math.ceil((s.tx + s.w + pad) * R));
      const z1 = Math.min(this.wh - 1, Math.ceil((s.tz + s.h + pad) * R));
      for (let wz = z0; wz <= z1; wz++) {
        const pz = (wz + 0.5) / R;
        const dz = Math.max(s.tz - pz, 0, pz - (s.tz + s.h));
        for (let wx = x0; wx <= x1; wx++) {
          const px = (wx + 0.5) / R;
          const dx = Math.max(s.tx - px, 0, px - (s.tx + s.w));
          const d = Math.hypot(dx, dz) / pad;
          const v = d >= 1 ? 0 : 1 - d * d;
          const i = wz * this.ww + wx;
          if (v > a[i]) a[i] = v;
        }
      }
    }
    this.dirty = true;
  }

  /** Units leave a trace where they walk: over a match, busy routes wear into paths. */
  wearAt(x: number, z: number, amount: number): void {
    const wx = Math.floor(x * WEAR_RES);
    const wz = Math.floor(z * WEAR_RES);
    if (wx < 0 || wz < 0 || wx >= this.ww || wz >= this.wh) return;
    const t = this.tread;
    const i = wz * this.ww + wx;
    t[i] = Math.min(1, t[i] + amount);
    // Spread a little to the neighbours so the path has width.
    const side = amount * 0.35;
    if (wx > 0) t[i - 1] = Math.min(1, t[i - 1] + side);
    if (wx < this.ww - 1) t[i + 1] = Math.min(1, t[i + 1] + side);
    if (wz > 0) t[i - this.ww] = Math.min(1, t[i - this.ww] + side);
    if (wz < this.wh - 1) t[i + this.ww] = Math.min(1, t[i + this.ww] + side);
    this.dirty = true;
  }

  /** Blacken the ground around a blast. */
  scorchAt(x: number, z: number, radius: number): void {
    const R = WEAR_RES;
    const x0 = Math.max(0, Math.floor((x - radius) * R));
    const z0 = Math.max(0, Math.floor((z - radius) * R));
    const x1 = Math.min(this.ww - 1, Math.ceil((x + radius) * R));
    const z1 = Math.min(this.wh - 1, Math.ceil((z + radius) * R));
    for (let wz = z0; wz <= z1; wz++) {
      for (let wx = x0; wx <= x1; wx++) {
        const d = Math.hypot((wx + 0.5) / R - x, (wz + 0.5) / R - z) / radius;
        if (d >= 1) continue;
        const i = wz * this.ww + wx;
        this.scorch[i] = Math.min(1, Math.max(this.scorch[i], 1.15 * (1 - d * d)));
      }
    }
    this.dirty = true;
  }

  /**
   * `seconds` of game time passed. Refreshes building aprons when structures change, fades scorch
   * marks over a few minutes and uploads the texture at most twice a second.
   */
  update(dt: number, structures: readonly Structure[]): void {
    let sig = String(structures.length);
    const last = structures[structures.length - 1];
    if (last) sig += ':' + last.id;
    if (sig !== this.apronSig) {
      this.apronSig = sig;
      this.stampAprons(structures);
    }
    this.uploadIn -= dt;
    if (this.uploadIn > 0) return;
    const step = 0.5 - this.uploadIn;
    this.uploadIn = 0.5;
    const sc = this.scorch;
    const fade = step / 240;
    let any = false;
    for (let i = 0; i < sc.length; i++) {
      if (sc[i] > 0) {
        sc[i] = Math.max(0, sc[i] - fade);
        any = true;
      }
    }
    if (!this.dirty && !any) return;
    this.dirty = false;
    const d = this.wearData;
    const t = this.tread;
    const a = this.apron;
    for (let i = 0, p = 1; i < t.length; i++, p += 4) {
      d[p] = Math.min(255, Math.max(t[i], a[i] * 0.85) * 255);
      d[p + 1] = Math.min(255, sc[i] * 255);
    }
    this.wearTex.needsUpdate = true;
  }
}

function dataTexture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
