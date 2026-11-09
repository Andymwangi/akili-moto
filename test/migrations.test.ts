import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const testEnv = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
  MIGRATION_TEST_DB: D1Database;
};

describe('migration 0006 upgrade path', () => {
  it('keeps in-progress rounds intact and gives the new timer columns real defaults', async () => {
    const db = testEnv.MIGRATION_TEST_DB;
    const all = testEnv.TEST_MIGRATIONS;
    const index = all.findIndex((migration) => migration.name.startsWith('0006_'));
    expect(index).toBeGreaterThan(0);

    await applyD1Migrations(db, all.slice(0, index));
    await db.batch([
      db.prepare(
        `INSERT INTO quiz_round_sessions
          (day, player_id, round_no, started_at, score, correct_count, completed_at, created_at, updated_at)
          VALUES ('2026-11-03', 'player-1', 1, '2026-11-03T06:00:00.000Z', 220, 2, NULL, 'c', 'u')`,
      ),
      db.prepare(
        `INSERT INTO quiz_round_answers
          (day, player_id, round_no, question_index, question_id, selected_option_id, correct_option_id,
           is_correct, points, response_ms, idempotency_key, submitted_at)
          VALUES ('2026-11-03', 'player-1', 1, 0, 'q-1', 'a', 'a', 1, 120, 900, 'key-1', '2026-11-03T06:00:01.000Z')`,
      ),
    ]);

    await applyD1Migrations(db, all);

    const session = await db
      .prepare(
        `SELECT score, correct_count, current_question_index,
          typeof(current_question_index) AS index_type, current_question_opened_at
        FROM quiz_round_sessions WHERE player_id = 'player-1'`,
      )
      .first();
    expect(session).toEqual({
      score: 220,
      correct_count: 2,
      current_question_index: 0,
      index_type: 'integer',
      current_question_opened_at: null,
    });
    const answer = await db
      .prepare(`SELECT question_id, selected_option_id, points FROM quiz_round_answers`)
      .first();
    expect(answer).toEqual({ question_id: 'q-1', selected_option_id: 'a', points: 120 });

    await expect(
      db
        .prepare(
          `INSERT INTO quiz_round_answers VALUES
          ('2026-11-04', 'player-1', 1, 14, 'q-2', NULL, 'b', 0, 0, 31000, 'key-2', 't')`,
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      db
        .prepare(
          `INSERT INTO quiz_round_answers VALUES
          ('2026-11-04', 'player-1', 1, 13, 'q-3', 'a', 'a', 1, 401, 10, 'key-3', 't')`,
        )
        .run(),
    ).rejects.toThrow();
  });
});
