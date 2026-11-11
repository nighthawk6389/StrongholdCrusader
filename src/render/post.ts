import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Final look on high quality: soft ambient occlusion where things meet the ground and each other,
 * glow around lamps, muzzle flashes, fireballs and the sun, then a gentle colour grade and vignette.
 * The scene renders into an HDR, multisampled target; tone mapping happens in the output pass.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.55 },
    night: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float night;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // A touch more contrast and colour.
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.07 - night * 0.12);
      // Warm highlights, slightly cool shadows (cooler still at night).
      c += vec3(0.025, 0.01, -0.02) * smoothstep(0.45, 1.0, l);
      c += vec3(-0.012, -0.002, 0.018 + night * 0.02) * (1.0 - smoothstep(0.0, 0.35, l));
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * vignette;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class PostFx {
  private composer: EffectComposer;
  private ao: GTAOPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  /** AO resolution relative to the drawing buffer (half on high-DPI screens: it's soft anyway). */
  private aoScale: number;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    this.aoScale = renderer.getPixelRatio() > 1.2 ? 0.5 : 1;
    this.ao = new GTAOPass(scene, camera, 1, 1);
    this.ao.blendIntensity = 0.85;
    this.ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.3, thickness: 1.8, scale: 1.25, samples: 12 });
    this.ao.updatePdMaterial({ radius: 6, rings: 2, samples: 12 });
    // Billboards and see-through effects (beams, halos, smoke, water, ghosts) must not cast AO.
    const pass = this.ao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] };
    pass._overrideVisibility = () => {
      const cache = pass._visibilityCache;
      scene.traverseVisible((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        const hide =
          (o as THREE.Points).isPoints ||
          (o as THREE.Line).isLine ||
          (o as THREE.Sprite).isSprite ||
          (m && !Array.isArray(m) && (m.transparent || m.blending === THREE.AdditiveBlending)) ||
          o.userData.noAO === true;
        if (hide) cache.push(o);
      });
      for (const o of cache) o.visible = false;
    };
    const baseSetSize = this.ao.setSize.bind(this.ao);
    this.ao.setSize = (w: number, h: number) => baseSetSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale)));
    this.composer.addPass(this.ao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  /** `night` 0..1: lights glow more after dark, when they're the brightest things around. */
  render(dt: number, night: number): void {
    this.bloom.threshold = 1.25 - 0.45 * night;
    this.bloom.strength = 0.3 + 0.22 * night;
    this.ao.blendIntensity = 1 - 0.4 * night;
    this.grade.uniforms.night.value = night;
    this.composer.render(dt);
  }
}
