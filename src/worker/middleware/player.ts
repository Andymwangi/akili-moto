import type { Context, MiddlewareHandler } from 'hono';
import { PLAYER_COOKIE_MAX_AGE, PLAYER_COOKIE_NAME } from '../../shared/constants';
import { type AppEnvironment, readRuntimeConfig } from '../env';

const encoder = new TextEncoder();

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signPlayerId(playerId: string, secret: string): Promise<string> {
  const key = await signingKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(playerId));
  return `${playerId}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function setPlayerCookie(
  context: Context<AppEnvironment>,
  playerId: string,
): Promise<void> {
  const config = readRuntimeConfig(context.env);
  const signed = await signPlayerId(playerId, config.cookieSigningSecret);
  context.header(
    'Set-Cookie',
    `${PLAYER_COOKIE_NAME}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${PLAYER_COOKIE_MAX_AGE}`,
  );
}

async function verifyPlayerId(value: string, secret: string): Promise<string | undefined> {
  const separator = value.lastIndexOf('.');
  if (separator < 1) return undefined;
  const playerId = value.slice(0, separator);
  const signature = decodeBase64Url(value.slice(separator + 1));
  if (!signature || !/^[0-9a-f-]{36}$/i.test(playerId)) return undefined;
  const key = await signingKey(secret);
  const signatureBuffer = new Uint8Array(signature).buffer;
  const valid = await crypto.subtle.verify('HMAC', key, signatureBuffer, encoder.encode(playerId));
  return valid ? playerId : undefined;
}

function cookieValue(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${PLAYER_COOKIE_NAME}=`)) {
      return trimmed.slice(PLAYER_COOKIE_NAME.length + 1);
    }
  }
  return undefined;
}

export const playerIdentity: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const config = readRuntimeConfig(context.env);
  const incoming = cookieValue(context.req.header('Cookie'));
  const existing = incoming
    ? await verifyPlayerId(incoming, config.cookieSigningSecret)
    : undefined;
  const playerId = existing ?? crypto.randomUUID();
  context.set('playerId', playerId);
  if (!existing) {
    const signed = await signPlayerId(playerId, config.cookieSigningSecret);
    context.header(
      'Set-Cookie',
      `${PLAYER_COOKIE_NAME}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${PLAYER_COOKIE_MAX_AGE}`,
      { append: true },
    );
  }
  await next();
};
