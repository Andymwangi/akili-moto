import { QUIZ_QUESTION_COUNT } from '../../../shared/constants';
import type { QuizRepository } from '../../db/queries/quiz-repository';
import { QUIZ_QUESTION_SET_VERSION, questionById, selectDailyQuestionIds } from './question-bank';

export async function ensureDailyQuiz(repository: QuizRepository, day: string): Promise<string[]> {
  const existing = await repository.getDailyQuestionIds(day);
  if (existing) return validateQuestionIds(existing);
  const usedQuestionSetKeys = await repository.getUsedQuestionSetKeys();
  for (let variant = 0; variant < 4_096; variant += 1) {
    const questionIds = selectDailyQuestionIds(day, variant);
    const questionSetKey = [...questionIds].sort().join(',');
    if (usedQuestionSetKeys.has(questionSetKey)) continue;
    const assigned = await repository.assignDailyQuiz(day, questionIds, QUIZ_QUESTION_SET_VERSION);
    if (assigned) return validateQuestionIds(assigned);
    const racedAssignment = await repository.getDailyQuestionIds(day);
    if (racedAssignment) return validateQuestionIds(racedAssignment);
  }
  throw new Error('DAILY_QUIZ_SET_EXHAUSTED');
}

function validateQuestionIds(ids: string[]): string[] {
  if (ids.length !== QUIZ_QUESTION_COUNT || ids.some((id) => !questionById(id))) {
    throw new Error('INVALID_DAILY_QUIZ');
  }
  return ids;
}
