import { and, asc, eq } from 'drizzle-orm';
import { type Attempt, AttemptSchema } from '../../../shared/schemas/game';
import { createDatabase, type Database } from '../client';
import { allowedGuesses, answerPool, dailyAnswers, guesses } from '../schema';

export type StoredGuess = Readonly<{
  attemptNumber: number;
  guess: string;
  feedback: Attempt['feedback'];
  idempotencyKey: string;
}>;

export class GameRepository {
  private readonly db: Database;

  constructor(binding: D1Database) {
    this.db = createDatabase(binding);
  }

  async getDailyAnswer(day: string): Promise<string | undefined> {
    const [row] = await this.db
      .select()
      .from(dailyAnswers)
      .where(eq(dailyAnswers.day, day))
      .limit(1);
    return row?.word;
  }

  async assignDailyAnswer(day: string, randomWord: string): Promise<string | undefined> {
    await this.db.insert(dailyAnswers).values({ day, word: randomWord }).onConflictDoNothing();
    return this.getDailyAnswer(day);
  }

  async getUnusedAnswers(): Promise<string[]> {
    const allWords = await this.db.select({ word: answerPool.word }).from(answerPool);
    const assignedWords = await this.db.select({ word: dailyAnswers.word }).from(dailyAnswers);
    const used = new Set(assignedWords.map((row) => row.word));
    return allWords.map((row) => row.word).filter((word) => !used.has(word));
  }

  async isAllowedGuess(word: string): Promise<boolean> {
    const [row] = await this.db
      .select({ word: allowedGuesses.word })
      .from(allowedGuesses)
      .where(eq(allowedGuesses.word, word))
      .limit(1);
    return row !== undefined;
  }

  async getPlayerGuesses(day: string, playerId: string): Promise<StoredGuess[]> {
    const rows = await this.db
      .select()
      .from(guesses)
      .where(and(eq(guesses.day, day), eq(guesses.playerId, playerId)))
      .orderBy(asc(guesses.attemptNumber));
    return rows.map((row) => ({
      attemptNumber: row.attemptNumber,
      guess: row.guess,
      feedback: AttemptSchema.parse({ guess: row.guess, feedback: JSON.parse(row.feedback) })
        .feedback,
      idempotencyKey: row.idempotencyKey,
    }));
  }

  async getIdempotentGuess(
    day: string,
    playerId: string,
    key: string,
  ): Promise<StoredGuess | undefined> {
    const [row] = await this.db
      .select()
      .from(guesses)
      .where(
        and(eq(guesses.day, day), eq(guesses.playerId, playerId), eq(guesses.idempotencyKey, key)),
      )
      .limit(1);
    if (!row) return undefined;
    return {
      attemptNumber: row.attemptNumber,
      guess: row.guess,
      feedback: AttemptSchema.parse({ guess: row.guess, feedback: JSON.parse(row.feedback) })
        .feedback,
      idempotencyKey: row.idempotencyKey,
    };
  }

  async saveGuess(input: {
    day: string;
    playerId: string;
    guess: string;
    feedback: Attempt['feedback'];
    idempotencyKey: string;
    createdAt: string;
  }): Promise<void> {
    const previous = await this.getIdempotentGuess(input.day, input.playerId, input.idempotencyKey);
    if (previous) return;

    const current = await this.getPlayerGuesses(input.day, input.playerId);
    if (current.length >= 6) throw new Error('ATTEMPT_LIMIT');

    await this.db.insert(guesses).values({
      day: input.day,
      playerId: input.playerId,
      attemptNumber: current.length + 1,
      guess: input.guess,
      feedback: JSON.stringify(input.feedback),
      idempotencyKey: input.idempotencyKey,
      createdAt: input.createdAt,
    });
  }
}
