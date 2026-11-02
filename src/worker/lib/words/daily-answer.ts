import type { GameRepository } from '../../db/queries/game-repository';

function selectRandomIndex(max: number): number {
  if (max < 1) throw new RangeError('Cannot select from an empty answer pool');
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const selected = values[0];
  if (selected === undefined) throw new Error('Random number generation failed');
  return selected % max;
}

export async function ensureDailyAnswer(repository: GameRepository, day: string): Promise<string> {
  const existing = await repository.getDailyAnswer(day);
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const unused = await repository.getUnusedAnswers();
    if (unused.length === 0) throw new Error('ANSWER_POOL_EXHAUSTED');
    const chosen = unused[selectRandomIndex(unused.length)];
    if (!chosen) continue;
    const assigned = await repository.assignDailyAnswer(day, chosen);
    if (assigned) return assigned;
  }

  const concurrentAssignment = await repository.getDailyAnswer(day);
  if (concurrentAssignment) return concurrentAssignment;
  throw new Error('DAILY_ANSWER_ASSIGNMENT_FAILED');
}
