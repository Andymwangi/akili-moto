import { QUIZ_QUESTION_COUNT } from '../../../shared/constants';
import {
  ChoiceIdSchema,
  type QuizAnswer,
  type QuizQuestion,
  type QuizState,
} from '../../../shared/schemas/quiz';
import type { StoredQuizAnswer } from '../../db/queries/quiz-repository';
import { correctOptionId, questionById, toPublicQuestion } from './question-bank';

type QuizSession = Readonly<{ startedAt: string }>;

export function buildQuizState(input: {
  day: string;
  questionIds: string[];
  session: QuizSession;
  answers: StoredQuizAnswer[];
  rank?: { rank: number; completedPlayers: number };
}): QuizState {
  const answers = input.answers.map((answer) => toPublicAnswer(input.day, answer));
  const currentIndex = answers.length;
  const currentId = input.questionIds[currentIndex];
  const currentEntry = currentId ? questionById(currentId) : undefined;
  const currentQuestion: QuizQuestion | undefined = currentEntry
    ? toPublicQuestion(currentEntry, input.day)
    : undefined;
  const lastAnswer = input.answers.at(-1);

  return {
    day: input.day,
    status: currentIndex === QUIZ_QUESTION_COUNT ? 'finished' : 'in_progress',
    currentIndex,
    totalQuestions: QUIZ_QUESTION_COUNT,
    score: input.answers.reduce((sum, answer) => sum + answer.points, 0),
    correctCount: input.answers.reduce((sum, answer) => sum + Number(answer.isCorrect), 0),
    startedAt: input.session.startedAt,
    ...(currentQuestion ? { currentQuestion } : {}),
    ...(currentQuestion
      ? { currentQuestionOpenedAt: lastAnswer?.submittedAt ?? input.session.startedAt }
      : {}),
    answers,
    ...(input.rank ? input.rank : {}),
  };
}

function toPublicAnswer(day: string, answer: StoredQuizAnswer): QuizAnswer {
  const entry = questionById(answer.questionId);
  if (!entry) throw new Error('INVALID_QUIZ_ANSWER');
  const correctId = correctOptionId(entry, day);
  if (correctId !== answer.correctOptionId) throw new Error('INVALID_QUIZ_ANSWER');
  return {
    questionIndex: answer.questionIndex,
    question: toPublicQuestion(entry, day),
    selectedOptionId: ChoiceIdSchema.parse(answer.selectedOptionId),
    correctOptionId: correctId,
    isCorrect: answer.isCorrect,
    points: answer.points,
    explanation: entry.explanation,
    sourceUrl: entry.sourceUrl,
  };
}
