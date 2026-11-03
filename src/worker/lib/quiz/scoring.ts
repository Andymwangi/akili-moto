import {
  QUIZ_ANSWER_TIME_LIMIT_SECONDS,
  QUIZ_CORRECT_POINTS,
  QUIZ_SPEED_MULTIPLIER_MAX,
} from '../../../shared/constants';

export function scoreQuizAnswer(isCorrect: boolean, responseMs: number): number {
  if (!Number.isSafeInteger(responseMs) || responseMs < 0) {
    throw new RangeError('Response time must be a non-negative integer.');
  }
  if (!isCorrect || responseMs >= QUIZ_ANSWER_TIME_LIMIT_SECONDS * 1000) return 0;
  const remaining = QUIZ_ANSWER_TIME_LIMIT_SECONDS * 1000 - responseMs;
  const multiplier = 1 + remaining / (QUIZ_ANSWER_TIME_LIMIT_SECONDS * 1000);
  return Math.floor(QUIZ_CORRECT_POINTS * Math.min(QUIZ_SPEED_MULTIPLIER_MAX, multiplier));
}
