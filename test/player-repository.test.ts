import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerRepository } from '../src/worker/db/queries/player-repository';

const names = vi.hoisted(() => ({ queue: [] as string[] }));

vi.mock('../src/worker/lib/identity/random-player-name', () => ({
  createRandomPlayerName: () => names.queue.shift() ?? 'Fallback Name 9999',
}));

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
  names.queue = [];
});

describe('player profile creation', () => {
  it('retries with a new name when the generated name is already taken', async () => {
    const repository = new PlayerRepository(env.DB);
    names.queue = ['Bright Otter 0001'];
    const first = await repository.getOrCreate(crypto.randomUUID());

    names.queue = ['bright otter 0001', 'BRIGHT OTTER 0001', 'Calm Heron 0002'];
    const second = await repository.getOrCreate(crypto.randomUUID());

    expect(first.profile.displayName).toBe('Bright Otter 0001');
    expect(first.recoveryCode).toBeDefined();
    expect(second.profile.displayName).toBe('Calm Heron 0002');
    expect(second.recoveryCode).toBeDefined();
  });

  it('keeps the existing name for a returning player', async () => {
    const repository = new PlayerRepository(env.DB);
    const id = crypto.randomUUID();
    names.queue = ['Kind Zebra 0003'];
    await repository.getOrCreate(id);
    names.queue = ['Other Name 0004'];
    const again = await repository.getOrCreate(id);

    expect(again.profile.displayName).toBe('Kind Zebra 0003');
    expect(again.recoveryCode).toBeUndefined();
  });

  it('fails closed after repeated name collisions', async () => {
    const repository = new PlayerRepository(env.DB);
    names.queue = ['Quick Lion 0005'];
    await repository.getOrCreate(crypto.randomUUID());
    names.queue = Array.from({ length: 8 }, () => 'Quick Lion 0005');

    await expect(repository.getOrCreate(crypto.randomUUID())).rejects.toThrow(
      'PLAYER_PROFILE_UNAVAILABLE',
    );
  });
});
