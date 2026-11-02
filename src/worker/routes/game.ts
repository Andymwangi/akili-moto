import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { MAX_ATTEMPTS } from '../../shared/constants';
import {
  GameStateSchema,
  GuessBodySchema,
  IdempotencyHeaderSchema,
} from '../../shared/schemas/game';
import { GameRepository } from '../db/queries/game-repository';
import type { AppEnvironment } from '../env';
import { getNairobiDay } from '../lib/game/day';
import { buildGameState, toAttempt } from '../lib/game/state';
import { ensureDailyAnswer } from '../lib/words/daily-answer';

function safeError(
  requestId: string,
  code: string,
  message: string,
  status: 400 | 409 | 422 | 503,
) {
  return Response.json({ error: { code, message, requestId } }, { status });
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

const routes = new Hono<AppEnvironment>()
  .get('/game', async (context) => {
    try {
      const day = getNairobiDay(new Date());
      const repository = new GameRepository(context.env.DB);
      const answer = await ensureDailyAnswer(repository, day);
      const guesses = await repository.getPlayerGuesses(day, context.get('playerId'));
      return context.json(GameStateSchema.parse(buildGameState(day, answer, guesses)));
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'ANSWER_POOL_EXHAUSTED'
          ? 'answer_pool_unavailable'
          : 'game_unavailable';
      return safeError(
        context.get('requestId'),
        code,
        'The daily game is temporarily unavailable.',
        503,
      );
    }
  })
  .post(
    '/game/guess',
    zValidator('header', IdempotencyHeaderSchema),
    zValidator('json', GuessBodySchema),
    async (context) => {
      const day = getNairobiDay(new Date());
      const playerId = context.get('playerId');
      const repository = new GameRepository(context.env.DB);
      const { guess } = context.req.valid('json');
      const idempotencyKey = context.req.valid('header')['idempotency-key'];

      try {
        const answer = await ensureDailyAnswer(repository, day);
        const previous = await repository.getIdempotentGuess(day, playerId, idempotencyKey);
        if (previous) {
          if (previous.guess !== guess) {
            return safeError(
              context.get('requestId'),
              'idempotency_conflict',
              'That request key was already used.',
              409,
            );
          }
          const priorGuesses = await repository.getPlayerGuesses(day, playerId);
          return context.json(GameStateSchema.parse(buildGameState(day, answer, priorGuesses)));
        }

        const current = await repository.getPlayerGuesses(day, playerId);
        const currentState = buildGameState(day, answer, current);
        if (currentState.status !== 'in_progress') {
          return safeError(
            context.get('requestId'),
            'game_finished',
            'The game is already finished.',
            409,
          );
        }
        if (current.length >= MAX_ATTEMPTS) {
          return safeError(
            context.get('requestId'),
            'attempt_limit',
            'You have used all six guesses.',
            409,
          );
        }
        if (!(await repository.isAllowedGuess(guess))) {
          return safeError(
            context.get('requestId'),
            'word_not_allowed',
            'That word is not in the game dictionary.',
            422,
          );
        }

        const attempt = toAttempt(guess, answer);
        await repository.saveGuess({
          day,
          playerId,
          guess,
          feedback: attempt.feedback,
          idempotencyKey,
          createdAt: new Date().toISOString(),
        });

        const updated = await repository.getPlayerGuesses(day, playerId);
        return context.json(GameStateSchema.parse(buildGameState(day, answer, updated)));
      } catch (error) {
        try {
          const duplicate = await repository.getIdempotentGuess(day, playerId, idempotencyKey);
          if (duplicate?.guess === guess) {
            const answer = await repository.getDailyAnswer(day);
            if (answer) {
              const latest = await repository.getPlayerGuesses(day, playerId);
              return context.json(GameStateSchema.parse(buildGameState(day, answer, latest)));
            }
          }
        } catch {
          // Keep the original failure response if the idempotency check also fails.
        }
        if (isUniqueConflict(error)) {
          return safeError(
            context.get('requestId'),
            'guess_conflict',
            'A guess was submitted at the same time.',
            409,
          );
        }
        if (error instanceof Error && error.message === 'ATTEMPT_LIMIT') {
          return safeError(
            context.get('requestId'),
            'attempt_limit',
            'You have used all six guesses.',
            409,
          );
        }
        return safeError(
          context.get('requestId'),
          'game_unavailable',
          'The guess could not be saved.',
          503,
        );
      }
    },
  );

export { routes as gameRoutes };
