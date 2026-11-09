import { and, eq, lte, ne, sql } from 'drizzle-orm';
import { createRandomPlayerName } from '../../lib/identity/random-player-name';
import { createRecoveryCode, hashRecoveryCode } from '../../lib/identity/recovery-code';
import { createDatabase } from '../client';
import { playerRecoveryRateLimits, players } from '../schema';

const MAX_PROFILE_CREATION_ATTEMPTS = 8;

export type PlayerProfile = Readonly<{
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}>;

export class PlayerRepository {
  private readonly db;

  constructor(
    binding: D1Database,
    private readonly createName: () => string = createRandomPlayerName,
  ) {
    this.db = createDatabase(binding);
  }

  async getOrCreate(id: string): Promise<{ profile: PlayerProfile; recoveryCode?: string }> {
    const now = new Date().toISOString();
    for (let attempt = 0; attempt < MAX_PROFILE_CREATION_ATTEMPTS; attempt += 1) {
      const recoveryCode = createRecoveryCode();
      const [created] = await this.db
        .insert(players)
        .values({
          id,
          displayName: this.createName(),
          recoveryCodeHash: await hashRecoveryCode(recoveryCode),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: players.id });
      const profile = await this.getById(id);
      if (profile) return created ? { profile, recoveryCode } : { profile };
    }
    throw new Error('PLAYER_PROFILE_UNAVAILABLE');
  }

  async getById(id: string): Promise<PlayerProfile | undefined> {
    const [row] = await this.db
      .select({
        id: players.id,
        displayName: players.displayName,
        createdAt: players.createdAt,
        updatedAt: players.updatedAt,
      })
      .from(players)
      .where(eq(players.id, id))
      .limit(1);
    return row;
  }

  async updateDisplayName(id: string, displayName: string): Promise<PlayerProfile | undefined> {
    const [row] = await this.db
      .update(players)
      .set({ displayName, updatedAt: new Date().toISOString() })
      .where(eq(players.id, id))
      .returning({
        id: players.id,
        displayName: players.displayName,
        createdAt: players.createdAt,
        updatedAt: players.updatedAt,
      });
    return row;
  }

  async isDisplayNameTaken(id: string, displayName: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: players.id })
      .from(players)
      .where(and(sql`lower(${players.displayName}) = lower(${displayName})`, ne(players.id, id)))
      .limit(1);
    return row !== undefined;
  }

  async rotateRecoveryCode(id: string): Promise<string | undefined> {
    const recoveryCode = createRecoveryCode();
    const rows = await this.db
      .update(players)
      .set({
        recoveryCodeHash: await hashRecoveryCode(recoveryCode),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(players.id, id))
      .returning({ id: players.id });
    return rows.length === 1 ? recoveryCode : undefined;
  }

  async findByRecoveryCode(code: string): Promise<PlayerProfile | undefined> {
    const hash = await hashRecoveryCode(code);
    const [row] = await this.db
      .select({
        id: players.id,
        displayName: players.displayName,
        createdAt: players.createdAt,
        updatedAt: players.updatedAt,
      })
      .from(players)
      .where(eq(players.recoveryCodeHash, hash))
      .limit(1);
    return row;
  }

  async pruneExpiredRecoveryRateLimits(cutoffSeconds: number): Promise<void> {
    await this.db
      .delete(playerRecoveryRateLimits)
      .where(lte(playerRecoveryRateLimits.windowStartedAt, cutoffSeconds));
  }
}
