import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, sanitize, updateSettings } from '../src/game/settings';

describe('settings', () => {
  it('fills in defaults and clamps damaged or out-of-range values', () => {
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize('junk')).toEqual(DEFAULT_SETTINGS);
    const s = sanitize({ master: 7, sfx: -1, music: 'loud', quality: 'ultra', panSpeed: 0, edgePan: 'yes', invertLook: true });
    expect(s.master).toBe(1);
    expect(s.sfx).toBe(0);
    expect(s.music).toBe(DEFAULT_SETTINGS.music);
    expect(s.quality).toBe('auto');
    expect(s.panSpeed).toBe(0.4);
    expect(s.edgePan).toBe(DEFAULT_SETTINGS.edgePan);
    expect(s.invertLook).toBe(true);
  });

  it('keeps the lighting-effects switch (on by default, older saves get the default)', () => {
    expect(DEFAULT_SETTINGS.effects).toBe(true);
    expect(sanitize({ effects: false }).effects).toBe(false);
    expect(sanitize({ effects: 'off' }).effects).toBe(true);
    expect(sanitize({ master: 0.5 }).effects).toBe(true);
  });

  it('updates apply at once (even with no storage available)', () => {
    const before = getSettings().music;
    const after = updateSettings({ music: before === 0.2 ? 0.3 : 0.2 }).music;
    expect(getSettings().music).toBe(after);
    expect(after).not.toBe(before);
    updateSettings({ ...DEFAULT_SETTINGS });
  });
});
