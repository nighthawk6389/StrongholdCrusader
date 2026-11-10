/** Simulation timing and the day/night cycle. */

export const TICK_RATE = 20; // sim ticks per second
export const TICK_SEC = 1 / TICK_RATE;

/** Full day/night cycle length in seconds (8 minutes). */
export const CYCLE_SEC = 480;

/** Phase durations in seconds, in cycle order starting at dawn. */
export const PHASES = [
  { name: 'dawn', sec: 30, hourFrom: 5, hourTo: 7 },
  { name: 'day', sec: 270, hourFrom: 7, hourTo: 19 },
  { name: 'dusk', sec: 30, hourFrom: 19, hourTo: 21 },
  { name: 'night', sec: 150, hourFrom: 21, hourTo: 29 },
] as const;

export type PhaseName = (typeof PHASES)[number]['name'];

export interface CycleInfo {
  /** Seconds into the current cycle, [0, CYCLE_SEC). */
  cycleSec: number;
  /** Which full cycle we're in (0-based). */
  day: number;
  phase: PhaseName;
  /** 0..1 progress through the current phase. */
  phaseT: number;
  /** In-game hour of day, [0, 24). */
  hour: number;
  /** Amount of daylight 0 (night) .. 1 (full day). */
  daylight: number;
}

/** Seconds into the cycle at which each phase starts. */
export function phaseStartSec(name: PhaseName): number {
  let acc = 0;
  for (const p of PHASES) {
    if (p.name === name) return acc;
    acc += p.sec;
  }
  return 0;
}

export function cycleInfo(totalSec: number): CycleInfo {
  const day = Math.floor(totalSec / CYCLE_SEC);
  const cycleSec = totalSec - day * CYCLE_SEC;
  let acc = 0;
  for (const p of PHASES) {
    if (cycleSec < acc + p.sec) {
      const phaseT = (cycleSec - acc) / p.sec;
      const rawHour = p.hourFrom + (p.hourTo - p.hourFrom) * phaseT;
      let daylight: number;
      switch (p.name) {
        case 'dawn':
          daylight = phaseT;
          break;
        case 'day':
          daylight = 1;
          break;
        case 'dusk':
          daylight = 1 - phaseT;
          break;
        default:
          daylight = 0;
      }
      return { cycleSec, day, phase: p.name, phaseT, hour: rawHour % 24, daylight };
    }
    acc += p.sec;
  }
  return { cycleSec, day, phase: 'night', phaseT: 1, hour: 5, daylight: 0 };
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
