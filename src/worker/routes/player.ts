import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  ApiErrorSchema,
  PlayerHistoryQuerySchema,
  PlayerHistorySchema,
  PlayerProfileSchema,
  RecoveryCodeSchema,
  UpdatePlayerNameSchema,
} from '../../shared/schemas/quiz';
import { type PlayerProfile, PlayerRepository } from '../db/queries/player-repository';
import { QuizRepository } from '../db/queries/quiz-repository';
import type { AppEnvironment } from '../env';
import { setPlayerCookie } from '../middleware/player';

function errorResponse(
  requestId: string,
  code: string,
  message: string,
  status: 400 | 404 | 409 | 503,
) {
  return Response.json(ApiErrorSchema.parse({ error: { code, message, requestId } }), { status });
}

function requestId(context: { res: Response }): string {
  return context.res.headers.get('X-Request-Id') ?? 'unavailable';
}

const routes = new Hono<AppEnvironment>()
  .get('/player', async (context) => {
    try {
      const result = await new PlayerRepository(context.env.DB).getOrCreate(
        context.get('playerId'),
      );
      return context.json(
        PlayerProfileSchema.parse({
          playerId: result.profile.id,
          displayName: result.profile.displayName,
          ...(result.recoveryCode ? { recoveryCode: result.recoveryCode } : {}),
        }),
      );
    } catch {
      return errorResponse(
        requestId(context),
        'profile_unavailable',
        'Your player profile is temporarily unavailable.',
        503,
      );
    }
  })
  .patch(
    '/player/name',
    zValidator('json', UpdatePlayerNameSchema, (result, context) => {
      if (!result.success) {
        return errorResponse(
          requestId(context),
          'validation_failed',
          'Choose a name using 2 to 24 letters, numbers, spaces, hyphens, or underscores.',
          400,
        );
      }
    }),
    async (context) => {
      try {
        const repository = new PlayerRepository(context.env.DB);
        const playerId = context.get('playerId');
        const { displayName } = context.req.valid('json');
        if (await repository.isDisplayNameTaken(playerId, displayName)) {
          return errorResponse(
            requestId(context),
            'name_unavailable',
            'That name may already be in use. Choose another name.',
            409,
          );
        }
        let result: PlayerProfile | undefined;
        try {
          result = await repository.updateDisplayName(playerId, displayName);
        } catch (error) {
          if (await repository.isDisplayNameTaken(playerId, displayName)) {
            return errorResponse(
              requestId(context),
              'name_unavailable',
              'That name may already be in use. Choose another name.',
              409,
            );
          }
          throw error;
        }
        if (!result) {
          return errorResponse(
            requestId(context),
            'profile_not_found',
            'Player profile not found.',
            404,
          );
        }
        return context.json(
          PlayerProfileSchema.parse({ playerId: result.id, displayName: result.displayName }),
        );
      } catch {
        return errorResponse(
          requestId(context),
          'profile_unavailable',
          'Your player profile is temporarily unavailable.',
          503,
        );
      }
    },
  )
  .post('/player/recovery-code', async (context) => {
    try {
      const repository = new PlayerRepository(context.env.DB);
      const recoveryCode = await repository.rotateRecoveryCode(context.get('playerId'));
      if (!recoveryCode) {
        return errorResponse(
          requestId(context),
          'profile_not_found',
          'Player profile not found.',
          404,
        );
      }
      const profile = await repository.getById(context.get('playerId'));
      if (!profile) throw new Error('PLAYER_PROFILE_UNAVAILABLE');
      return context.json(
        PlayerProfileSchema.parse({
          playerId: profile.id,
          displayName: profile.displayName,
          recoveryCode,
        }),
      );
    } catch {
      return errorResponse(
        requestId(context),
        'recovery_unavailable',
        'A new recovery code could not be created.',
        503,
      );
    }
  })
  .post(
    '/player/recover',
    zValidator('json', RecoveryCodeSchema, (result, context) => {
      if (!result.success) {
        return errorResponse(
          requestId(context),
          'validation_failed',
          'The recovery code is invalid.',
          400,
        );
      }
    }),
    async (context) => {
      try {
        const profile = await new PlayerRepository(context.env.DB).findByRecoveryCode(
          context.req.valid('json').recoveryCode,
        );
        if (!profile) {
          return errorResponse(
            requestId(context),
            'recovery_failed',
            'The recovery code was not recognized.',
            404,
          );
        }
        context.set('playerId', profile.id);
        await setPlayerCookie(context, profile.id);
        return context.json(
          PlayerProfileSchema.parse({ playerId: profile.id, displayName: profile.displayName }),
        );
      } catch {
        return errorResponse(
          requestId(context),
          'recovery_unavailable',
          'Identity recovery is temporarily unavailable.',
          503,
        );
      }
    },
  )
  .get(
    '/player/history',
    zValidator('query', PlayerHistoryQuerySchema, (result, context) => {
      if (!result.success) {
        return errorResponse(
          requestId(context),
          'validation_failed',
          'The history query is invalid.',
          400,
        );
      }
    }),
    async (context) => {
      try {
        const { limit, before } = context.req.valid('query');
        const history = await new QuizRepository(context.env.DB).getPlayerHistory(
          context.get('playerId'),
          limit,
          before,
        );
        return context.json(PlayerHistorySchema.parse(history));
      } catch {
        return errorResponse(
          requestId(context),
          'history_unavailable',
          'Your game history is temporarily unavailable.',
          503,
        );
      }
    },
  );

export { routes as playerRoutes };
