import { and, asc, count, desc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../client';
import { dailyQuizzes, players, quizRoundAnswers, quizRoundSessions } from '../schema';

export type QuizRoundNumber = 1 | 2;
export type StoredQuizAnswer = typeof quizRoundAnswers.$inferSelect;
export type QuestionSetPair = Readonly<{
  roundOneIds: string[];
  roundOneVersion: string;
  roundTwoIds: string[] | null;
  roundTwoVersion: string | null;
}>;

function parseIds(value: string | null): string[] | null {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error('INVALID_DAILY_QUIZ');
  }
  return parsed;
}

export class QuizRepository {
  private readonly db: Database;

  constructor(binding: D1Database) {
    this.db = createDatabase(binding);
  }

  async getDailyQuestionPair(day: string): Promise<QuestionSetPair | undefined> {
    const [row] = await this.db
      .select()
      .from(dailyQuizzes)
      .where(eq(dailyQuizzes.day, day))
      .limit(1);
    if (!row) return undefined;
    const roundOneIds = parseIds(row.questionIds);
    if (!roundOneIds) throw new Error('INVALID_DAILY_QUIZ');
    return {
      roundOneIds,
      roundOneVersion: row.questionSetVersion,
      roundTwoIds: parseIds(row.roundTwoQuestionIds),
      roundTwoVersion: row.roundTwoQuestionSetVersion,
    };
  }

  async getUsedQuestionSetKeys(): Promise<Set<string>> {
    const rows = await this.db
      .select({ first: dailyQuizzes.questionSetKey, second: dailyQuizzes.roundTwoQuestionSetKey })
      .from(dailyQuizzes);
    return new Set(
      rows.flatMap((row) => [row.first, row.second].filter((key): key is string => Boolean(key))),
    );
  }

  async assignDailyQuestionPair(
    day: string,
    roundOneIds: string[],
    roundTwoIds: string[],
    version: string,
  ): Promise<QuestionSetPair | undefined> {
    const now = new Date().toISOString();
    await this.db
      .insert(dailyQuizzes)
      .values({
        day,
        questionIds: JSON.stringify(roundOneIds),
        questionSetKey: [...roundOneIds].sort().join(','),
        questionSetVersion: version,
        roundTwoQuestionIds: JSON.stringify(roundTwoIds),
        roundTwoQuestionSetKey: [...roundTwoIds].sort().join(','),
        roundTwoQuestionSetVersion: version,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    return this.getDailyQuestionPair(day);
  }

  async assignMissingRoundTwo(day: string, questionIds: string[], version: string): Promise<void> {
    await this.db
      .update(dailyQuizzes)
      .set({
        roundTwoQuestionIds: JSON.stringify(questionIds),
        roundTwoQuestionSetKey: [...questionIds].sort().join(','),
        roundTwoQuestionSetVersion: version,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(dailyQuizzes.day, day), sql`${dailyQuizzes.roundTwoQuestionIds} IS NULL`));
  }

  async getOrCreateRoundSession(day: string, playerId: string, round: QuizRoundNumber) {
    const now = new Date().toISOString();
    await this.db
      .insert(quizRoundSessions)
      .values({ day, playerId, round, startedAt: now, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
    const [session] = await this.db
      .select()
      .from(quizRoundSessions)
      .where(
        and(
          eq(quizRoundSessions.day, day),
          eq(quizRoundSessions.playerId, playerId),
          eq(quizRoundSessions.round, round),
        ),
      )
      .limit(1);
    if (!session) throw new Error('QUIZ_SESSION_UNAVAILABLE');
    return session;
  }

  async getRoundSession(day: string, playerId: string, round: QuizRoundNumber) {
    const [session] = await this.db
      .select()
      .from(quizRoundSessions)
      .where(
        and(
          eq(quizRoundSessions.day, day),
          eq(quizRoundSessions.playerId, playerId),
          eq(quizRoundSessions.round, round),
        ),
      )
      .limit(1);
    return session;
  }

  async openCurrentQuestion(
    day: string,
    playerId: string,
    round: QuizRoundNumber,
    questionIndex: number,
  ) {
    const session = await this.getRoundSession(day, playerId, round);
    if (!session) throw new Error('QUIZ_SESSION_UNAVAILABLE');
    if (session.currentQuestionIndex !== questionIndex || !session.currentQuestionOpenedAt) {
      const now = new Date().toISOString();
      await this.db
        .update(quizRoundSessions)
        .set({
          currentQuestionIndex: questionIndex,
          currentQuestionOpenedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(quizRoundSessions.day, day),
            eq(quizRoundSessions.playerId, playerId),
            eq(quizRoundSessions.round, round),
            eq(quizRoundSessions.currentQuestionIndex, session.currentQuestionIndex),
            ...(session.currentQuestionIndex === questionIndex
              ? [isNull(quizRoundSessions.currentQuestionOpenedAt)]
              : []),
          ),
        );
    }
    const opened = await this.getRoundSession(day, playerId, round);
    if (!opened) throw new Error('QUIZ_SESSION_UNAVAILABLE');
    return opened;
  }

  async getRoundAnswers(
    day: string,
    playerId: string,
    round: QuizRoundNumber,
  ): Promise<StoredQuizAnswer[]> {
    return this.db
      .select()
      .from(quizRoundAnswers)
      .where(
        and(
          eq(quizRoundAnswers.day, day),
          eq(quizRoundAnswers.playerId, playerId),
          eq(quizRoundAnswers.round, round),
        ),
      )
      .orderBy(asc(quizRoundAnswers.questionIndex));
  }

  async reconcileRoundTotals(
    day: string,
    playerId: string,
    round: QuizRoundNumber,
    questionCount: number,
  ): Promise<void> {
    await this.refreshRoundTotals(day, playerId, round, questionCount, false);
  }

  async getIdempotentRoundAnswer(
    day: string,
    playerId: string,
    round: QuizRoundNumber,
    idempotencyKey: string,
  ): Promise<StoredQuizAnswer | undefined> {
    const [row] = await this.db
      .select()
      .from(quizRoundAnswers)
      .where(
        and(
          eq(quizRoundAnswers.day, day),
          eq(quizRoundAnswers.playerId, playerId),
          eq(quizRoundAnswers.round, round),
          eq(quizRoundAnswers.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row;
  }

  async saveRoundAnswer(input: {
    day: string;
    playerId: string;
    round: QuizRoundNumber;
    questionIndex: number;
    questionId: string;
    selectedOptionId: 'a' | 'b' | 'c' | 'd' | null;
    correctOptionId: 'a' | 'b' | 'c' | 'd';
    isCorrect: boolean;
    points: number;
    responseMs: number;
    idempotencyKey: string;
    submittedAt: string;
    questionCount: number;
  }): Promise<boolean> {
    const inserted = await this.db
      .insert(quizRoundAnswers)
      .values(input)
      .onConflictDoNothing()
      .returning({ questionIndex: quizRoundAnswers.questionIndex });
    await this.refreshRoundTotals(input.day, input.playerId, input.round, input.questionCount, true);
    return inserted.length === 1;
  }

  async getCompletedRoundRank(
    day: string,
    playerId: string,
    round: QuizRoundNumber,
  ): Promise<{ rank: number; completedPlayers: number } | undefined> {
    const session = await this.getRoundSession(day, playerId, round);
    if (!session?.completedAt) return undefined;
    const scope = and(
      eq(quizRoundSessions.day, day),
      eq(quizRoundSessions.round, round),
      isNotNull(quizRoundSessions.completedAt),
    );
    const [ahead] = await this.db
      .select({ total: count() })
      .from(quizRoundSessions)
      .where(and(scope, gt(quizRoundSessions.score, session.score)));
    const [total] = await this.db.select({ total: count() }).from(quizRoundSessions).where(scope);
    return { rank: (ahead?.total ?? 0) + 1, completedPlayers: total?.total ?? 0 };
  }

  async getRoundLeaderboard(day: string, round: QuizRoundNumber, limit = 20) {
    return this.db
      .select({
        score: quizRoundSessions.score,
        correctCount: quizRoundSessions.correctCount,
        completedAt: quizRoundSessions.completedAt,
        displayName: players.displayName,
      })
      .from(quizRoundSessions)
      .leftJoin(players, eq(players.id, quizRoundSessions.playerId))
      .where(
        and(
          eq(quizRoundSessions.day, day),
          eq(quizRoundSessions.round, round),
          isNotNull(quizRoundSessions.completedAt),
        ),
      )
      .orderBy(
        desc(quizRoundSessions.score),
        desc(quizRoundSessions.correctCount),
        asc(quizRoundSessions.completedAt),
      )
      .limit(limit);
  }

  async getCombinedPlayerScore(day: string, playerId: string) {
    const [row] = await this.db
      .select({
        score: sql<number>`sum(${quizRoundSessions.score})`,
        correctCount: sql<number>`sum(${quizRoundSessions.correctCount})`,
      })
      .from(quizRoundSessions)
      .where(
        and(
          eq(quizRoundSessions.day, day),
          eq(quizRoundSessions.playerId, playerId),
          isNotNull(quizRoundSessions.completedAt),
        ),
      )
      .groupBy(quizRoundSessions.playerId)
      .having(sql`count(*) = 2`);
    return row;
  }

  async getCombinedPlayerRank(day: string, playerId: string) {
    const score = await this.getCombinedPlayerScore(day, playerId);
    if (!score) return undefined;
    const combinedScores = this.db
      .select({
        playerId: quizRoundSessions.playerId,
        score: sql<number>`sum(${quizRoundSessions.score})`.as('score'),
        correctCount: sql<number>`sum(${quizRoundSessions.correctCount})`.as('correct_count'),
      })
      .from(quizRoundSessions)
      .where(and(eq(quizRoundSessions.day, day), isNotNull(quizRoundSessions.completedAt)))
      .groupBy(quizRoundSessions.playerId)
      .having(sql`count(*) = 2`)
      .as('combined_scores');
    const [ahead] = await this.db
      .select({ total: count() })
      .from(combinedScores)
      .where(gt(combinedScores.score, score.score));
    const [total] = await this.db.select({ total: count() }).from(combinedScores);
    return {
      ...score,
      rank: (ahead?.total ?? 0) + 1,
      completedPlayers: total?.total ?? 0,
    };
  }

  async getCombinedLeaderboard(day: string, limit = 20) {
    const combinedScores = this.db
      .select({
        playerId: quizRoundSessions.playerId,
        score: sql<number>`sum(${quizRoundSessions.score})`.as('score'),
        correctCount: sql<number>`sum(${quizRoundSessions.correctCount})`.as('correct_count'),
        completedAt: sql<string>`max(${quizRoundSessions.completedAt})`.as('completed_at'),
      })
      .from(quizRoundSessions)
      .where(and(eq(quizRoundSessions.day, day), isNotNull(quizRoundSessions.completedAt)))
      .groupBy(quizRoundSessions.playerId)
      .having(sql`count(*) = 2`)
      .as('combined_scores');
    return this.db
      .select({
        score: combinedScores.score,
        correctCount: combinedScores.correctCount,
        completedAt: combinedScores.completedAt,
        displayName: players.displayName,
      })
      .from(combinedScores)
      .leftJoin(players, eq(players.id, combinedScores.playerId))
      .orderBy(
        desc(combinedScores.score),
        desc(combinedScores.correctCount),
        asc(combinedScores.completedAt),
      )
      .limit(limit);
  }

  async getPlayerHistory(playerId: string, limit: number, before?: string) {
    const rows = await this.db
      .select({
        day: quizRoundSessions.day,
        round: quizRoundSessions.round,
        score: quizRoundSessions.score,
        correctCount: quizRoundSessions.correctCount,
        completedAt: quizRoundSessions.completedAt,
      })
      .from(quizRoundSessions)
      .where(
        and(
          eq(quizRoundSessions.playerId, playerId),
          isNotNull(quizRoundSessions.completedAt),
          ...(before ? [lt(quizRoundSessions.day, before)] : []),
        ),
      )
      .orderBy(desc(quizRoundSessions.day), desc(quizRoundSessions.round))
      .limit((limit + 1) * 2);
    const byDay = new Map<
      string,
      { roundsCompleted: number; score: number; correctCount: number; completedAt: string }
    >();
    for (const row of rows) {
      if (!row.completedAt) continue;
      const current = byDay.get(row.day) ?? {
        roundsCompleted: 0,
        score: 0,
        correctCount: 0,
        completedAt: row.completedAt,
      };
      current.roundsCompleted += 1;
      current.score += row.score;
      current.correctCount += row.correctCount;
      if (row.completedAt > current.completedAt) current.completedAt = row.completedAt;
      byDay.set(row.day, current);
    }
    const items = [...byDay.entries()]
      .slice(0, limit + 1)
      .map(([day, summary]) => ({ day, ...summary }));
    const hasMore = items.length > limit;
    const pageItems = items.slice(0, limit);
    return { items: pageItems, nextBefore: hasMore ? (pageItems.at(-1)?.day ?? null) : null };
  }

  async countCompletedPlayers(day: string, round: QuizRoundNumber): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(quizRoundSessions)
      .where(
        and(
          eq(quizRoundSessions.day, day),
          eq(quizRoundSessions.round, round),
          isNotNull(quizRoundSessions.completedAt),
        ),
      );
    return row?.total ?? 0;
  }

  private async refreshRoundTotals(
    day: string,
    playerId: string,
    round: QuizRoundNumber,
    questionCount: number,
    resetQuestionTimer: boolean,
  ): Promise<void> {
    const answers = await this.getRoundAnswers(day, playerId, round);
    const score = answers.reduce((total, answer) => total + answer.points, 0);
    const correctCount = answers.reduce((total, answer) => total + Number(answer.isCorrect), 0);
    const completedAt = answers.length === questionCount ? answers.at(-1)?.submittedAt : null;
    await this.db
      .update(quizRoundSessions)
      .set({
        score,
        correctCount,
        completedAt,
        ...(resetQuestionTimer
          ? { currentQuestionIndex: answers.length, currentQuestionOpenedAt: null }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(quizRoundSessions.day, day),
          eq(quizRoundSessions.playerId, playerId),
          eq(quizRoundSessions.round, round),
        ),
      );
  }
}
