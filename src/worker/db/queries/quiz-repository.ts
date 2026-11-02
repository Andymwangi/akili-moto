import { and, asc, count, desc, eq, gt, isNotNull } from 'drizzle-orm';
import { QUIZ_QUESTION_COUNT } from '../../../shared/constants';
import { createDatabase, type Database } from '../client';
import { dailyQuizzes, quizAnswers, quizSessions } from '../schema';

export type StoredQuizAnswer = typeof quizAnswers.$inferSelect;
export type CompletedScore = Readonly<{
  score: number;
  correctCount: number;
  completedAt: string;
}>;

export class QuizRepository {
  private readonly db: Database;

  constructor(binding: D1Database) {
    this.db = createDatabase(binding);
  }

  async getDailyQuestionIds(day: string): Promise<string[] | undefined> {
    const [row] = await this.db
      .select({ questionIds: dailyQuizzes.questionIds })
      .from(dailyQuizzes)
      .where(eq(dailyQuizzes.day, day))
      .limit(1);
    if (!row) return undefined;
    const parsed: unknown = JSON.parse(row.questionIds);
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
      throw new Error('INVALID_DAILY_QUIZ');
    }
    return parsed;
  }

  async assignDailyQuiz(day: string, questionIds: string[], questionSetVersion: string) {
    const now = new Date().toISOString();
    await this.db
      .insert(dailyQuizzes)
      .values({
        day,
        questionIds: JSON.stringify(questionIds),
        questionSetVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    return this.getDailyQuestionIds(day);
  }

  async getOrCreateSession(day: string, playerId: string) {
    const now = new Date().toISOString();
    await this.db
      .insert(quizSessions)
      .values({ day, playerId, startedAt: now, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
    const [session] = await this.db
      .select()
      .from(quizSessions)
      .where(and(eq(quizSessions.day, day), eq(quizSessions.playerId, playerId)))
      .limit(1);
    if (!session) throw new Error('QUIZ_SESSION_UNAVAILABLE');
    return session;
  }

  async getPlayerAnswers(day: string, playerId: string): Promise<StoredQuizAnswer[]> {
    return this.db
      .select()
      .from(quizAnswers)
      .where(and(eq(quizAnswers.day, day), eq(quizAnswers.playerId, playerId)))
      .orderBy(asc(quizAnswers.questionIndex));
  }

  async reconcileSessionTotals(day: string, playerId: string): Promise<void> {
    await this.refreshSessionTotals(day, playerId);
  }

  async getIdempotentAnswer(
    day: string,
    playerId: string,
    idempotencyKey: string,
  ): Promise<StoredQuizAnswer | undefined> {
    const [row] = await this.db
      .select()
      .from(quizAnswers)
      .where(
        and(
          eq(quizAnswers.day, day),
          eq(quizAnswers.playerId, playerId),
          eq(quizAnswers.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row;
  }

  async saveAnswer(input: {
    day: string;
    playerId: string;
    questionIndex: number;
    questionId: string;
    selectedOptionId: 'a' | 'b' | 'c' | 'd';
    correctOptionId: 'a' | 'b' | 'c' | 'd';
    isCorrect: boolean;
    points: number;
    responseMs: number;
    idempotencyKey: string;
    submittedAt: string;
  }): Promise<boolean> {
    const inserted = await this.db
      .insert(quizAnswers)
      .values(input)
      .onConflictDoNothing()
      .returning({ questionIndex: quizAnswers.questionIndex });
    await this.refreshSessionTotals(input.day, input.playerId);
    return inserted.length === 1;
  }

  async getPlayerSession(day: string, playerId: string) {
    const [session] = await this.db
      .select()
      .from(quizSessions)
      .where(and(eq(quizSessions.day, day), eq(quizSessions.playerId, playerId)))
      .limit(1);
    return session;
  }

  async getCompletedPlayerRank(
    day: string,
    playerId: string,
  ): Promise<{ rank: number; completedPlayers: number } | undefined> {
    const session = await this.getPlayerSession(day, playerId);
    if (!session?.completedAt) return undefined;
    const [ahead] = await this.db
      .select({ total: count() })
      .from(quizSessions)
      .where(
        and(
          eq(quizSessions.day, day),
          isNotNull(quizSessions.completedAt),
          gt(quizSessions.score, session.score),
        ),
      );
    const [total] = await this.db
      .select({ total: count() })
      .from(quizSessions)
      .where(and(eq(quizSessions.day, day), isNotNull(quizSessions.completedAt)));
    return { rank: (ahead?.total ?? 0) + 1, completedPlayers: total?.total ?? 0 };
  }

  async getLeaderboard(day: string, limit = 20) {
    return this.db
      .select({ score: quizSessions.score, correctCount: quizSessions.correctCount })
      .from(quizSessions)
      .where(and(eq(quizSessions.day, day), isNotNull(quizSessions.completedAt)))
      .orderBy(
        desc(quizSessions.score),
        desc(quizSessions.correctCount),
        asc(quizSessions.completedAt),
      )
      .limit(limit);
  }

  async countCompletedPlayers(day: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(quizSessions)
      .where(and(eq(quizSessions.day, day), isNotNull(quizSessions.completedAt)));
    return row?.total ?? 0;
  }

  private async refreshSessionTotals(day: string, playerId: string): Promise<void> {
    const answers = await this.getPlayerAnswers(day, playerId);
    const score = answers.reduce((total, answer) => total + answer.points, 0);
    const correctCount = answers.reduce((total, answer) => total + Number(answer.isCorrect), 0);
    const completedAt = answers.length === QUIZ_QUESTION_COUNT ? answers.at(-1)?.submittedAt : null;
    await this.db
      .update(quizSessions)
      .set({ score, correctCount, completedAt, updatedAt: new Date().toISOString() })
      .where(and(eq(quizSessions.day, day), eq(quizSessions.playerId, playerId)));
  }
}
