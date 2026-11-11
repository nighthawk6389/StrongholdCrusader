import * as THREE from 'three';
import type { Game } from '../game/Game';
import { UNIT_TYPES } from '../sim/unitTypes';
import { setHud, useHud } from '../ui/store';

interface Ptr {
  id: number;
  type: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
  button: number;
  moved: number;
}

/** Max press duration that still counts as a tap (generous for laggy phones). */
const TAP_MS = 600;
/** Max gap between taps/clicks for a double-tap. */
const DOUBLE_TAP_MS = 400;
const TAP_PX = 12;
const DRAG_PX = 7;

/**
 * Translates mouse / keyboard / touch into camera moves and game actions.
 * Two modes: RTS (select, order, pan/zoom/rotate) and Control (over-the-shoulder).
 */
export class InputController {
  /** Fire button held (touch HUD). */
  fireHeld = false;
  /** One-shot requests, delivered with the next control intent. */
  reloadReq = false;
  plantReq = false;
  private mode: 'rts' | 'control' = 'rts';
  private keys = new Set<string>();
  private ptrs = new Map<number, Ptr>();
  private boxing = false;
  private rotatingMouse = false;
  private mouseFire = false;
  private mouse = { x: -1, y: -1, inside: false };
  /** Edge scrolling only makes sense with a real hovering mouse. */
  private readonly finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  private pinch: { dist: number; angle: number; midX: number; midY: number } | null = null;
  private lastTap = { t: 0, unit: -1 };
  private groups = new Map<number, number[]>();
  private lockChangedAt = 0;

  // Touch control (virtual joystick + look)
  private joy: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private lookPtr: { id: number; x: number; y: number } | null = null;

  private boxEl: HTMLDivElement;
  private joyBase: HTMLDivElement;
  private joyKnob: HTMLDivElement;
  private tmpV = new THREE.Vector3();
  private scr = { x: 0, y: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    overlay: HTMLElement,
    private game: Game,
  ) {
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box';
    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    overlay.append(this.boxEl, this.joyBase);

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', () => (this.mouse.inside = false));
    // Note: `inside` is only set by real mouse movement (phones fire synthetic mouse events at 0,0).
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFire = false;
    });
    document.addEventListener('mousemove', (e) => this.onLockedMouseMove(e));
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
  }

  private get rts() {
    return this.game.renderer.rts;
  }

  private get ots() {
    return this.game.renderer.ots;
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number): void {
    if (this.mode !== 'rts') return;
    const k = this.keys;
    const speed = this.rts.dist * 1.1 * dt;
    let right = 0;
    let up = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) right -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) right += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) up += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) up -= 1;

    // Edge scrolling (desktop mouse only, not while dragging).
    if (this.finePointer && this.mouse.inside && !this.boxing && this.ptrs.size === 0 && document.hasFocus()) {
      const r = this.canvas.getBoundingClientRect();
      const m = 6;
      if (this.mouse.x <= r.left + m) right -= 1;
      if (this.mouse.x >= r.right - m) right += 1;
      if (this.mouse.y <= r.top + m) up += 1;
      if (this.mouse.y >= r.bottom - m) up -= 1;
    }
    if (right || up) this.rts.pan(right * speed, up * speed);
    if (k.has('KeyQ')) this.rts.rotate(1.6 * dt);
    if (k.has('KeyE')) this.rts.rotate(-1.6 * dt);
    if (k.has('Equal') || k.has('NumpadAdd')) this.rts.zoom(1 - dt * 1.5);
    if (k.has('Minus') || k.has('NumpadSubtract')) this.rts.zoom(1 + dt * 1.5);
  }

  /** Movement/aim intent for the possessed unit, sampled once per sim tick. */
  controlIntent(): { mx: number; mz: number; yaw: number; fire: boolean; aim: boolean; reload: boolean; plant: boolean } {
    let f = 0;
    let s = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    if (this.joy) {
      f += -this.joy.dy;
      s += this.joy.dx;
    }
    const yaw = this.ots.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    const reload = this.reloadReq;
    const plant = this.plantReq;
    this.reloadReq = this.plantReq = false;
    return {
      mx: fx * f + rx * s,
      mz: fz * f + rz * s,
      yaw,
      fire: this.fireHeld || this.mouseFire,
      aim: this.ots.aiming,
      reload,
      plant,
    };
  }

  // ------------------------------------------------------------------ mode switches

  enterControl(): void {
    this.mode = 'control';
    this.boxing = false;
    this.boxEl.style.display = 'none';
    this.ptrs.clear();
    this.pinch = null;
    if (!useHud.getState().isTouch) this.lockPointer();
  }

  exitControl(): void {
    this.mode = 'rts';
    this.mouseFire = false;
    this.fireHeld = false;
    this.reloadReq = this.plantReq = false;
    this.joy = null;
    this.lookPtr = null;
    this.joyBase.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }

  lockPointer(): void {
    const req = this.canvas.requestPointerLock?.bind(this.canvas) as
      | ((o?: { unadjustedMovement?: boolean }) => Promise<void> | void)
      | undefined;
    try {
      const r = req?.();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* pointer lock unavailable */
    }
  }

  private onPointerLockChange(): void {
    const locked = document.pointerLockElement === this.canvas;
    this.lockChangedAt = performance.now();
    setHud({ pointerLocked: locked });
  }

  private onLockedMouseMove(e: MouseEvent): void {
    if (this.mode !== 'control' || document.pointerLockElement !== this.canvas) return;
    // Chromium can emit a bogus, huge movement right after the lock engages; ignore it.
    if (performance.now() - this.lockChangedAt < 80) return;
    const mx = Math.max(-120, Math.min(120, e.movementX));
    const my = Math.max(-120, Math.min(120, e.movementY));
    const sens = this.ots.aiming ? 0.0012 : 0.0024;
    this.ots.addLook(-mx * sens, -my * sens);
  }

  // ------------------------------------------------------------------ pointer events

  private onDown(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    const p: Ptr = {
      id: e.pointerId,
      type: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startT: performance.now(),
      button: e.button,
      moved: 0,
    };
    this.ptrs.set(e.pointerId, p);

    if (this.mode === 'control') {
      this.controlDown(e, p);
      return;
    }

    if (e.pointerType === 'mouse') {
      if (e.button === 1) this.rotatingMouse = true;
      if (e.button === 0 && this.game.placing === 'wall') {
        const g = this.game.renderer.pickGround(e.clientX, e.clientY);
        if (g) this.game.wallStart(g.x, g.z);
      }
      return;
    }

    // Touch / pen
    if (this.ptrs.size === 2) {
      this.boxing = false;
      this.boxEl.style.display = 'none';
      this.pinch = this.pinchState();
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
    }
    if (e.pointerType === 'mouse' && this.mode === 'rts' && this.game.placing && !this.rotatingMouse) {
      const g = this.game.renderer.pickGround(e.clientX, e.clientY);
      if (g) this.game.previewPlacementAt(g.x, g.z);
    }
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const prevX = p.x;
    const prevY = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved = Math.max(p.moved, Math.hypot(p.x - p.startX, p.y - p.startY));

    if (this.mode === 'control') {
      this.controlMove(p);
      return;
    }

    if (p.type === 'mouse') {
      if (this.rotatingMouse || (p.button === 2 && p.moved > DRAG_PX)) {
        this.rts.rotate(-dx * 0.006);
        return;
      }
      if (p.button === 0 && p.moved > DRAG_PX && !this.game.placing) this.updateBox(p);
      return;
    }

    // Touch
    if (this.ptrs.size >= 2 && this.pinch) {
      const now = this.pinchState();
      if (now.dist > 0 && this.pinch.dist > 0) this.rts.zoom(this.pinch.dist / now.dist);
      let da = now.angle - this.pinch.angle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.rts.rotate(da);
      this.panByScreen(this.pinch.midX, this.pinch.midY, now.midX, now.midY);
      this.pinch = now;
      return;
    }
    if (this.ptrs.size === 1) {
      if (useHud.getState().selectMode) {
        if (p.moved > DRAG_PX) this.updateBox(p);
      } else if (p.moved > DRAG_PX) {
        this.panByScreen(prevX, prevY, p.x, p.y);
      }
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const p = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    if (!p) return;

    if (this.mode === 'control') {
      this.controlUp(e, p);
      return;
    }

    if (p.type === 'mouse') {
      if (e.button === 1) this.rotatingMouse = false;
      if (cancelled) return;
      if (this.game.targeting) {
        if (e.button === 0) {
          const g = this.game.renderer.pickGround(p.x, p.y);
          if (g) this.game.fireFlareAt(g.x, g.z);
        } else if (e.button === 2) this.game.cancelTargeting();
        return;
      }
      if (e.button === 0) {
        if (this.game.placing) {
          const g = this.game.renderer.pickGround(p.x, p.y);
          if (g) {
            this.game.previewPlacementAt(g.x, g.z);
            this.game.confirmPlacing();
          }
        } else if (this.boxing) this.finishBox(p, e.shiftKey);
        else this.clickSelect(p.x, p.y, e.shiftKey, e.ctrlKey || e.metaKey, 22);
      } else if (e.button === 2 && p.moved <= DRAG_PX) {
        if (this.game.placing) {
          this.game.cancelPlacing();
          return;
        }
        this.commandAt(p.x, p.y, 22);
      }
      return;
    }

    // Touch
    if (this.ptrs.size < 2) this.pinch = null;
    if (cancelled) return;
    if (this.boxing) {
      this.finishBox(p, false);
      return;
    }
    const quick = performance.now() - p.startT < TAP_MS && p.moved < TAP_PX;
    if (quick && this.ptrs.size === 0) this.handleTap(p.x, p.y);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.mode !== 'rts') return;
    this.rts.zoom(Math.exp(e.deltaY * 0.0012));
  }

  // ------------------------------------------------------------------ RTS helpers

  private pinchState(): { dist: number; angle: number; midX: number; midY: number } {
    const [a, b] = [...this.ptrs.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  /** Drag the ground under the finger: keeps the touched point under the finger. */
  private panByScreen(x0: number, y0: number, x1: number, y1: number): void {
    const r = this.game.renderer;
    const a = r.pickGround(x0, y0);
    const b = r.pickGround(x1, y1);
    if (a && b) this.rts.panWorld(a.x - b.x, a.z - b.z);
  }

  private updateBox(p: Ptr): void {
    this.boxing = true;
    const x = Math.min(p.startX, p.x);
    const y = Math.min(p.startY, p.y);
    Object.assign(this.boxEl.style, {
      display: 'block',
      left: `${x}px`,
      top: `${y}px`,
      width: `${Math.abs(p.x - p.startX)}px`,
      height: `${Math.abs(p.y - p.startY)}px`,
    });
  }

  private finishBox(p: Ptr, additive: boolean): void {
    this.boxing = false;
    this.boxEl.style.display = 'none';
    const x0 = Math.min(p.startX, p.x);
    const x1 = Math.max(p.startX, p.x);
    const y0 = Math.min(p.startY, p.y);
    const y1 = Math.max(p.startY, p.y);
    const ids: number[] = [];
    this.forOwnUnitsOnScreen((id, sx, sy) => {
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(id);
    });
    this.game.select(ids, additive);
  }

  private forOwnUnitsOnScreen(fn: (id: number, sx: number, sy: number) => void): void {
    const u = this.game.sim.units;
    const r = this.game.renderer;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.game.player || !UNIT_TYPES[u.kind[i]].selectable) continue;
      const v = this.game.unitScreenAnchor(i, this.tmpV);
      if (r.toScreen(v.x, v.y, v.z, this.scr)) fn(i, this.scr.x, this.scr.y);
    }
  }

  /** Nearest unit (any owner) to a screen point within `radius` pixels. */
  private pickUnit(x: number, y: number, radius: number): number {
    const u = this.game.sim.units;
    const r = this.game.renderer;
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      // Your civilians work on their own; clicks should go to soldiers (or the ground/building).
      if (u.owner[i] === this.game.player && !UNIT_TYPES[u.kind[i]].selectable) continue;
      // Enemies you can't see can't be clicked either.
      if (u.owner[i] !== this.game.player && !this.game.sim.vision.isSeen(this.game.player, i)) continue;
      const v = this.game.unitScreenAnchor(i, this.tmpV);
      if (!r.toScreen(v.x, v.y, v.z, this.scr)) continue;
      const d = (this.scr.x - x) ** 2 + (this.scr.y - y) ** 2;
      // Prefer own units on ties so a click in a melee selects yours.
      const bias = u.owner[i] === this.game.player ? 0.8 : 1;
      if (d * bias < bestD) {
        bestD = d * bias;
        best = i;
      }
    }
    return best;
  }

  private selectSameKindOnScreen(id: number): void {
    const u = this.game.sim.units;
    const kind = u.kind[id];
    const r = this.canvas.getBoundingClientRect();
    const ids: number[] = [];
    this.forOwnUnitsOnScreen((i, sx, sy) => {
      if (u.kind[i] === kind && sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom) ids.push(i);
    });
    this.game.select(ids, false);
  }

  private clickSelect(x: number, y: number, additive: boolean, sameKind: boolean, radius: number): void {
    const id = this.pickUnit(x, y, radius);
    const u = this.game.sim.units;
    if (id >= 0 && u.owner[id] === this.game.player) {
      const now = performance.now();
      if (sameKind || (this.lastTap.unit === id && now - this.lastTap.t < DOUBLE_TAP_MS)) this.selectSameKindOnScreen(id);
      else this.game.select([id], additive);
      this.lastTap = { t: now, unit: id };
    } else if (!additive) {
      this.game.deselect();
      this.pickStructure(x, y);
    }
  }

  private handleTap(x: number, y: number): void {
    if (this.game.targeting) {
      const g = this.game.renderer.pickGround(x, y);
      if (g) this.game.fireFlareAt(g.x, g.z);
      return;
    }
    if (this.game.placing) {
      const g = this.game.renderer.pickGround(x, y);
      if (!g) return;
      if (this.game.placing === 'wall' && !this.game.wallAnchor) this.game.wallStart(g.x, g.z);
      else this.game.previewPlacementAt(g.x, g.z);
      return;
    }
    const id = this.pickUnit(x, y, 34);
    const u = this.game.sim.units;
    if (id >= 0 && u.owner[id] === this.game.player) {
      this.clickSelect(x, y, false, false, 34);
      return;
    }
    if (this.game.selected.size > 0) {
      this.commandAt(x, y, 34);
      return;
    }
    this.pickStructure(x, y);
  }

  /** Order the selection at a screen point: attack an enemy unit/structure, or move (onto walls too). */
  private commandAt(x: number, y: number, radius: number): void {
    const game = this.game;
    const u = game.sim.units;
    const unit = this.pickUnit(x, y, radius);
    const p = game.renderer.pickPoint(x, y);
    if (unit >= 0 && u.owner[unit] !== game.player) {
      game.commandAt(p ?? { x: u.x[unit], z: u.z[unit], layer: 0 }, unit, -1);
      return;
    }
    if (!p) return;
    const s = game.sim.structureAt(Math.floor(p.x), Math.floor(p.z));
    if (s && s.owner !== game.player) {
      game.commandAt(p, -1, s.id);
      return;
    }
    game.commandAt(p, -1, -1);
  }

  /** Select the building under a screen point; returns true if one was found. */
  private pickStructure(x: number, y: number): boolean {
    const g = this.game.renderer.pickPoint(x, y);
    if (!g) return false;
    const s = this.game.sim.structureAt(Math.floor(g.x), Math.floor(g.z));
    if (!s) {
      this.game.deselectStructure();
      return false;
    }
    this.game.selectStructure(s.id);
    return true;
  }

  // ------------------------------------------------------------------ control mode

  private controlDown(e: PointerEvent, p: Ptr): void {
    if (p.type === 'mouse') {
      if (document.pointerLockElement !== this.canvas) {
        this.lockPointer();
        return;
      }
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) {
        this.ots.aiming = true;
        setHud({ aiming: true });
      }
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    if (p.x < r.left + r.width * 0.45 && !this.joy) {
      this.joy = { id: p.id, ox: p.x, oy: p.y, dx: 0, dy: 0 };
      Object.assign(this.joyBase.style, { display: 'block', left: `${p.x}px`, top: `${p.y}px` });
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
    } else if (!this.lookPtr) {
      this.lookPtr = { id: p.id, x: p.x, y: p.y };
    }
  }

  private controlMove(p: Ptr): void {
    if (this.joy && p.id === this.joy.id) {
      const max = 56;
      let dx = p.x - this.joy.ox;
      let dy = p.y - this.joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.joy.dx = dx / max;
      this.joy.dy = dy / max;
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (this.lookPtr && p.id === this.lookPtr.id) {
      const sens = this.ots.aiming ? 0.0035 : 0.0065;
      this.ots.addLook(-(p.x - this.lookPtr.x) * sens, -(p.y - this.lookPtr.y) * sens * 0.8);
      this.lookPtr.x = p.x;
      this.lookPtr.y = p.y;
    }
  }

  private controlUp(e: PointerEvent, p: Ptr): void {
    if (p.type === 'mouse') {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) {
        this.ots.aiming = false;
        setHud({ aiming: false });
      }
      return;
    }
    if (this.joy && p.id === this.joy.id) {
      this.joy = null;
      this.joyBase.style.display = 'none';
    }
    if (this.lookPtr && p.id === this.lookPtr.id) this.lookPtr = null;
  }

  // ------------------------------------------------------------------ keyboard

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement) return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (!down) return;

    if (this.mode === 'control') {
      switch (e.code) {
        case 'KeyF':
        case 'Escape':
          this.game.exitControl();
          break;
        case 'Tab':
          e.preventDefault();
          this.game.exitControl();
          break;
        case 'KeyR':
          this.reloadReq = true;
          break;
        case 'KeyG':
          this.plantReq = true;
          break;
        case 'KeyV':
          this.game.flareAtCrosshair();
          break;
        case 'KeyN':
          this.game.toggleNvg();
          break;
        case 'KeyT':
          this.game.toggleSlowMo();
          break;
      }
      return;
    }

    switch (e.code) {
      case 'KeyF':
        this.game.takeControl();
        break;
      case 'KeyV':
        this.game.startFlare();
        break;
      case 'Escape':
        if (this.game.targeting) this.game.cancelTargeting();
        else if (this.game.placing) this.game.cancelPlacing();
        else if (this.game.selectedStructure >= 0) this.game.deselectStructure();
        else this.game.deselect();
        setHud({ buildOpen: false, moraleOpen: false });
        break;
      case 'KeyB':
        this.game.setBuildOpen(!useHud.getState().buildOpen);
        break;
      case 'KeyR':
        this.game.rotatePlacement();
        break;
      case 'KeyH':
        this.game.centerOnBase();
        break;
      case 'KeyP':
        this.game.togglePause();
        break;
      case 'Space': {
        e.preventDefault();
        const u = this.game.sim.units;
        const ids = [...this.game.selected];
        if (ids.length) {
          const x = ids.reduce((a, id) => a + u.x[id], 0) / ids.length;
          const z = ids.reduce((a, id) => a + u.z[id], 0) / ids.length;
          this.rts.lookAtSoft(x, z);
        }
        break;
      }
      case 'KeyA':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.game.selectAll();
        }
        break;
      default:
        if (/^Digit[1-9]$/.test(e.code)) {
          const n = Number(e.code.slice(5));
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.groups.set(n, [...this.game.selected]);
            this.game.toast(`Group ${n} set`);
          } else {
            const g = this.groups.get(n);
            if (g) this.game.select(g, e.shiftKey);
          }
        }
    }
  }
}
