import { describe, expect, it } from 'vitest';
import type { StoredGuess } from '../src/worker/db/queries/game-repository';
import { addDays, getNairobiDay } from '../src/worker/lib/game/day';
import { scoreGuess } from '../src/worker/lib/game/feedback';
import { buildGameState } from '../src/worker/lib/game/state';

describe('feedback scoring', () => {
  it('marks exact letters before distributing repeated letters', () => {
    expect(scoreGuess('eagle', 'allee')).toEqual([
      'present',
      'present',
      'absent',
      'present',
      'correct',
    ]);
  });

  it('does not award more copies than the answer contains', () => {
    expect(scoreGuess('aabbb', 'abccc')).toEqual([
      'correct',
      'absent',
      'present',
      'absent',
      'absent',
    ]);
  });

  it('rejects words with different lengths', () => {
    expect(() => scoreGuess('abcd', 'abcde')).toThrow(RangeError);
  });
});

describe('Nairobi game day', () => {
  it('uses midnight Nairobi time, which is 21:00 UTC', () => {
    expect(getNairobiDay(new Date('2026-11-02T20:59:59.000Z'))).toBe('2026-11-02');
    expect(getNairobiDay(new Date('2026-11-02T21:00:00.000Z'))).toBe('2026-11-03');
  });

  it('adds calendar days without local timezone dependence', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('game response answer boundary', () => {
  it('hides the answer until the player wins or uses all attempts', () => {
    const empty: StoredGuess[] = [];
    expect(buildGameState('2026-11-02', 'abcde', empty)).not.toHaveProperty('answer');

    const won: StoredGuess[] = [
      {
        attemptNumber: 1,
        guess: 'abcde',
        feedback: ['correct', 'correct', 'correct', 'correct', 'correct'],
        idempotencyKey: 'request-0001',
      },
    ];
    expect(buildGameState('2026-11-02', 'abcde', won)).toMatchObject({
      status: 'won',
      answer: 'abcde',
    });
  });
});
