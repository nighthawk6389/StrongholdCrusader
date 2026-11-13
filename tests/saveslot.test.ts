import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimSlot, clearGame, newInstanceId, ownsSlot, readMeta, writeGame, type StoredGame } from '../src/game/saveSlot';

/** A minimal in-memory localStorage. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const game = (label: string): StoredGame => ({
  meta: { mode: 'sandbox', difficulty: 'normal', seed: 1, label, savedAt: Date.now() },
  save: {} as StoredGame['save'],
  view: { x: 0, z: 0, yaw: 0, dist: 30, speed: 1 },
});

describe('save slot ownership', () => {
  const g = globalThis as { localStorage?: Storage };
  let before: Storage | undefined;
  beforeEach(() => {
    before = g.localStorage;
    g.localStorage = fakeStorage();
  });
  afterEach(() => {
    g.localStorage = before;
  });

  it('only the copy of the game played last may write; touching an old copy takes the slot back', () => {
    const oldTab = newInstanceId();
    const newTab = newInstanceId();
    expect(oldTab).not.toBe(newTab);
    // Nobody has claimed it yet (an older version's save): anyone may write.
    expect(ownsSlot(oldTab)).toBe(true);
    claimSlot(oldTab);
    writeGame(game('first'));
    // A new game starts in another tab and takes over.
    claimSlot(newTab);
    writeGame(game('second'));
    expect(ownsSlot(oldTab)).toBe(false);
    expect(ownsSlot(newTab)).toBe(true);
    // The player goes back to the old tab and plays it: now that one is saved.
    claimSlot(oldTab);
    expect(ownsSlot(newTab)).toBe(false);
    expect(readMeta()?.label).toBe('second');
  });

  it('clearing the slot keeps the owner, so an old tab cannot sneak its game in afterwards', () => {
    const oldTab = newInstanceId();
    const current = newInstanceId();
    claimSlot(current);
    writeGame(game('current'));
    clearGame();
    expect(readMeta()).toBeNull();
    expect(ownsSlot(oldTab)).toBe(false);
  });
});
