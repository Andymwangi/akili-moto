import { QUIZ_LEGACY_QUESTION_COUNT, QUIZ_QUESTION_COUNT } from '../../../shared/constants';
import type { QuestionSetPair, QuizRepository } from '../../db/queries/quiz-repository';
import {
  QUIZ_QUESTION_SET_VERSION,
  questionById,
  selectDailyQuestionPair,
  validateDailyQuestionPair,
} from './question-bank';

// Variants only matter when a selected set was already used on another day. A
// selection error is structural (the bank cannot fill the schedule) and is not
// retried here, because selectDailyQuestionPair already retries internally.
const MAX_VARIANTS = 4_096;
// Questions used on the previous days are avoided when the bank allows it.
export const RECENT_QUESTION_DAYS = 3;

export async function ensureDailyQuizPair(
  repository: QuizRepository,
  day: string,
): Promise<[string[], string[]]> {
  const existing = await repository.getDailyQuestionPair(day);
  if (existing?.roundTwoIds) return validateStoredPair(existing);

  const [usedKeys, recentIds] = await Promise.all([
    repository.getUsedQuestionSetKeys(),
    repository.getRecentQuestionIds(day, RECENT_QUESTION_DAYS),
  ]);
  if (existing) {
    const avoid = new Set([...recentIds, ...existing.roundOneIds]);
    for (let variant = 0; variant < MAX_VARIANTS; variant += 1) {
      const pair = selectDailyQuestionPair(day, variant, avoid);
      const roundTwoIds = pair[1];
      const key = [...roundTwoIds].sort().join(',');
      if (usedKeys.has(key) || roundTwoIds.some((id) => existing.roundOneIds.includes(id)))
        continue;
      await repository.assignMissingRoundTwo(day, roundTwoIds, QUIZ_QUESTION_SET_VERSION);
      const assigned = await repository.getDailyQuestionPair(day);
      if (assigned?.roundTwoIds) return validateStoredPair(assigned);
    }
    throw new Error('DAILY_QUIZ_SET_EXHAUSTED');
  }

  for (let variant = 0; variant < MAX_VARIANTS; variant += 1) {
    const pair = selectDailyQuestionPair(day, variant, recentIds);
    const firstKey = [...pair[0]].sort().join(',');
    const secondKey = [...pair[1]].sort().join(',');
    if (usedKeys.has(firstKey) || usedKeys.has(secondKey)) continue;
    const assigned = await repository.assignDailyQuestionPair(
      day,
      pair[0],
      pair[1],
      QUIZ_QUESTION_SET_VERSION,
    );
    if (assigned?.roundTwoIds) return validateStoredPair(assigned);
    const racedAssignment = await repository.getDailyQuestionPair(day);
    if (racedAssignment?.roundTwoIds) return validateStoredPair(racedAssignment);
  }
  throw new Error('DAILY_QUIZ_SET_EXHAUSTED');
}

export async function ensureDailyQuiz(repository: QuizRepository, day: string): Promise<string[]> {
  return (await ensureDailyQuizPair(repository, day))[0];
}

function validateStoredPair(assignment: QuestionSetPair): [string[], string[]] {
  if (!assignment.roundTwoIds) throw new Error('INVALID_DAILY_QUIZ');
  const pair: [string[], string[]] = [assignment.roundOneIds, assignment.roundTwoIds];
  if (pair.some((ids) => ids.some((id) => !questionById(id)))) {
    throw new Error('INVALID_DAILY_QUIZ');
  }
  // Rounds are scored independently, so a legacy 10-question round one may be
  // followed by a 15-question round two. The rounds must never share questions.
  if (
    pair.some((ids) => ![QUIZ_LEGACY_QUESTION_COUNT, QUIZ_QUESTION_COUNT].includes(ids.length)) ||
    new Set([...pair[0], ...pair[1]]).size !== pair[0].length + pair[1].length
  ) {
    throw new Error('INVALID_DAILY_QUIZ');
  }
  if (
    assignment.roundOneVersion === QUIZ_QUESTION_SET_VERSION &&
    pair.every((ids) => ids.length === QUIZ_QUESTION_COUNT)
  ) {
    validateDailyQuestionPair(pair);
  }
  return pair;
}
