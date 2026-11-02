import { MAX_ATTEMPTS } from '../../../shared/constants';
import type { Attempt, GameState } from '../../../shared/schemas/game';
import type { StoredGuess } from '../../db/queries/game-repository';
import { scoreGuess } from './feedback';

export function toAttempt(guess: string, answer: string): Attempt {
  return { guess, feedback: scoreGuess(guess, answer) };
}

export function buildGameState(day: string, answer: string, guesses: StoredGuess[]): GameState {
  const attempts = guesses.map(({ guess, feedback }) => ({ guess, feedback }));
  const won = attempts.some((attempt) => attempt.guess === answer);
  const lost = attempts.length >= MAX_ATTEMPTS && !won;
  const status = won ? 'won' : lost ? 'lost' : 'in_progress';

  return {
    day,
    attempts,
    maxAttempts: MAX_ATTEMPTS,
    status,
    ...(status === 'in_progress' ? {} : { answer }),
  };
}
