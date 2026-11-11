import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, TRAIL, sameMatch, setupFromParams, setupQuery, trailSetup, type MatchSetup } from '../src/game/setup';
import { PERSONALITIES } from '../src/sim/ai';
import { MAPS } from '../src/sim/maps';

const parse = (q: string): MatchSetup | null => setupFromParams(new URLSearchParams(q));

describe('match setup in the URL', () => {
  it('round-trips a skirmish and drops defaults', () => {
    const s: MatchSetup = { mode: 'skirmish', difficulty: 'hard', seed: 99, opponent: 'warden', map: 'pass', trail: null };
    expect(parse(setupQuery(s))).toEqual(s);
    const plain: MatchSetup = { mode: 'skirmish', difficulty: 'normal', seed: DEFAULT_SEED, opponent: 'sarge', map: 'basin', trail: null };
    expect(setupQuery(plain)).toBe('mode=skirmish&difficulty=normal');
    expect(parse('mode=skirmish')).toEqual(plain);
  });

  it('ignores unknown opponents, maps and modes', () => {
    expect(parse('mode=skirmish&ai=nobody&map=moon')).toMatchObject({ opponent: 'sarge', map: 'basin' });
    expect(parse('mode=chess')).toBeNull();
    expect(parse('')).toBeNull();
  });

  it('a trail stage fixes opponent, map and difficulty', () => {
    const s = parse('mode=skirmish&trail=3&ai=jackal&difficulty=easy');
    expect(s).toEqual(trailSetup(3));
    expect(parse(setupQuery(trailSetup(3)))).toEqual(trailSetup(3));
    expect(parse('mode=skirmish&trail=42')?.trail).toBeNull();
  });

  it('every trail stage names a real opponent and map; difficulty never drops', () => {
    const rank = { easy: 0, normal: 1, hard: 2 };
    let last = 0;
    for (const s of TRAIL) {
      expect(PERSONALITIES[s.opponent]).toBeDefined();
      expect(MAPS[s.map]).toBeDefined();
      expect(rank[s.difficulty]).toBeGreaterThanOrEqual(last);
      last = rank[s.difficulty];
    }
  });

  it('a save only resumes into the same match', () => {
    const a = trailSetup(1);
    expect(sameMatch(a, { ...a })).toBe(true);
    expect(sameMatch(a, { ...a, trail: null })).toBe(false);
    expect(sameMatch(a, { ...a, map: 'pass' })).toBe(false);
    const hold: MatchSetup = { mode: 'hold', difficulty: 'normal', seed: DEFAULT_SEED, opponent: 'sarge', map: 'basin', trail: null };
    expect(sameMatch(hold, { ...hold, difficulty: 'hard' })).toBe(true);
  });
});
