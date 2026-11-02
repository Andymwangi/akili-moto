import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const answerPool = sqliteTable('answer_pool', {
  word: text('word').primaryKey(),
});

export const allowedGuesses = sqliteTable('allowed_guesses', {
  word: text('word').primaryKey(),
});

export const dailyAnswers = sqliteTable(
  'daily_answers',
  {
    day: text('day').primaryKey(),
    word: text('word')
      .notNull()
      .references(() => answerPool.word),
  },
  (table) => [uniqueIndex('daily_answers_word_unique').on(table.word)],
);

export const guesses = sqliteTable(
  'guesses',
  {
    day: text('day').notNull(),
    playerId: text('player_id').notNull(),
    attemptNumber: integer('attempt_no').notNull(),
    guess: text('guess').notNull(),
    feedback: text('feedback').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.playerId, table.attemptNumber] }),
    check('guesses_attempt_no_range', sql`${table.attemptNumber} BETWEEN 1 AND 6`),
    uniqueIndex('guesses_player_day_idempotency_unique').on(
      table.day,
      table.playerId,
      table.idempotencyKey,
    ),
    index('guesses_player_day_index').on(table.playerId, table.day),
  ],
);

export const dailyQuizzes = sqliteTable('daily_quizzes', {
  day: text('day').primaryKey(),
  questionIds: text('question_ids').notNull(),
  questionSetVersion: text('question_set_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const quizSessions = sqliteTable(
  'quiz_sessions',
  {
    day: text('day').notNull(),
    playerId: text('player_id').notNull(),
    startedAt: text('started_at').notNull(),
    score: integer('score').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.playerId] }),
    check('quiz_sessions_score_range', sql`${table.score} BETWEEN 0 AND 1200`),
    check('quiz_sessions_correct_range', sql`${table.correctCount} BETWEEN 0 AND 10`),
    index('quiz_sessions_daily_leaderboard_index').on(
      table.day,
      table.completedAt,
      table.score,
      table.correctCount,
    ),
  ],
);

export const quizAnswers = sqliteTable(
  'quiz_answers',
  {
    day: text('day').notNull(),
    playerId: text('player_id').notNull(),
    questionIndex: integer('question_index').notNull(),
    questionId: text('question_id').notNull(),
    selectedOptionId: text('selected_option_id').notNull(),
    correctOptionId: text('correct_option_id').notNull(),
    isCorrect: integer('is_correct', { mode: 'boolean' }).notNull(),
    points: integer('points').notNull(),
    responseMs: integer('response_ms').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    submittedAt: text('submitted_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.playerId, table.questionIndex] }),
    check('quiz_answers_question_index_range', sql`${table.questionIndex} BETWEEN 0 AND 9`),
    check('quiz_answers_option_id_range', sql`${table.selectedOptionId} IN ('a', 'b', 'c', 'd')`),
    check(
      'quiz_answers_correct_option_id_range',
      sql`${table.correctOptionId} IN ('a', 'b', 'c', 'd')`,
    ),
    check('quiz_answers_points_range', sql`${table.points} BETWEEN 0 AND 120`),
    check('quiz_answers_response_ms_range', sql`${table.responseMs} BETWEEN 0 AND 86400000`),
    uniqueIndex('quiz_answers_player_day_idempotency_unique').on(
      table.day,
      table.playerId,
      table.idempotencyKey,
    ),
    index('quiz_answers_player_day_index').on(table.playerId, table.day),
  ],
);
