import { create } from 'zustand';
import type { PhaseName } from '../sim/clock';

export interface HudState {
  clock: string;
  phase: PhaseName;
  day: number;
  speed: number;
  paused: boolean;
  selectionCount: number;
  selectionLabel: string;
  canControl: boolean;
  mode: 'rts' | 'control';
  controlledHp: number;
  controlledName: string;
  aiming: boolean;
  pointerLocked: boolean;
  selectMode: boolean;
  isTouch: boolean;
  fps: number;
  simMs: number;
  playerUnits: number;
  enemyUnits: number;
  showHelp: boolean;
  debug: boolean;
  quality: string;
  toast: string | null;
}

export const useHud = create<HudState>(() => ({
  clock: '--:--',
  phase: 'day',
  day: 1,
  speed: 1,
  paused: false,
  selectionCount: 0,
  selectionLabel: '',
  canControl: false,
  mode: 'rts',
  controlledHp: 1,
  controlledName: '',
  aiming: false,
  pointerLocked: false,
  selectMode: false,
  isTouch: false,
  fps: 0,
  simMs: 0,
  playerUnits: 0,
  enemyUnits: 0,
  showHelp: false,
  debug: false,
  quality: 'high',
  toast: null,
}));

export const setHud = (patch: Partial<HudState>): void => useHud.setState(patch);
