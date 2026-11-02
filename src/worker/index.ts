import { Hono } from 'hono';
import { PlayerRepository } from './db/queries/player-repository';
import { QuizRepository } from './db/queries/quiz-repository';
import type { AppEnvironment, Bindings } from './env';
import { addDays, getNairobiDay } from './lib/game/day';
import { ensureDailyQuiz } from './lib/quiz/daily-quiz';
import { rateLimit } from './middleware/rate-limit';
import {
  apiCors,
  apiOriginGuard,
  requestBodyLimit,
  requestIdentity,
  securityHeaders,
} from './middleware/security';
import { publicRouteGuard } from './public-routes';
import { playerRoutes } from './routes/player';
import { quizRoutes } from './routes/quiz';

const app = new Hono<AppEnvironment>()
  .use('*', requestIdentity)
  .use('*', securityHeaders)
  .use('/api/*', apiCors)
  .use('/api/*', apiOriginGuard)
  .use('*', requestBodyLimit)
  .use('*', rateLimit)
  .use('/api/*', publicRouteGuard)
  .get('/api/health', (context) => context.json({ status: 'ok' as const }))
  .route('/api', quizRoutes)
  .route('/api', playerRoutes);

app.onError((error, context) => {
  const requestId = context.get('requestId') ?? 'unavailable';
  const status = error.name === 'HTTPException' ? 400 : 500;
  return context.json(
    {
      error: {
        code: status === 400 ? 'request_error' : 'internal_error',
        message:
          status === 400 ? 'The request could not be processed.' : 'An internal error occurred.',
        requestId,
      },
    },
    status,
  );
});

app.notFound(async (context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json(
      {
        error: {
          code: 'not_found',
          message: 'The requested route was not found.',
          requestId: context.get('requestId'),
        },
      },
      404,
    );
  }
  return context.env.ASSETS.fetch(context.req.raw);
});

export type AppType = typeof app;

export default {
  fetch(request: Request, env: Bindings, executionContext: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, executionContext));
  },
  async scheduled(controller: ScheduledController, env: Bindings): Promise<void> {
    const repository = new QuizRepository(env.DB);
    const today = getNairobiDay(new Date(controller.scheduledTime));
    await ensureDailyQuiz(repository, today);
    await ensureDailyQuiz(repository, addDays(today, 1));
    await new PlayerRepository(env.DB).pruneExpiredRecoveryRateLimits(
      Math.floor(controller.scheduledTime / 1000) - 86_400,
    );
  },
} satisfies ExportedHandler<Bindings>;
