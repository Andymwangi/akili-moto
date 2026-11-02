import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../env';

async function hashClientAddress(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const rateLimit: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  if (context.req.method !== 'POST' || context.req.path !== '/api/quiz/answer') {
    await next();
    return;
  }

  const address = context.req.header('CF-Connecting-IP') ?? 'local-development';
  const key = `quiz-answer:${await hashClientAddress(address)}`;
  const current = Number((await context.env.RATE_LIMIT.get(key)) ?? '0');
  if (current >= 20) {
    context.header('Retry-After', '60');
    context.json(
      {
        error: {
          code: 'rate_limited',
          message: 'Too many answers. Wait a moment and try again.',
          requestId: context.get('requestId'),
        },
      },
      429,
    );
    return;
  }
  await context.env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 60 });
  await next();
};
