import { QUIZ_CORRECT_POINTS, QUIZ_SPEED_BONUS_MAX } from '../../../shared/constants';

export function scoreQuizAnswer(isCorrect: boolean, responseMs: number): number {
  if (!Number.isSafeInteger(responseMs) || responseMs < 0) {
    throw new RangeError('Response time must be a non-negative integer.');
  }
  if (!isCorrect) return 0;
  const speedBonus = Math.max(0, QUIZ_SPEED_BONUS_MAX - Math.floor(responseMs / 1000));
  return QUIZ_CORRECT_POINTS + speedBonus;
}
