import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../env';

async function hashClientAddress(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const rateLimit: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const isAnswer = context.req.method === 'POST' && context.req.path === '/api/quiz/answer';
  const isRecovery = context.req.method === 'POST' && context.req.path === '/api/player/recover';
  if (!isAnswer && !isRecovery) {
    await next();
    return;
  }

  const address = context.req.header('CF-Connecting-IP') ?? 'local-development';
  if (isRecovery) {
    const addressHash = await hashClientAddress(address);
    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = 900;
    const nowIso = new Date(now * 1000).toISOString();
    try {
      await context.env.DB.prepare(
        'DELETE FROM player_recovery_rate_limits WHERE window_started_at <= ?',
      )
        .bind(now - 86_400)
        .run();
      const row = await context.env.DB.prepare(
        `INSERT INTO player_recovery_rate_limits
          (address_hash, window_started_at, hit_count, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(address_hash) DO UPDATE SET
          window_started_at = CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END,
          hit_count = CASE
            WHEN window_started_at <= ? THEN 1
            WHEN hit_count < 6 THEN hit_count + 1
            ELSE 6
          END,
          updated_at = ?
        RETURNING hit_count, window_started_at`,
      )
        .bind(
          addressHash,
          now,
          nowIso,
          nowIso,
          now - windowSeconds,
          now,
          now - windowSeconds,
          nowIso,
        )
        .first<{ hit_count: number; window_started_at: number }>();
      if (!row) throw new Error('RECOVERY_RATE_LIMIT_UNAVAILABLE');
      if (row.hit_count > 5) {
        context.header(
          'Retry-After',
          String(Math.max(1, row.window_started_at + windowSeconds - now)),
        );
        return context.json(
          {
            error: {
              code: 'rate_limited',
              message: 'Too many recovery attempts. Wait a while and try again.',
              requestId: context.get('requestId'),
            },
          },
          429,
        );
      }
    } catch {
      return context.json(
        {
          error: {
            code: 'rate_limit_unavailable',
            message: 'Identity recovery is temporarily unavailable.',
            requestId: context.get('requestId'),
          },
        },
        503,
      );
    }
    await next();
    return;
  }

  const key = `quiz-answer:${await hashClientAddress(address)}`;
  const current = Number((await context.env.RATE_LIMIT.get(key)) ?? '0');
  const limit = 20;
  if (current >= limit) {
    context.header('Retry-After', String(isRecovery ? 900 : 60));
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
  await context.env.RATE_LIMIT.put(key, String(current + 1), {
    expirationTtl: 60,
  });
  await next();
};
