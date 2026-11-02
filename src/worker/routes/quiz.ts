import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { QUIZ_QUESTION_COUNT, QUIZ_SPEED_BONUS_WINDOW_SECONDS } from '../../shared/constants';
import {
  ApiErrorSchema,
  IdempotencyHeaderSchema,
  QuizAnswerBodySchema,
  QuizLeaderboardSchema,
  QuizStateSchema,
} from '../../shared/schemas/quiz';
import { QuizRepository } from '../db/queries/quiz-repository';
import type { AppEnvironment } from '../env';
import { getNairobiDay } from '../lib/game/day';
import { ensureDailyQuiz } from '../lib/quiz/daily-quiz';
import { correctOptionId, questionById } from '../lib/quiz/question-bank';
import { scoreQuizAnswer } from '../lib/quiz/scoring';
import { buildQuizState } from '../lib/quiz/state';

function safeError(requestId: string, code: string, message: string, status: 400 | 409 | 503) {
  return Response.json(ApiErrorSchema.parse({ error: { code, message, requestId } }), { status });
}

const routes = new Hono<AppEnvironment>()
  .get('/quiz', async (context) => {
    try {
      const now = new Date();
      const day = getNairobiDay(now);
      const repository = new QuizRepository(context.env.DB);
      const questionIds = await ensureDailyQuiz(repository, day);
      const session = await repository.getOrCreateSession(day, context.get('playerId'));
      await repository.reconcileSessionTotals(day, context.get('playerId'));
      const answers = await repository.getPlayerAnswers(day, context.get('playerId'));
      const rank =
        answers.length === QUIZ_QUESTION_COUNT
          ? await repository.getCompletedPlayerRank(day, context.get('playerId'))
          : undefined;
      return context.json(
        QuizStateSchema.parse(
          buildQuizState({ day, questionIds, session, answers, ...(rank ? { rank } : {}) }),
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
  })
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
      const { questionId, selectedOptionId } = context.req.valid('json');
      const idempotencyKey = context.req.valid('header')['idempotency-key'];
      const repository = new QuizRepository(context.env.DB);

      try {
        const previous = await repository.getIdempotentAnswer(day, playerId, idempotencyKey);
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
          const questionIds = await ensureDailyQuiz(repository, day);
          const session = await repository.getOrCreateSession(day, playerId);
          await repository.reconcileSessionTotals(day, playerId);
          const answers = await repository.getPlayerAnswers(day, playerId);
          const rank =
            answers.length === QUIZ_QUESTION_COUNT
              ? await repository.getCompletedPlayerRank(day, playerId)
              : undefined;
          return context.json(
            QuizStateSchema.parse(
              buildQuizState({ day, questionIds, session, answers, ...(rank ? { rank } : {}) }),
            ),
          );
        }

        const questionIds = await ensureDailyQuiz(repository, day);
        const session = await repository.getOrCreateSession(day, playerId);
        await repository.reconcileSessionTotals(day, playerId);
        const answers = await repository.getPlayerAnswers(day, playerId);
        if (answers.length >= QUIZ_QUESTION_COUNT) {
          return safeError(
            context.res.headers.get('X-Request-Id') ?? 'unavailable',
            'quiz_finished',
            "You have completed today's challenge.",
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

        const inserted = await repository.saveAnswer({
          day,
          playerId,
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
          const current = await repository.getPlayerAnswers(day, playerId);
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

        const updatedAnswers = await repository.getPlayerAnswers(day, playerId);
        const rank =
          updatedAnswers.length === QUIZ_QUESTION_COUNT
            ? await repository.getCompletedPlayerRank(day, playerId)
            : undefined;
        return context.json(
          QuizStateSchema.parse(
            buildQuizState({
              day,
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
      const repository = new QuizRepository(context.env.DB);
      const [rows, totalPlayers, playerRank] = await Promise.all([
        repository.getLeaderboard(day),
        repository.countCompletedPlayers(day),
        repository.getCompletedPlayerRank(day, context.get('playerId')),
      ]);
      const items = rows.map((row, index) => ({
        position: index + 1,
        rank: rows.findIndex((candidate) => candidate.score === row.score) + 1,
        score: row.score,
        correctCount: row.correctCount,
      }));
      return context.json(
        QuizLeaderboardSchema.parse({
          day,
          totalPlayers,
          playerRank: playerRank?.rank ?? null,
          items,
        }),
      );
    } catch {
      return safeError(
        context.res.headers.get('X-Request-Id') ?? 'unavailable',
        'leaderboard_unavailable',
        'Today’s leaderboard is temporarily unavailable.',
        503,
      );
    }
  });

export { routes as quizRoutes };
