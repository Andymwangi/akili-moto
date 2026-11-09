import {
  QUIZ_ANSWER_TIME_LIMIT_SECONDS,
  QUIZ_LEGACY_QUESTION_COUNT,
  QUIZ_QUESTION_COUNT,
} from '../../../shared/constants';
import {
  ChoiceIdSchema,
  type QuizAnswer,
  type QuizQuestion,
  type QuizState,
} from '../../../shared/schemas/quiz';
import type { QuizRoundNumber, StoredQuizAnswer } from '../../db/queries/quiz-repository';
import {
  bonusQuestionIndex,
  correctOptionId,
  questionById,
  toPublicQuestion,
} from './question-bank';

type QuizSession = Readonly<{ startedAt: string; currentQuestionOpenedAt: string | null }>;

const TIME_LIMIT_MS = QUIZ_ANSWER_TIME_LIMIT_SECONDS * 1000;

export function buildQuizState(input: {
  day: string;
  round: QuizRoundNumber;
  questionIds: string[];
  session: QuizSession;
  answers: StoredQuizAnswer[];
  now: Date;
  /**
   * Only GET reveals the current question, because it also starts its timer.
   * Answer responses leave it out so the next question cannot be read early.
   */
  revealCurrentQuestion: boolean;
  rank?: { rank: number; completedPlayers: number };
}): QuizState {
  const answers = input.answers.map((answer) => toPublicAnswer(input.day, answer));
  const currentIndex = answers.length;
  const currentId = input.questionIds[currentIndex];
  const currentEntry =
    input.revealCurrentQuestion && currentId ? questionById(currentId) : undefined;
  const currentQuestion: QuizQuestion | undefined = currentEntry
    ? toPublicQuestion(currentEntry, input.day)
    : undefined;
  const openedAt = currentQuestion ? input.session.currentQuestionOpenedAt : null;
  const bonusIndex = bonusQuestionIndex(input.day, input.round, input.questionIds);

  return {
    day: input.day,
    round: input.round,
    status: currentIndex === input.questionIds.length ? 'finished' : 'in_progress',
    currentIndex,
    totalQuestions:
      input.questionIds.length === QUIZ_LEGACY_QUESTION_COUNT
        ? QUIZ_LEGACY_QUESTION_COUNT
        : QUIZ_QUESTION_COUNT,
    score: input.answers.reduce((sum, answer) => sum + answer.points, 0),
    correctCount: input.answers.reduce((sum, answer) => sum + Number(answer.isCorrect), 0),
    startedAt: input.session.startedAt,
    ...(currentQuestion ? { currentQuestion } : {}),
    ...(openedAt
      ? {
          currentQuestionOpenedAt: openedAt,
          currentQuestionTimeRemainingMs: Math.max(
            0,
            Math.min(
              TIME_LIMIT_MS,
              TIME_LIMIT_MS - (input.now.getTime() - new Date(openedAt).getTime()),
            ),
          ),
        }
      : {}),
    ...(bonusIndex !== undefined ? { bonusQuestionIndex: bonusIndex } : {}),
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
    selectedOptionId:
      answer.selectedOptionId === null ? null : ChoiceIdSchema.parse(answer.selectedOptionId),
    correctOptionId: correctId,
    isCorrect: answer.isCorrect,
    points: answer.points,
    explanation: entry.explanation,
    sourceUrl: entry.sourceUrl,
  };
}
