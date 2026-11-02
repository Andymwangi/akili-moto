import { QUIZ_QUESTION_COUNT } from '../../../shared/constants';
import type { QuizRepository } from '../../db/queries/quiz-repository';
import { QUIZ_QUESTION_SET_VERSION, questionById, selectDailyQuestionIds } from './question-bank';

export async function ensureDailyQuiz(repository: QuizRepository, day: string): Promise<string[]> {
  const existing = await repository.getDailyQuestionIds(day);
  if (existing) return validateQuestionIds(existing);
  const assigned = await repository.assignDailyQuiz(
    day,
    selectDailyQuestionIds(day),
    QUIZ_QUESTION_SET_VERSION,
  );
  if (!assigned) throw new Error('DAILY_QUIZ_UNAVAILABLE');
  return validateQuestionIds(assigned);
}

function validateQuestionIds(ids: string[]): string[] {
  if (ids.length !== QUIZ_QUESTION_COUNT || ids.some((id) => !questionById(id))) {
    throw new Error('INVALID_DAILY_QUIZ');
  }
  return ids;
}
