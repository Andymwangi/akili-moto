import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { type AppEnvironment, readAllowedOrigins } from '../env';

export const requestIdentity: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  context.set('requestId', crypto.randomUUID());
  context.header('X-Request-Id', context.get('requestId'));
  await next();
};

export const securityHeaders: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('X-Frame-Options', 'DENY');
  context.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const stylePolicy =
    context.env.APP_ENV === 'development' ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";
  const connectPolicy =
    context.env.APP_ENV === 'development'
      ? "connect-src 'self' ws://localhost:5173"
      : "connect-src 'self'";
  context.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; ${stylePolicy}; img-src 'self' data:; ${connectPolicy}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  );
  if (context.req.path.startsWith('/api/')) {
    context.header('Cache-Control', 'private, no-store');
  }
  await next();
};

export const apiCors: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  return cors({
    origin: [...readAllowedOrigins(context.env.ALLOWED_ORIGIN)],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 600,
  })(context, next);
};

export const apiOriginGuard: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const mutatingMethod = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(context.req.method);
  if (!context.req.path.startsWith('/api/') || !mutatingMethod) {
    await next();
    return;
  }
  const origin = context.req.header('Origin');
  const allowedOrigins = readAllowedOrigins(context.env.ALLOWED_ORIGIN);
  const isConfiguredOrigin = origin !== undefined && allowedOrigins.includes(origin);
  const isSameOriginDevelopmentRequest =
    context.env.APP_ENV === 'development' && origin === new URL(context.req.url).origin;
  if (isConfiguredOrigin || isSameOriginDevelopmentRequest) {
    await next();
    return;
  }
  return context.json(
    {
      error: {
        code: 'origin_not_allowed',
        message: 'This request origin is not allowed.',
        requestId: context.res.headers.get('X-Request-Id') ?? 'unavailable',
      },
    },
    403,
  );
};

export const requestBodyLimit: MiddlewareHandler<AppEnvironment> = bodyLimit({
  maxSize: 1024,
  onError: (context) =>
    context.json(
      {
        error: {
          code: 'request_too_large',
          message: 'The request is too large.',
          requestId: context.get('requestId'),
        },
      },
      413,
    ),
});
