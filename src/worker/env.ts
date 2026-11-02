import { z } from 'zod';

const RuntimeConfigSchema = z.object({
  APP_ENV: z.enum(['development', 'production']),
  ALLOWED_ORIGIN: z.string().url(),
  COOKIE_SIGNING_SECRET: z.string().min(32).optional(),
});

export type Bindings = Omit<Cloudflare.Env, 'APP_ENV' | 'ALLOWED_ORIGIN'> & {
  APP_ENV: 'development' | 'production';
  ALLOWED_ORIGIN: string;
  COOKIE_SIGNING_SECRET?: string;
};

export type AppEnvironment = {
  Bindings: Bindings;
  Variables: {
    playerId: string;
    requestId: string;
  };
};

export type RuntimeConfig = Readonly<{
  appEnv: 'development' | 'production';
  allowedOrigin: string;
  cookieSigningSecret: string;
}>;

export function readRuntimeConfig(bindings: Bindings): RuntimeConfig {
  const result = RuntimeConfigSchema.safeParse(bindings);
  if (!result.success) {
    const invalidSettings = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid runtime configuration: ${invalidSettings}`);
  }

  const values = result.data;
  if (values.APP_ENV === 'production' && !values.COOKIE_SIGNING_SECRET) {
    throw new Error('Invalid runtime configuration: COOKIE_SIGNING_SECRET');
  }

  return {
    appEnv: values.APP_ENV,
    allowedOrigin: values.ALLOWED_ORIGIN,
    cookieSigningSecret:
      values.COOKIE_SIGNING_SECRET ?? 'local-only-cookie-signing-secret-change-before-release',
  };
}
