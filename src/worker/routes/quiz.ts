import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { QUIZ_QUESTION_COUNT, QUIZ_SPEED_BONUS_WINDOW_SECONDS } from '../../shared/constants';
import {
  ApiErrorSchema,
  IdempotencyHeaderSchema,
  QuizAnswerBodySchema,
  QuizLeaderboardSchema,
  QuizRoundQuerySchema,
  QuizStateSchema,
} from '../../shared/schemas/quiz';
import { QuizRepository, type QuizRoundNumber } from '../db/queries/quiz-repository';
import type { AppEnvironment } from '../env';
import { getNairobiDay } from '../lib/game/day';
import { ensureDailyQuizPair } from '../lib/quiz/daily-quiz';
import { correctOptionId, questionById } from '../lib/quiz/question-bank';
import { scoreQuizAnswer } from '../lib/quiz/scoring';
import { buildQuizState } from '../lib/quiz/state';

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
        const questionIds = round === 1 ? roundOneIds : roundTwoIds;
        const session = await repository.getOrCreateRoundSession(day, playerId, round);
        await repository.reconcileRoundTotals(day, playerId, round);
        const answers = await repository.getRoundAnswers(day, playerId, round);
        const rank =
          answers.length === QUIZ_QUESTION_COUNT
            ? await repository.getCompletedRoundRank(day, playerId, round)
            : undefined;
        return context.json(
          QuizStateSchema.parse(
            buildQuizState({
              day,
              round,
              questionIds,
              session,
              answers,
              ...(rank ? { rank } : {}),
            }),
          ),
        );
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

      try {
        if (!(await isRoundUnlocked(repository, day, playerId, round))) {
          return safeError(
            context.res.headers.get('X-Request-Id') ?? 'unavailable',
            'round_locked',
            'Complete round one before starting round two.',
            409,
          );
        }
        const previous = await repository.getIdempotentRoundAnswer(
          day,
          playerId,
          round,
          idempotencyKey,
        );
        if (previous) {
          if (
            previous.questionId !== questionId ||
            previous.selectedOptionId !== selectedOptionId
          ) {
            return safeError(
              context.res.headers.get('X-Request-Id') ?? 'unavailable',
              'idempotency_conflict',
              'That request key was already used.',
              409,
            );
          }
          const [roundOneIds, roundTwoIds] = await ensureDailyQuizPair(repository, day);
          const questionIds = round === 1 ? roundOneIds : roundTwoIds;
          const session = await repository.getOrCreateRoundSession(day, playerId, round);
          await repository.reconcileRoundTotals(day, playerId, round);
          const answers = await repository.getRoundAnswers(day, playerId, round);
          const rank =
            answers.length === QUIZ_QUESTION_COUNT
              ? await repository.getCompletedRoundRank(day, playerId, round)
              : undefined;
          return context.json(
            QuizStateSchema.parse(
              buildQuizState({
                day,
                round,
                questionIds,
                session,
                answers,
                ...(rank ? { rank } : {}),
              }),
            ),
          );
        }

        const [roundOneIds, roundTwoIds] = await ensureDailyQuizPair(repository, day);
        const questionIds = round === 1 ? roundOneIds : roundTwoIds;
        const session = await repository.getOrCreateRoundSession(day, playerId, round);
        await repository.reconcileRoundTotals(day, playerId, round);
        const answers = await repository.getRoundAnswers(day, playerId, round);
        if (answers.length >= QUIZ_QUESTION_COUNT) {
          return safeError(
            context.res.headers.get('X-Request-Id') ?? 'unavailable',
            'quiz_finished',
            'You have completed this round.',
            409,
          );
        }

        const currentQuestionId = questionIds[answers.length];
        if (questionId !== currentQuestionId) {
          return safeError(
            context.res.headers.get('X-Request-Id') ?? 'unavailable',
            'question_out_of_order',
            'Refresh the challenge to continue with the current question.',
            409,
          );
        }
        const question = questionById(questionId);
        if (!question) throw new Error('QUESTION_NOT_FOUND');

        const openedAt = answers.at(-1)?.submittedAt ?? session.startedAt;
        const elapsedMs = Math.min(
          86_400_000,
          Math.max(0, now.getTime() - new Date(openedAt).getTime()),
        );
        const correctId = correctOptionId(question, day);
        const isCorrect = selectedOptionId === correctId;
        const points = scoreQuizAnswer(
          isCorrect,
          Math.min(elapsedMs, QUIZ_SPEED_BONUS_WINDOW_SECONDS * 1000),
        );
        const inserted = await repository.saveRoundAnswer({
          day,
          playerId,
          round,
          questionIndex: answers.length,
          questionId,
          selectedOptionId,
          correctOptionId: correctId,
          isCorrect,
          points,
          responseMs: elapsedMs,
          idempotencyKey,
          submittedAt,
        });
        if (!inserted) {
          const current = await repository.getRoundAnswers(day, playerId, round);
          const conflicting = current.find((answer) => answer.questionIndex === answers.length);
          if (conflicting?.selectedOptionId !== selectedOptionId) {
            return safeError(
              context.res.headers.get('X-Request-Id') ?? 'unavailable',
              'answer_conflict',
              'An answer was already recorded for this question.',
              409,
            );
          }
        }

        const updatedAnswers = await repository.getRoundAnswers(day, playerId, round);
        const rank =
          updatedAnswers.length === QUIZ_QUESTION_COUNT
            ? await repository.getCompletedRoundRank(day, playerId, round)
            : undefined;
        return context.json(
          QuizStateSchema.parse(
            buildQuizState({
              day,
              round,
              questionIds,
              session,
              answers: updatedAnswers,
              ...(rank ? { rank } : {}),
            }),
          ),
        );
      } catch {
        return safeError(
          context.res.headers.get('X-Request-Id') ?? 'unavailable',
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
