import type { QuestionSetPair, QuizRepository } from '../../db/queries/quiz-repository';
import {
  QUIZ_QUESTION_SET_VERSION,
  questionById,
  selectDailyQuestionPair,
  validateDailyQuestionPair,
} from './question-bank';

export async function ensureDailyQuizPair(
  repository: QuizRepository,
  day: string,
): Promise<[string[], string[]]> {
  const existing = await repository.getDailyQuestionPair(day);
  if (existing?.roundTwoIds) return validateStoredPair(existing);

  const usedKeys = await repository.getUsedQuestionSetKeys();
  if (existing) {
    for (let variant = 0; variant < 4_096; variant += 1) {
      const [, roundTwoIds] = selectDailyQuestionPair(day, variant);
      const key = [...roundTwoIds].sort().join(',');
      if (usedKeys.has(key) || roundTwoIds.some((id) => existing.roundOneIds.includes(id)))
        continue;
      await repository.assignMissingRoundTwo(day, roundTwoIds, QUIZ_QUESTION_SET_VERSION);
      const assigned = await repository.getDailyQuestionPair(day);
      if (assigned?.roundTwoIds) return validateStoredPair(assigned);
    }
    throw new Error('DAILY_QUIZ_SET_EXHAUSTED');
  }

  for (let variant = 0; variant < 4_096; variant += 1) {
    const pair = selectDailyQuestionPair(day, variant);
    const firstKey = [...pair[0]].sort().join(',');
    const secondKey = [...pair[1]].sort().join(',');
    if (usedKeys.has(firstKey) || usedKeys.has(secondKey)) continue;
    const assigned = await repository.assignDailyQuestionPair(
      day,
      pair[0],
      pair[1],
      QUIZ_QUESTION_SET_VERSION,
    );
    if (assigned) return validateStoredPair(assigned);
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
  if (pair[0].length !== pair[1].length || ![10, 15].includes(pair[0].length) || new Set([...pair[0], ...pair[1]]).size !== pair[0].length * 2) {
    throw new Error('INVALID_DAILY_QUIZ');
  }
  if (assignment.roundOneVersion === QUIZ_QUESTION_SET_VERSION && pair[0].length === 15) {
    validateDailyQuestionPair(pair);
  }
  return pair;
}
