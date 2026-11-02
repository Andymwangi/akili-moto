import type { Attempt } from '../../../shared/schemas/game';

export type LetterFeedback = Attempt['feedback'][number];

export function scoreGuess(guess: string, answer: string): LetterFeedback[] {
  if (guess.length !== answer.length) throw new RangeError('Guess and answer lengths must match');

  const result: LetterFeedback[] = Array.from({ length: answer.length }, () => 'absent');
  const remaining = new Map<string, number>();

  for (let index = 0; index < answer.length; index += 1) {
    const guessLetter = guess[index];
    const answerLetter = answer[index];
    if (guessLetter === undefined || answerLetter === undefined) {
      throw new RangeError('Guess and answer must contain complete words');
    }
    if (guessLetter === answerLetter) {
      result[index] = 'correct';
    } else {
      remaining.set(answerLetter, (remaining.get(answerLetter) ?? 0) + 1);
    }
  }

  for (let index = 0; index < answer.length; index += 1) {
    if (result[index] === 'correct') continue;
    const letter = guess[index];
    if (letter === undefined) throw new RangeError('Guess must contain complete words');
    const count = remaining.get(letter) ?? 0;
    if (count > 0) {
      result[index] = 'present';
      remaining.set(letter, count - 1);
    }
  }

  return result;
}
