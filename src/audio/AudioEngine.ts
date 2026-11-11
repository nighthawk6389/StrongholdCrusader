/**
 * Procedural audio: every sound is synthesized with WebAudio (noise bursts, filtered sweeps and simple
 * oscillators), so there are no audio files to license or download. Sounds are positioned relative to
 * the camera (stereo pan + distance falloff), voices are capped, and a small music director layers a
 * day/night pad with a combat pulse.
 */

export interface Listener {
  x: number;
  z: number;
  /** Ground-plane "right" direction of the camera (unit vector). */
  rx: number;
  rz: number;
  /** Distance at which sounds are at half volume. */
  range: number;
}

export type SoundKind =
  | 'rifle'
  | 'silenced'
  | 'mg'
  | 'heavy'
  | 'explosion'
  | 'bigExplosion'
  | 'mortar'
  | 'whistle'
  | 'build'
  | 'crumble'
  | 'whoosh'
  | 'drone'
  | 'click'
  | 'alert'
  | 'radio'
  | 'victory'
  | 'defeat'
  | 'hire';

interface Voice {
  end: number;
}

const MAX_VOICES = 28;
/** Minimum gap between two sounds of the same kind (ms): a firefight shouldn't be a wall of noise. */
const MIN_GAP: Partial<Record<SoundKind, number>> = { rifle: 22, silenced: 30, mg: 18, heavy: 60, explosion: 50, mortar: 60, whistle: 120, build: 60 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private voices: Voice[] = [];
  private last = new Map<SoundKind, number>();
  private music: MusicDirector | null = null;
  private volumes = { master: 0.8, sfx: 0.9, music: 0.5 };
  /** 0..1: how much fighting there is near you lately (drives the combat music layer). */
  intensity = 0;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Browsers only allow audio after a user gesture: call this from one. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    // One second of white noise, reused by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.music = new MusicDirector(ctx, this.musicBus, this.noise);
  }

  setVolumes(v: { master: number; sfx: number; music: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
  }

  /** Pause all sound (tab hidden / game left) and bring it back. */
  setSuspended(on: boolean): void {
    if (!this.ctx) return;
    if (on && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
    if (!on && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /** Per frame: music follows the time of day and the fighting. */
  update(dt: number, daylight: number, paused: boolean): void {
    this.intensity = Math.max(0, this.intensity - dt * 0.08);
    if (this.music && this.ready) this.music.update(daylight, paused ? 0 : this.intensity);
  }

  /**
   * Play a sound. With a position (and the listener) it's placed in the stereo field and fades with
   * distance; without one it plays centred (UI sounds). Returns false if it was culled.
   */
  play(kind: SoundKind, at?: { x: number; z: number }, listener?: Listener, gain = 1, extra = 0): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    const now = ctx.currentTime;
    const ms = now * 1000;
    const gap = MIN_GAP[kind] ?? 0;
    if (gap && ms - (this.last.get(kind) ?? -1e9) < gap) return false;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= MAX_VOICES && kind !== 'click' && kind !== 'alert') return false;
    let vol = gain;
    let pan = 0;
    if (at && listener) {
      const dx = at.x - listener.x;
      const dz = at.z - listener.z;
      const d = Math.hypot(dx, dz);
      if (d > listener.range * 5) return false;
      vol *= 1 / (1 + (d / listener.range) ** 2);
      pan = Math.max(-1, Math.min(1, (dx * listener.rx + dz * listener.rz) / (listener.range * 1.4)));
      if (vol < 0.02) return false;
    }
    this.last.set(kind, ms);
    const out = ctx.createGain();
    out.gain.value = vol;
    let node: AudioNode = out;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      node = p;
    }
    node.connect(this.sfxBus);
    const len = this.synth(kind, out, now, extra);
    this.voices.push({ end: now + len });
    // Let the graph be collected once it's done.
    setTimeout(() => {
      try {
        node.disconnect();
        out.disconnect();
      } catch {
        /* already gone */
      }
    }, (len + 0.3) * 1000);
    return true;
  }

  // ------------------------------------------------------------------ recipes

  private synth(kind: SoundKind, out: GainNode, t: number, extra: number): number {
    switch (kind) {
      case 'rifle':
        this.burst(out, t, 2200, 0.9, 0.09, 0.5);
        this.tone(out, t, 'sine', 160, 60, 0.07, 0.35);
        return 0.15;
      case 'silenced':
        this.burst(out, t, 3800, 1.4, 0.05, 0.18);
        return 0.08;
      case 'mg':
        this.burst(out, t, 1700, 0.8, 0.07, 0.42);
        this.tone(out, t, 'sine', 130, 55, 0.06, 0.3);
        return 0.12;
      case 'heavy':
        this.burst(out, t, 700, 0.6, 0.45, 0.7, 'lowpass');
        this.tone(out, t, 'sine', 110, 32, 0.4, 0.8);
        return 0.6;
      case 'explosion':
        this.sweep(out, t, 1800, 160, 1.0, 0.85);
        this.tone(out, t, 'sine', 75, 28, 0.7, 0.9);
        return 1.2;
      case 'bigExplosion':
        this.sweep(out, t, 1400, 90, 1.6, 1);
        this.tone(out, t, 'sine', 60, 22, 1.1, 1);
        return 1.8;
      case 'mortar':
        this.burst(out, t, 500, 0.7, 0.16, 0.6, 'lowpass');
        this.tone(out, t, 'sine', 230, 90, 0.13, 0.5);
        return 0.25;
      case 'whistle': {
        // A falling whistle over the shell's flight (extra = seconds).
        const T = Math.max(0.5, Math.min(4, extra));
        const o = this.ctx!.createOscillator();
        const g = this.ctx!.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(1700, t);
        o.frequency.exponentialRampToValueAtTime(520, t + T);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.08, t + T * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + T);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + T + 0.05);
        return T;
      }
      case 'build':
        this.tone(out, t, 'triangle', 320, 300, 0.09, 0.45);
        this.tone(out, t + 0.1, 'triangle', 460, 440, 0.09, 0.4);
        return 0.25;
      case 'crumble':
        this.sweep(out, t, 900, 120, 0.9, 0.6);
        for (let k = 0; k < 4; k++) this.burst(out, t + 0.08 + k * 0.11, 1200 - k * 150, 1.5, 0.05, 0.3);
        return 1;
      case 'whoosh':
        this.sweepBand(out, t, 300, 1600, 0.7, 0.5);
        return 0.8;
      case 'drone':
        this.tone(out, t, 'sawtooth', 170, 260, 0.45, 0.12);
        return 0.5;
      case 'click':
        this.tone(out, t, 'sine', 1100, 900, 0.03, 0.18);
        return 0.05;
      case 'alert':
        this.tone(out, t, 'sine', 660, 660, 0.11, 0.25);
        this.tone(out, t + 0.13, 'sine', 880, 880, 0.14, 0.25);
        return 0.3;
      case 'radio':
        this.burst(out, t, 1800, 2.5, 0.16, 0.25, 'bandpass');
        this.tone(out, t + 0.17, 'square', 1250, 1250, 0.05, 0.06);
        return 0.25;
      case 'hire':
        this.tone(out, t, 'triangle', 523, 523, 0.12, 0.3);
        this.tone(out, t + 0.12, 'triangle', 784, 784, 0.18, 0.3);
        return 0.35;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, k) => this.tone(out, t + k * 0.16, 'triangle', f, f, k === 3 ? 0.9 : 0.2, 0.35));
        return 1.5;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, k) => this.tone(out, t + k * 0.22, 'triangle', f, f * 0.98, k === 3 ? 1.1 : 0.25, 0.32));
        return 1.9;
    }
  }

  /** Filtered noise with a fast attack and an exponential decay. */
  private burst(out: AudioNode, t: number, freq: number, q: number, decay: number, peak: number, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq * (0.92 + Math.random() * 0.16);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  /** Noise through a lowpass whose cutoff falls (explosions). */
  private sweep(out: AudioNode, t: number, from: number, to: number, decay: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  /** Noise through a bandpass that rises (fire catching). */
  private sweepBand(out: AudioNode, t: number, from: number, to: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** An oscillator gliding from one pitch to another with a decay envelope. */
  private tone(out: AudioNode, t: number, type: OscillatorType, from: number, to: number, decay: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
}

/**
 * Background music: a slow pad (major by day, minor and darker at night) and a combat pulse that
 * swells with the fighting, plus sparse plucked notes on quiet days. All generated live.
 */
class MusicDirector {
  private pad: OscillatorNode[] = [];
  private padGain: GainNode;
  private filter: BiquadFilterNode;
  private pulseGain: GainNode;
  private nextBeat = 0;
  private beat = 0;
  private nextPluck = 0;
  private delay: DelayNode;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    private noise: AudioBuffer,
  ) {
    const t = ctx.currentTime;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 700;
    this.filter.Q.value = 0.7;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.gain.setTargetAtTime(0.16, t, 3);
    this.filter.connect(this.padGain).connect(out);
    // A2, E3, C#4/C4 (third flips with day and night), plus a slow-beating detuned twin of the root.
    for (const [f, det] of [
      [110, 0],
      [110, 7],
      [164.81, 0],
      [277.18, 0],
    ] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = f > 200 ? 0.18 : 0.3;
      o.connect(g).connect(this.filter);
      o.start(t);
      this.pad.push(o);
    }
    // Slow filter breathing.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const depth = ctx.createGain();
    depth.gain.value = 180;
    lfo.connect(depth).connect(this.filter.frequency);
    lfo.start(t);

    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(out);

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(out);
    this.nextBeat = t + 0.5;
    this.nextPluck = t + 4;
  }

  update(daylight: number, intensity: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const night = 1 - daylight;
    this.pad[3].frequency.setTargetAtTime(night > 0.5 ? 261.63 : 277.18, t, 1.5);
    this.filter.frequency.setTargetAtTime(380 + daylight * 520 + intensity * 400, t, 2);
    this.pulseGain.gain.setTargetAtTime(Math.min(1, intensity * 1.4) * 0.5, t, 0.8);
    // Combat pulse: kick on the beat, a muted tom on the off-beat, scheduled just ahead.
    while (this.nextBeat < t + 0.25) {
      const bt = this.nextBeat;
      this.drum(bt, this.beat % 2 === 0 ? 95 : 150, this.beat % 2 === 0 ? 0.9 : 0.35);
      if (this.beat % 4 === 3) this.hat(bt + 0.25);
      this.beat++;
      this.nextBeat += 0.5 - Math.min(0.12, intensity * 0.12);
    }
    // Quiet days: an occasional plucked note from the pentatonic scale, echoing.
    if (t >= this.nextPluck) {
      this.nextPluck = t + 3 + Math.random() * 5;
      if (daylight > 0.5 && intensity < 0.3) {
        const scale = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88];
        this.pluck(t + 0.05, scale[Math.floor(Math.random() * scale.length)]);
      } else if (daylight <= 0.5 && intensity < 0.3 && Math.random() < 0.5) {
        const scale = [220, 261.63, 293.66, 329.63, 392];
        this.pluck(t + 0.05, scale[Math.floor(Math.random() * scale.length)] / 2);
      }
    }
  }

  private drum(t: number, f: number, peak: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.pulseGain);
    o.start(t);
    o.stop(t + 0.25);
  }

  private hat(t: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.pulseGain);
    src.start(t);
    src.stop(t + 0.06);
  }

  private pluck(t: number, f: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g);
    g.connect(this.delay);
    g.connect(this.padGain);
    o.start(t);
    o.stop(t + 1.7);
  }
}

/** The one engine the whole app shares (UI clicks need it too). */
export const audio = new AudioEngine();
