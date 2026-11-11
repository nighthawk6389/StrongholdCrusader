import * as THREE from 'three';
import { Tile, type GameMap } from '../sim/map';
import { hash2 } from '../sim/rng';
import { COLORS } from './palette';
import type { GroundSurface } from './ground';

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Rolling dunes beyond the map edge. */
function farDunes(x: number, z: number): number {
  return Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.7) * 1.7 + Math.sin((x + z) * 0.021) * 1.2 - 0.4;
}

/** Ground height anywhere: the map inside, easing into open dunes outside it. */
function groundHeight(map: GameMap, x: number, z: number): number {
  const cx = Math.min(Math.max(x, 0), map.width);
  const cz = Math.min(Math.max(z, 0), map.height);
  const edge = map.heightAt(cx, cz);
  const d = Math.hypot(x - cx, z - cz);
  if (d === 0) return edge;
  return edge + (farDunes(x, z) - edge) * smooth(0, 45, d);
}

/** Smooth normal at a point from the surrounding heights (one tile either way). */
function groundNormal(map: GameMap, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const hl = groundHeight(map, x - 1, z);
  const hr = groundHeight(map, x + 1, z);
  const hd = groundHeight(map, x, z - 1);
  const hu = groundHeight(map, x, z + 1);
  return out.set(hl - hr, 2, hd - hu).normalize();
}

/**
 * The playable ground: two triangles per tile (the split must match GameMap.heightAt) with smooth
 * normals. Its look comes from the GroundSurface shader, not from per-tile colours.
 */
export function buildTerrain(map: GameMap, ground: GroundSurface): THREE.Mesh {
  const { width, height } = map;
  const tileCount = width * height;
  const pos = new Float32Array(tileCount * 6 * 3);
  const nor = new Float32Array(tileCount * 6 * 3);
  const w1 = width + 1;

  // Per-corner smooth normals.
  const cornerN = new Float32Array(w1 * (height + 1) * 3);
  const n = new THREE.Vector3();
  for (let vz = 0; vz <= height; vz++) {
    for (let vx = 0; vx <= width; vx++) {
      const k = (vz * w1 + vx) * 3;
      groundNormal(map, vx, vz, n);
      cornerN[k] = n.x;
      cornerN[k + 1] = n.y;
      cornerN[k + 2] = n.z;
    }
  }

  let p = 0;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      // Triangles (00, 11, 10) and (00, 01, 11) — must match GameMap.heightAt.
      const corners = [
        [tx, tz],
        [tx + 1, tz + 1],
        [tx + 1, tz],
        [tx, tz],
        [tx, tz + 1],
        [tx + 1, tz + 1],
      ];
      for (const [vx, vz] of corners) {
        const k = (vz * w1 + vx) * 3;
        pos[p] = vx;
        pos[p + 1] = map.vertexHeight(vx, vz);
        pos[p + 2] = vz;
        nor[p] = cornerN[k];
        nor[p + 1] = cornerN[k + 1];
        nor[p + 2] = cornerN[k + 2];
        p += 3;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const mesh = new THREE.Mesh(geo, ground.material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/**
 * Open desert around the map, out to where the fog swallows it, so the world doesn't end at a cliff.
 * The grid is one tile fine along the map edge (its vertices meet the terrain's exactly) and coarser
 * further out. Purely visual: nothing can go there.
 */
export function buildSkirt(map: GameMap, ground: GroundSurface): THREE.Mesh {
  const out = [1, 3, 6, 10, 16, 26, 40, 60, 90, 140, 220];
  const axis = (size: number): number[] => {
    const a: number[] = [];
    for (let i = out.length - 1; i >= 0; i--) a.push(-out[i]);
    for (let i = 0; i <= size; i++) a.push(i);
    for (const d of out) a.push(size + d);
    return a;
  };
  const xs = axis(map.width);
  const zs = axis(map.height);
  const nx = xs.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const n = new THREE.Vector3();
  for (const z of zs) {
    for (const x of xs) {
      pos.push(x, groundHeight(map, x, z), z);
      groundNormal(map, x, z, n);
      nor.push(n.x, n.y, n.z);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const inside = xs[i] >= 0 && xs[i + 1] <= map.width && zs[j] >= 0 && zs[j + 1] <= map.height;
      if (inside) continue;
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, d, b, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, ground.material);
  mesh.receiveShadow = true;
  mesh.name = 'skirt';
  return mesh;
}

/**
 * Oasis water: a light sun glint, gentle animated ripples, shallows that let the bed show through at
 * the rim, and the sky reflected at grazing angles.
 */
export class WaterRenderer {
  readonly group = new THREE.Group();
  private uniforms = { wTime: { value: 0 }, wSky: { value: new THREE.Color(0xdcccab) } };

  constructor(map: GameMap) {
    const mat = new THREE.MeshPhongMaterial({
      color: COLORS.water,
      transparent: true,
      opacity: 0.86,
      emissive: 0x0b2a35,
      specular: 0x9a9a8a,
      shininess: 90,
      depthWrite: false,
    });
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float rim;\nvarying vec3 vWPos;\nvarying float vRim;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRim = rim;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWPos;
varying float vRim;
uniform float wTime;
uniform vec3 wSky;
float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float wWaves(vec2 p) { return wNoise(p * 2.6 + vec2(wTime * 0.5, wTime * 0.3)) + wNoise(p * 4.3 - vec2(wTime * 0.35, -wTime * 0.45)) * 0.5; }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float wRim = smoothstep(0.55, 1.0, vRim);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.62, 0.6), wRim * 0.6);
diffuseColor.a *= 1.0 - wRim * 0.45;`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
float w0 = wWaves(vWPos.xz);
vec2 wg = vec2(wWaves(vWPos.xz + vec2(0.08, 0.0)) - w0, wWaves(vWPos.xz + vec2(0.0, 0.08)) - w0) / 0.08;
normal = normalize(normal + (viewMatrix * vec4(-wg.x * 0.025, 0.0, -wg.y * 0.025, 0.0)).xyz);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `float wFr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
outgoingLight = mix(outgoingLight, wSky, wFr * 0.55);
#include <opaque_fragment>`,
        );
    };
    mat.customProgramCacheKey = () => 'oasis-water';
    for (const o of map.oases) {
      const geo = new THREE.CircleGeometry(o.r + 2.2, 40);
      geo.rotateX(-Math.PI / 2);
      const rim = new Float32Array(geo.getAttribute('position').count).fill(1);
      rim[0] = 0;
      geo.setAttribute('rim', new THREE.BufferAttribute(rim, 1));
      const m = new THREE.Mesh(geo, mat);
      m.position.set(o.x, o.level - 0.18, o.z);
      m.receiveShadow = true;
      m.renderOrder = 1;
      this.group.add(m);
    }
  }

  update(time: number, sky: THREE.Color): void {
    this.uniforms.wTime.value = time;
    this.uniforms.wSky.value.copy(sky);
  }
}

/** Rocks on rock tiles and sparse scrub on sand. All instanced. (Trees are sim objects: see TreeRenderer.) */
export function buildScatter(map: GameMap): THREE.Group {
  const g = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();

  type Item = { x: number; z: number; h: number };
  const rocks: Item[] = [];
  const scrub: Item[] = [];
  const ruins: Item[] = [];
  for (let tz = 0; tz < map.height; tz++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = map.tileAt(tx, tz);
      const h = hash2(tx, tz, map.seed + 17);
      if (t === Tile.Rock) rocks.push({ x: tx + 0.5, z: tz + 0.5, h });
      else if (t === Tile.Ruin) ruins.push({ x: tx + 0.5, z: tz + 0.5, h });
      else if (t === Tile.Sand && h > 0.988 && map.isWalkableTile(tx, tz) && map.treeAt[map.idx(tx, tz)] < 0) {
        scrub.push({ x: tx + 0.5, z: tz + 0.5, h });
      }
    }
  }

  // Boulders: three lumpy shapes, each instance turned, squashed and shaded a little differently, with
  // a smaller stone beside some of them, half sunk into the ground so outcrops read as one mass.
  const rockBase = new THREE.Color(COLORS.rockMesh).offsetHSL(map.tint.hue, map.tint.sat, map.tint.light);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  // Layered strata and weathering in world space, so neighbouring boulders read as one outcrop.
  rockMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRPos;\nvarying float vRLy;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvRLy = transformed.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRPos;
varying float vRLy;
float rHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float band = sin(vRPos.y * 7.0 + sin(vRPos.x * 0.7) * 1.4 + cos(vRPos.z * 0.6) * 1.2);
diffuseColor.rgb *= 0.9 + 0.1 * band + 0.06 * (rHash(floor(vRPos * 3.0)) - 0.5);
diffuseColor.rgb *= mix(0.72, 1.06, smoothstep(-0.25, 0.6, vRLy));`,
      );
  };
  rockMat.customProgramCacheKey = () => 'boulders';
  const shapes = [0, 1, 2].map((variant) => {
    const geo = new THREE.IcosahedronGeometry(0.7, 1);
    const a = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i);
      // Same jitter for the same corner, so the faces stay joined.
      const j = hash2(Math.round(v.x * 100), Math.round(v.y * 100) * 31 + Math.round(v.z * 100), 7 + variant * 13);
      v.multiplyScalar(0.78 + j * 0.42);
      if (v.y < 0) v.y *= 0.45;
      a.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  });
  const byShape: Item[][] = [[], [], []];
  for (const r of rocks) {
    byShape[Math.floor(r.h * 3) % 3].push(r);
    if (r.h > 0.62) byShape[Math.floor(r.h * 7) % 3].push({ x: r.x + (r.h - 0.8) * 1.6, z: r.z - (r.h - 0.8) * 1.4, h: 1 - r.h });
  }
  const rc = new THREE.Color();
  byShape.forEach((list, si) => {
    const mesh = new THREE.InstancedMesh(shapes[si], rockMat, Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach((r, i) => {
      const k = 0.7 + r.h * 0.8;
      e.set((r.h - 0.5) * 0.5, r.h * 17, (r.h - 0.5) * 0.4);
      q.setFromEuler(e);
      s.set(k * (1 + r.h * 0.25), k * (0.65 + r.h * 0.7), k * (1.15 - r.h * 0.2));
      v.set(r.x + (r.h - 0.5) * 0.3, map.heightAt(r.x, r.z) + 0.08 * k, r.z + (r.h - 0.5) * 0.3);
      m4.compose(v, q, s);
      mesh.setMatrixAt(i, m4);
      const t = hash2(Math.floor(r.x * 3), Math.floor(r.z * 3), map.seed + 23);
      mesh.setColorAt(i, rc.copy(rockBase).offsetHSL((t - 0.5) * 0.025, (t - 0.5) * 0.08, (t - 0.5) * 0.12));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  });

  // Ruins: broken concrete wall stumps of uneven height, a few with rebar sticking out.
  const ruinMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0xb8b2a4, flatShading: true }),
    Math.max(1, ruins.length),
  );
  ruinMesh.count = ruins.length;
  ruins.forEach((r, i) => {
    e.set(0, (r.h - 0.5) * 0.3, (r.h - 0.5) * 0.12);
    q.setFromEuler(e);
    s.set(0.95, 0.5 + r.h * 1.3, 0.95 - r.h * 0.25);
    v.set(r.x, map.heightAt(r.x, r.z) - 0.05, r.z);
    m4.compose(v, q, s);
    ruinMesh.setMatrixAt(i, m4);
  });
  ruinMesh.castShadow = true;
  ruinMesh.receiveShadow = true;
  g.add(ruinMesh);

  const scrubMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.28, 0),
    new THREE.MeshLambertMaterial({ color: 0x7d7a45, flatShading: true }),
    scrub.length,
  );
  scrub.forEach((p, i) => {
    q.identity();
    s.set(1, 0.6, 1);
    v.set(p.x, map.heightAt(p.x, p.z) + 0.08, p.z);
    m4.compose(v, q, s);
    scrubMesh.setMatrixAt(i, m4);
  });
  g.add(scrubMesh);
  return g;
}

/** Palms and acacias driven by the sim tree list; felled trees vanish. */
export class TreeRenderer {
  readonly group = new THREE.Group();
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh][] = [];
  /** Per tree: instance slot within its kind's meshes. */
  private slot: Int32Array;
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private map: GameMap) {
    const palmTrunk = new THREE.CylinderGeometry(0.06, 0.1, 1.8, 5);
    palmTrunk.translate(0, 0.9, 0);
    const palmCrown = new THREE.ConeGeometry(0.9, 0.45, 7);
    palmCrown.translate(0, 1.85, 0);
    const acTrunk = new THREE.CylinderGeometry(0.07, 0.11, 1.3, 5);
    acTrunk.translate(0, 0.65, 0);
    const acCrown = new THREE.CylinderGeometry(0.95, 0.55, 0.38, 7);
    acCrown.translate(0, 1.42, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.palmTrunk });
    const kinds = [
      { trunk: palmTrunk, crown: palmCrown, color: COLORS.palmCrown },
      { trunk: acTrunk, crown: acCrown, color: 0x6f7c38 },
    ];
    const counts = [0, 0];
    for (const t of map.trees) counts[t.kind]++;
    kinds.forEach((k, i) => {
      const trunk = new THREE.InstancedMesh(k.trunk, trunkMat, Math.max(1, counts[i]));
      const crown = new THREE.InstancedMesh(
        k.crown,
        new THREE.MeshLambertMaterial({ color: k.color, flatShading: true }),
        Math.max(1, counts[i]),
      );
      trunk.count = crown.count = counts[i];
      trunk.castShadow = crown.castShadow = true;
      this.meshes.push([trunk, crown]);
      this.group.add(trunk, crown);
    });

    this.slot = new Int32Array(map.trees.length);
    const next = [0, 0];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const v = new THREE.Vector3();
    map.trees.forEach((t, i) => {
      const h = hash2(Math.floor(t.x * 7), Math.floor(t.z * 7), map.seed + 5);
      const k = t.kind === 0 ? 0.8 + h * 0.9 : 0.75 + h * 0.6;
      e.set((h - 0.5) * 0.25, h * 40, (h - 0.5) * 0.2);
      q.setFromEuler(e);
      sc.set(k, k, k);
      v.set(t.x, map.heightAt(t.x, t.z) - 0.05, t.z);
      m4.compose(v, q, sc);
      const s = next[t.kind]++;
      this.slot[i] = s;
      const [trunk, crown] = this.meshes[t.kind];
      trunk.setMatrixAt(s, m4);
      crown.setMatrixAt(s, m4);
      if (t.wood <= 0) {
        trunk.setMatrixAt(s, this.zero);
        crown.setMatrixAt(s, this.zero);
      }
    });
  }

  fell(index: number): void {
    const t = this.map.trees[index];
    if (!t) return;
    const [trunk, crown] = this.meshes[t.kind];
    trunk.setMatrixAt(this.slot[index], this.zero);
    crown.setMatrixAt(this.slot[index], this.zero);
    trunk.instanceMatrix.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
  }
}
