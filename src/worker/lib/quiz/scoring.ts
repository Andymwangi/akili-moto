import {
  QUIZ_ANSWER_GRACE_MS,
  QUIZ_ANSWER_TIME_LIMIT_SECONDS,
  QUIZ_BONUS_MULTIPLIER,
  QUIZ_CORRECT_POINTS,
  QUIZ_SPEED_MULTIPLIER_MAX,
} from '../../../shared/constants';

const TIME_LIMIT_MS = QUIZ_ANSWER_TIME_LIMIT_SECONDS * 1000;

/** True when a chosen answer still counts: inside the timer plus the network grace. */
export function isWithinAnswerWindow(responseMs: number): boolean {
  return responseMs < TIME_LIMIT_MS + QUIZ_ANSWER_GRACE_MS;
}

/**
 * Correct answers score 200 when immediate, falling linearly to 100 at the deadline.
 * Answers inside the grace window score 100. The bonus question doubles the result.
 */
export function scoreQuizAnswer(isCorrect: boolean, responseMs: number, isBonus = false): number {
  if (!Number.isSafeInteger(responseMs) || responseMs < 0) {
    throw new RangeError('Response time must be a non-negative integer.');
  }
  if (!isCorrect || !isWithinAnswerWindow(responseMs)) return 0;
  const remaining = Math.max(0, TIME_LIMIT_MS - responseMs);
  const speedMultiplier = Math.min(QUIZ_SPEED_MULTIPLIER_MAX, 1 + remaining / TIME_LIMIT_MS);
  const points = Math.floor(QUIZ_CORRECT_POINTS * speedMultiplier);
  return isBonus ? points * QUIZ_BONUS_MULTIPLIER : points;
}
