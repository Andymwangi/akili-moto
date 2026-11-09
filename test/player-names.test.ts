import { describe, expect, it } from 'vitest';
import { UpdatePlayerNameSchema } from '../src/shared/schemas/quiz';
import { createRandomPlayerName } from '../src/worker/lib/identity/random-player-name';

describe('random player names', () => {
  it('produces an adjective, animal, and four digits that pass name validation', () => {
    for (let index = 0; index < 500; index += 1) {
      const name = createRandomPlayerName();
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/);
      expect(UpdatePlayerNameSchema.safeParse({ displayName: name }).success).toBe(true);
    }
  });

  it('varies between calls', () => {
    const names = new Set(Array.from({ length: 50 }, () => createRandomPlayerName()));
    expect(names.size).toBeGreaterThan(40);
  });
});
