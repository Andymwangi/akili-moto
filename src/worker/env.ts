import { z } from 'zod';

const AllowedOriginsSchema = z
  .string()
  .transform((value) => value.split(',').map((origin) => origin.trim()))
  .pipe(z.array(z.string().url()).min(1));

const RuntimeConfigSchema = z.object({
  APP_ENV: z.enum(['development', 'production']),
  ALLOWED_ORIGIN: AllowedOriginsSchema,
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
  allowedOrigins: readonly string[];
  cookieSigningSecret: string;
}>;

export function readAllowedOrigins(value: string): readonly string[] {
  return AllowedOriginsSchema.parse(value);
}

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
    allowedOrigins: values.ALLOWED_ORIGIN,
    cookieSigningSecret:
      values.COOKIE_SIGNING_SECRET ?? 'local-only-cookie-signing-secret-change-before-release',
  };
}
