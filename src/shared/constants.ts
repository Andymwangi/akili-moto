export const QUIZ_QUESTION_COUNT = 15;
export const QUIZ_LEGACY_QUESTION_COUNT = 10;
export const QUIZ_ENGLISH_QUESTION_COUNT = 11;
export const QUIZ_SWAHILI_QUESTION_COUNT = 4;
export const QUIZ_CORRECT_POINTS = 100;
export const QUIZ_SPEED_MULTIPLIER_MAX = 2;
export const QUIZ_BONUS_MULTIPLIER = 2;
export const QUIZ_ANSWER_TIME_LIMIT_SECONDS = 30;
// Answers chosen just before the deadline can arrive slightly late on slow mobile
// networks. They still count, at the minimum speed multiplier.
export const QUIZ_ANSWER_GRACE_MS = 1_500;
export const QUIZ_MAX_ANSWER_POINTS =
  QUIZ_CORRECT_POINTS * QUIZ_SPEED_MULTIPLIER_MAX * QUIZ_BONUS_MULTIPLIER;
export const QUIZ_MAX_ROUND_SCORE =
  QUIZ_CORRECT_POINTS * QUIZ_SPEED_MULTIPLIER_MAX * (QUIZ_QUESTION_COUNT - 1) +
  QUIZ_MAX_ANSWER_POINTS;
export const WORD_LENGTH = 5;
export const MAX_ATTEMPTS = 6;
export const PLAYER_COOKIE_NAME = 'neno_player';
export const PLAYER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
