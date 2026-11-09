import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerRepository } from '../src/worker/db/queries/player-repository';

/** Returns the given names in order, then a fixed fallback. */
function scriptedNames(...names: string[]): () => string {
  const queue = [...names];
  return () => queue.shift() ?? 'Fallback Name 9999';
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      recovery_code_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS players_recovery_code_hash_unique
      ON players(recovery_code_hash)`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS players_display_name_unique
      ON players(lower(display_name))`),
    env.DB.prepare('DELETE FROM players'),
  ]);
});

describe('player profile creation', () => {
  it('retries with a new name when the generated name is already taken', async () => {
    const first = await new PlayerRepository(env.DB, scriptedNames('Bright Otter 0001')).getOrCreate(
      crypto.randomUUID(),
    );
    const second = await new PlayerRepository(
      env.DB,
      scriptedNames('bright otter 0001', 'BRIGHT OTTER 0001', 'Calm Heron 0002'),
    ).getOrCreate(crypto.randomUUID());

    expect(first.profile.displayName).toBe('Bright Otter 0001');
    expect(first.recoveryCode).toBeDefined();
    expect(second.profile.displayName).toBe('Calm Heron 0002');
    expect(second.recoveryCode).toBeDefined();
  });

  it('keeps the existing name for a returning player', async () => {
    const id = crypto.randomUUID();
    await new PlayerRepository(env.DB, scriptedNames('Kind Zebra 0003')).getOrCreate(id);
    const again = await new PlayerRepository(env.DB, scriptedNames('Other Name 0004')).getOrCreate(
      id,
    );

    expect(again.profile.displayName).toBe('Kind Zebra 0003');
    expect(again.recoveryCode).toBeUndefined();
  });

  it('fails closed after repeated name collisions', async () => {
    await new PlayerRepository(env.DB, scriptedNames('Quick Lion 0005')).getOrCreate(
      crypto.randomUUID(),
    );
    const colliding = new PlayerRepository(env.DB, () => 'Quick Lion 0005');

    await expect(colliding.getOrCreate(crypto.randomUUID())).rejects.toThrow(
      'PLAYER_PROFILE_UNAVAILABLE',
    );
  });
});
