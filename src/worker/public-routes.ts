import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from './env';
import { playerIdentity } from './middleware/player';

export const publicRoutes = new Set([
  'GET /api/health',
  'GET /api/quiz',
  'POST /api/quiz/answer',
  'GET /api/quiz/leaderboard',
  'GET /api/player',
  'PATCH /api/player/name',
  'POST /api/player/recovery-code',
  'POST /api/player/recover',
  'GET /api/player/history',
]);

export const publicRouteGuard: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const route = `${context.req.method} ${context.req.path}`;
  if (!publicRoutes.has(route)) {
    return context.json(
      {
        error: {
          code: 'authentication_required',
          message: 'Authentication is required for this route.',
          requestId: context.get('requestId'),
        },
      },
      401,
    );
  }
  return playerIdentity(context, next);
};
