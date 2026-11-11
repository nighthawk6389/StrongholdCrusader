import type { Sim } from '../sim/sim';
import { UNIT_TYPES } from '../sim/unitTypes';

/** What a tutorial step can look at to decide it's done. */
export interface TutorialContext {
  sim: Sim;
  player: number;
  /** Camera has been panned, zoomed or rotated since the start. */
  cameraMoved: boolean;
  selectedSoldiers: number;
  controlling: boolean;
  moraleOpen: boolean;
  /** Counters of events seen since the tutorial began. */
  recruited: number;
  moved: boolean;
}

export interface TutorialStep {
  id: string;
  title: string;
  desktop: string;
  touch: string;
  done(c: TutorialContext): boolean;
}

const count = (c: TutorialContext, kinds: string[]): number =>
  c.sim.structures.filter((s) => s.owner === c.player && kinds.includes(s.kind)).length;

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'camera',
    title: 'Look around',
    desktop: 'Move the camera with WASD (or push the mouse against a screen edge). Q and E rotate, the wheel zooms.',
    touch: 'Drag with one finger to look around. Pinch to zoom, twist two fingers to rotate.',
    done: (c) => c.cameraMoved,
  },
  {
    id: 'select',
    title: 'Select your soldiers',
    desktop: 'Drag a box around your soldiers (blue), or click one. Double-click picks every soldier of that type.',
    touch: 'Tap a soldier (blue). Double-tap picks every soldier of that type, or use ▢ Box to drag-select.',
    done: (c) => c.selectedSoldiers > 0,
  },
  {
    id: 'move',
    title: 'Give an order',
    desktop: 'With soldiers selected, right-click the ground to send them there.',
    touch: 'With soldiers selected, tap the ground to send them there.',
    done: (c) => c.moved,
  },
  {
    id: 'lumber',
    title: 'Cut timber',
    desktop: 'Press B (or Build), choose Lumber Camp and place it near trees. Civilians will chop and haul the logs.',
    touch: 'Tap Build, choose Lumber Camp, tap near some trees and confirm with ✓.',
    done: (c) => count(c, ['lumber']) > 0,
  },
  {
    id: 'quarry',
    title: 'Quarry stone',
    desktop: 'Build a Quarry right against a rock outcrop (the brown boulders). Concrete builds walls.',
    touch: 'Build a Quarry right against a rock outcrop (the brown boulders). Concrete builds walls.',
    done: (c) => count(c, ['quarry']) > 0,
  },
  {
    id: 'food',
    title: 'Grow food',
    desktop: 'Build an Orchard on the green ground by an oasis, or a Goat Ranch anywhere. Hungry people leave.',
    touch: 'Build an Orchard on the green ground by an oasis, or a Goat Ranch anywhere. Hungry people leave.',
    done: (c) => count(c, ['orchard', 'ranch']) > 0,
  },
  {
    id: 'walls',
    title: 'Wall in',
    desktop: 'Choose Concrete Wall and drag a line across the side facing the enemy (east). Eight sections will do.',
    touch: 'Choose Concrete Wall, tap where it starts and where it ends, then confirm. Eight sections will do.',
    done: (c) => count(c, ['wall']) >= 8,
  },
  {
    id: 'gate',
    title: 'Add a gatehouse',
    desktop: 'Place a Gatehouse in your wall line (R turns it). It opens for your troops only.',
    touch: 'Place a Gatehouse in your wall line (↻ turns it). It opens for your troops only.',
    done: (c) => count(c, ['gate']) > 0,
  },
  {
    id: 'garrison',
    title: 'Man the walls',
    desktop: 'Build Stairs against your wall, then select soldiers and right-click the wall top. Troops up there shoot further and take less damage.',
    touch: 'Build Stairs against your wall, then select soldiers and tap the wall top. Troops up there shoot further and take less damage.',
    done: (c) => {
      const u = c.sim.units;
      for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === c.player && u.layer[i] === 1 && UNIT_TYPES[u.kind[i]].armed) return true;
      return false;
    },
  },
  {
    id: 'recruit',
    title: 'Train a soldier',
    desktop: 'Click the Barracks and press +1 next to Rifleman. An idle civilian picks up a rifle from the Armory and trains.',
    touch: 'Tap the Barracks and press +1 next to Rifleman. An idle civilian picks up a rifle from the Armory and trains.',
    done: (c) => c.recruited > 0,
  },
  {
    id: 'control',
    title: 'Take direct control',
    desktop: 'Select one soldier and press F. Aim with the mouse, left-click fires, right-click aims down the sights. Esc returns.',
    touch: 'Select one soldier and tap Take control. Drag on the right to aim, tap Fire. ✕ Exit returns.',
    done: (c) => c.controlling,
  },
  {
    id: 'morale',
    title: 'Keep people happy',
    desktop: 'Click Morale in the top bar to set rations and taxes. Above 50 morale new people arrive; below it they leave.',
    touch: 'Tap Morale in the top bar to set rations and taxes. Above 50 morale new people arrive; below it they leave.',
    done: (c) => c.moraleOpen,
  },
  {
    id: 'light',
    title: 'Get ready for night',
    desktop: 'Build a Floodlight facing where the enemy would come from: at night you only see what is lit (or close by).',
    touch: 'Build a Floodlight facing where the enemy would come from: at night you only see what is lit (or close by).',
    done: (c) => count(c, ['floodlight', 'searchlight']) > 2,
  },
  {
    id: 'attack',
    title: 'Take the outpost',
    desktop:
      'An enemy outpost sits to the east. Send soldiers and your engineers at its gatehouse (right-click it): engineers blow walls open. Destroy the HQ or kill their Commander.',
    touch:
      'An enemy outpost sits to the east. Send soldiers and your engineers at its gatehouse (tap it): engineers blow walls open. Destroy the HQ or kill their Commander.',
    done: (c) => c.sim.result?.result === 'victory',
  },
];

const DONE_KEY = 'siege-tutorial-done';

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

/** Walks the player through the steps in order; a step completes once its condition holds. */
export class Tutorial {
  index = 0;
  /** Time left showing "done" before moving on. */
  private celebrate = 0;

  get finished(): boolean {
    return this.index >= TUTORIAL_STEPS.length;
  }

  get step(): TutorialStep | null {
    return TUTORIAL_STEPS[this.index] ?? null;
  }

  /** Returns true when the visible state changed. */
  update(c: TutorialContext, dt: number): boolean {
    if (this.finished) return false;
    if (this.celebrate > 0) {
      this.celebrate -= dt;
      if (this.celebrate <= 0) {
        this.index++;
        if (this.finished) markTutorialDone();
        return true;
      }
      return false;
    }
    if (this.step!.done(c)) {
      this.celebrate = 1.2;
      return true;
    }
    return false;
  }

  get celebrating(): boolean {
    return this.celebrate > 0;
  }

  skip(): void {
    if (this.finished) return;
    this.celebrate = 0;
    this.index++;
    if (this.finished) markTutorialDone();
  }
}
