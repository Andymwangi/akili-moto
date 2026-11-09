import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { QUIZ_ANSWER_TIME_LIMIT_SECONDS } from '../../shared/constants';
import {
  ApiErrorSchema,
  IdempotencyHeaderSchema,
  QuizAnswerBodySchema,
  QuizLeaderboardSchema,
  QuizRoundQuerySchema,
  QuizStateSchema,
} from '../../shared/schemas/quiz';
import {
  QuizRepository,
  type QuizRoundNumber,
  type StoredQuizAnswer,
} from '../db/queries/quiz-repository';
import type { AppEnvironment } from '../env';
import { getNairobiDay } from '../lib/game/day';
import { ensureDailyQuizPair } from '../lib/quiz/daily-quiz';
import { bonusQuestionIndex, correctOptionId, questionById } from '../lib/quiz/question-bank';
import { isWithinAnswerWindow, scoreQuizAnswer } from '../lib/quiz/scoring';
import { buildQuizState } from '../lib/quiz/state';

type ChoiceId = 'a' | 'b' | 'c' | 'd';

const TIME_LIMIT_MS = QUIZ_ANSWER_TIME_LIMIT_SECONDS * 1000;

function safeError(requestId: string, code: string, message: string, status: 400 | 409 | 503) {
  return Response.json(ApiErrorSchema.parse({ error: { code, message, requestId } }), { status });
}

function isRoundUnlocked(
  repository: QuizRepository,
  day: string,
  playerId: string,
  round: QuizRoundNumber,
): Promise<boolean> {
  if (round === 1) return Promise.resolve(true);
  return repository
    .getRoundSession(day, playerId, 1)
    .then((session) => Boolean(session?.completedAt));
}

/** A stored answer satisfies a retry when it is the same question and choice. */
function matchesStoredAnswer(
  stored: StoredQuizAnswer,
  questionId: string,
  selectedOptionId: ChoiceId | undefined,
): boolean {
  if (stored.questionId !== questionId) return false;
  if (stored.selectedOptionId === (selectedOptionId ?? null)) return true;
  // A choice that arrived after the answer window is stored as a timeout.
  return stored.selectedOptionId === null && stored.responseMs >= TIME_LIMIT_MS;
}

async function roundState(input: {
  repository: QuizRepository;
  day: string;
  playerId: string;
  round: QuizRoundNumber;
  questionIds: string[];
  now: Date;
  revealCurrentQuestion: boolean;
}) {
  const { repository, day, playerId, round, questionIds } = input;
  let session = await repository.getOrCreateRoundSession(day, playerId, round);
  await repository.reconcileRoundTotals(day, playerId, round, questionIds.length);
  const answers = await repository.getRoundAnswers(day, playerId, round);
  if (input.revealCurrentQuestion && answers.length < questionIds.length) {
    session = await repository.openCurrentQuestion(day, playerId, round, answers.length);
  }
  const rank =
    answers.length === questionIds.length
      ? await repository.getCompletedRoundRank(day, playerId, round)
      : undefined;
  return QuizStateSchema.parse(
    buildQuizState({
      day,
      round,
      questionIds,
      session,
      answers,
      now: input.now,
      revealCurrentQuestion: input.revealCurrentQuestion,
      ...(rank ? { rank } : {}),
    }),
  );
}

const routes = new Hono<AppEnvironment>()
  .get(
    '/quiz',
    zValidator('query', QuizRoundQuerySchema, (result, context) => {
      if (!result.success) {
        return safeError(
          context.res.headers.get('X-Request-Id') ?? 'unavailable',
          'validation_failed',
          'The requested round is invalid.',
          400,
        );
      }
    }),
    async (context) => {
      try {
        const now = new Date();
        const day = getNairobiDay(now);
        const { round } = context.req.valid('query');
        const playerId = context.get('playerId');
        const repository = new QuizRepository(context.env.DB);
        if (!(await isRoundUnlocked(repository, day, playerId, round))) {
          return safeError(
            context.res.headers.get('X-Request-Id') ?? 'unavailable',
            'round_locked',
            'Complete round one before starting round two.',
            409,
          );
        }
        const [roundOneIds, roundTwoIds] = await ensureDailyQuizPair(repository, day);
        const state = await roundState({
          repository,
          day,
          playerId,
          round,
          questionIds: round === 1 ? roundOneIds : roundTwoIds,
          now,
          revealCurrentQuestion: true,
        });
        return context.json(state);
      } catch {
        return safeError(
          context.res.headers.get('X-Request-Id') ?? 'unavailable',
          'quiz_unavailable',
          'The daily challenge is temporarily unavailable.',
          503,
        );
      }
    },
  )
  .post(
    '/quiz/answer',
    zValidator('header', IdempotencyHeaderSchema, (result, context) => {
      if (!result.success) {
        return safeError(
          context.res.headers.get('X-Request-Id') ?? 'unavailable',
          'validation_failed',
          'The request headers are invalid.',
          400,
        );
      }
    }),
    zValidator('json', QuizAnswerBodySchema, (result, context) => {
      if (!result.success) {
        return safeError(
          context.res.headers.get('X-Request-Id') ?? 'unavailable',
          'validation_failed',
          'The answer payload is invalid.',
          400,
        );
      }
    }),
    async (context) => {
      const now = new Date();
      const submittedAt = now.toISOString();
      const day = getNairobiDay(now);
      const playerId = context.get('playerId');
      const { round, questionId, selectedOptionId } = context.req.valid('json');
      const idempotencyKey = context.req.valid('header')['idempotency-key'];
      const repository = new QuizRepository(context.env.DB);
      const requestId = context.res.headers.get('X-Request-Id') ?? 'unavailable';

      try {
        if (!(await isRoundUnlocked(repository, day, playerId, round))) {
          return safeError(
            requestId,
            'round_locked',
            'Complete round one before starting round two.',
            409,
          );
        }
        const [roundOneIds, roundTwoIds] = await ensureDailyQuizPair(repository, day);
        const questionIds = round === 1 ? roundOneIds : roundTwoIds;
        const respond = async () =>
          context.json(
            await roundState({
              repository,
              day,
              playerId,
              round,
              questionIds,
              now,
              revealCurrentQuestion: false,
            }),
          );

        const previous = await repository.getIdempotentRoundAnswer(
          day,
          playerId,
          round,
          idempotencyKey,
        );
        if (previous) {
          if (!matchesStoredAnswer(previous, questionId, selectedOptionId)) {
            return safeError(
              requestId,
              'idempotency_conflict',
              'That request key was already used.',
              409,
            );
          }
          return respond();
        }

        await repository.getOrCreateRoundSession(day, playerId, round);
        await repository.reconcileRoundTotals(day, playerId, round, questionIds.length);
        const answers = await repository.getRoundAnswers(day, playerId, round);
        const questionIndex = answers.length;
        if (questionIndex >= questionIds.length) {
          return safeError(requestId, 'quiz_finished', 'You have completed this round.', 409);
        }
        if (questionId !== questionIds[questionIndex]) {
          return safeError(
            requestId,
            'question_out_of_order',
            'Refresh the challenge to continue with the current question.',
            409,
          );
        }
        const question = questionById(questionId);
        if (!question) throw new Error('QUESTION_NOT_FOUND');

        // The timer starts only when GET /quiz reveals the question.
        const session = await repository.getRoundSession(day, playerId, round);
        const openedAt = session?.currentQuestionOpenedAt;
        if (!openedAt || session.currentQuestionIndex !== questionIndex) {
          return safeError(
            requestId,
            'question_not_opened',
            'Refresh the challenge to load the current question.',
            409,
          );
        }
        const elapsedMs = Math.min(
          86_400_000,
          Math.max(0, now.getTime() - new Date(openedAt).getTime()),
        );
        if (!selectedOptionId && elapsedMs < TIME_LIMIT_MS) {
          return safeError(requestId, 'answer_too_early', 'The answer timer has not expired.', 409);
        }
        const recordedOptionId =
          selectedOptionId && isWithinAnswerWindow(elapsedMs) ? selectedOptionId : null;
        const correctId = correctOptionId(question, day);
        const isCorrect = recordedOptionId === correctId;
        const isBonus = bonusQuestionIndex(day, round, questionIds) === questionIndex;
        const inserted = await repository.saveRoundAnswer({
          day,
          playerId,
          round,
          questionIndex,
          questionId,
          selectedOptionId: recordedOptionId,
          correctOptionId: correctId,
          isCorrect,
          points: scoreQuizAnswer(isCorrect, elapsedMs, isBonus),
          responseMs: elapsedMs,
          idempotencyKey,
          submittedAt,
          questionCount: questionIds.length,
        });
        if (!inserted) {
          const current = await repository.getRoundAnswers(day, playerId, round);
          const stored = current.find((answer) => answer.questionIndex === questionIndex);
          if (!stored || !matchesStoredAnswer(stored, questionId, selectedOptionId)) {
            return safeError(
              requestId,
              'answer_conflict',
              'An answer was already recorded for this question.',
              409,
            );
          }
        }
        return respond();
      } catch {
        return safeError(
          requestId,
          'answer_unavailable',
          'Your answer could not be saved. Refresh and try again.',
          503,
        );
      }
    },
  )
  .get('/quiz/leaderboard', async (context) => {
    try {
      const day = getNairobiDay(new Date());
      const playerId = context.get('playerId');
      const repository = new QuizRepository(context.env.DB);
      const boards = await Promise.all(
        ([1, 2] as const).map(async (round) => {
          const [rows, totalPlayers, playerRank, playerSession] = await Promise.all([
            repository.getRoundLeaderboard(day, round),
            repository.countCompletedPlayers(day, round),
            repository.getCompletedRoundRank(day, playerId, round),
            repository.getRoundSession(day, playerId, round),
          ]);
          return {
            round,
            totalPlayers,
            playerRank: playerRank?.rank ?? null,
            playerScore: playerSession?.completedAt ? playerSession.score : null,
            items: rows.map((row, index) => ({
              position: index + 1,
              rank: rows.findIndex((candidate) => candidate.score === row.score) + 1,
              score: row.score,
              correctCount: row.correctCount,
              displayName: row.displayName ?? 'Player',
            })),
          };
        }),
      );
      const [combinedRows, combinedPlayer, combinedRank] = await Promise.all([
        repository.getCombinedLeaderboard(day),
        repository.getCombinedPlayerScore(day, playerId),
        repository.getCombinedPlayerRank(day, playerId),
      ]);
      return context.json(
        QuizLeaderboardSchema.parse({
          day,
          rounds: boards,
          combined: {
            totalPlayers: combinedRank?.completedPlayers ?? 0,
            playerRank: combinedRank?.rank ?? null,
            playerScore: combinedPlayer?.score ?? null,
            items: combinedRows.map((row, index) => ({
              position: index + 1,
              rank: combinedRows.findIndex((candidate) => candidate.score === row.score) + 1,
              score: row.score,
              correctCount: row.correctCount,
              displayName: row.displayName ?? 'Player',
            })),
          },
        }),
      );
    } catch {
      return safeError(
        context.res.headers.get('X-Request-Id') ?? 'unavailable',
        'leaderboard_unavailable',
        'Today’s leaderboards are temporarily unavailable.',
        503,
      );
    }
  });

export { routes as quizRoutes };
