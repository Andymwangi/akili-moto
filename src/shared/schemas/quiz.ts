import { z } from 'zod';
import { QUIZ_QUESTION_COUNT } from '../constants';

export const ChoiceIdSchema = z.enum(['a', 'b', 'c', 'd']);
export const QuestionLanguageSchema = z.enum(['en', 'sw']);
export const QuestionDifficultySchema = z.enum(['medium', 'challenging', 'hard', 'very_hard']);
export const QuizRoundNumberSchema = z.union([z.literal(1), z.literal(2)]);

export const QuizRoundQuerySchema = z.strictObject({
  round: z
    .enum(['1', '2'])
    .default('1')
    .transform((value) => Number(value) as 1 | 2),
});

export const QuizQuestionSchema = z.strictObject({
  id: z.string().min(1).max(64),
  language: QuestionLanguageSchema,
  difficulty: QuestionDifficultySchema,
  prompt: z.string().min(1).max(500),
  options: z
    .array(
      z.strictObject({
        id: ChoiceIdSchema,
        text: z.string().min(1).max(160),
      }),
    )
    .length(4),
});

export const QuizAnswerBodySchema = z.strictObject({
  round: QuizRoundNumberSchema,
  questionId: z.string().min(1).max(64),
  selectedOptionId: ChoiceIdSchema,
});

export const IdempotencyHeaderSchema = z.object({
  'idempotency-key': z
    .string()
    .min(8)
    .max(100)
    .regex(/^[A-Za-z0-9._~-]+$/),
});

export const QuizAnswerSchema = z.strictObject({
  questionIndex: z
    .number()
    .int()
    .min(0)
    .max(QUIZ_QUESTION_COUNT - 1),
  question: QuizQuestionSchema,
  selectedOptionId: ChoiceIdSchema,
  correctOptionId: ChoiceIdSchema,
  isCorrect: z.boolean(),
  points: z.number().int().min(0).max(120),
  explanation: z.string().min(1).max(500),
  sourceUrl: z.string().url(),
});

export const QuizStateSchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  round: QuizRoundNumberSchema,
  status: z.enum(['in_progress', 'finished']),
  currentIndex: z.number().int().min(0).max(QUIZ_QUESTION_COUNT),
  totalQuestions: z.literal(QUIZ_QUESTION_COUNT),
  score: z
    .number()
    .int()
    .min(0)
    .max(QUIZ_QUESTION_COUNT * 120),
  correctCount: z.number().int().min(0).max(QUIZ_QUESTION_COUNT),
  startedAt: z.string().datetime(),
  currentQuestionOpenedAt: z.string().datetime().optional(),
  currentQuestion: QuizQuestionSchema.optional(),
  answers: z.array(QuizAnswerSchema).max(QUIZ_QUESTION_COUNT),
  rank: z.number().int().positive().optional(),
  completedPlayers: z.number().int().nonnegative().optional(),
});

const LeaderboardItemSchema = z.strictObject({
  position: z.number().int().positive(),
  rank: z.number().int().positive(),
  displayName: z.string().min(1).max(24),
  score: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
});

const RoundLeaderboardSchema = z.strictObject({
  round: QuizRoundNumberSchema,
  totalPlayers: z.number().int().nonnegative(),
  playerRank: z.number().int().positive().nullable(),
  playerScore: z
    .number()
    .int()
    .min(0)
    .max(QUIZ_QUESTION_COUNT * 120)
    .nullable(),
  items: z.array(LeaderboardItemSchema).max(20),
});

export const QuizLeaderboardSchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rounds: z.array(RoundLeaderboardSchema).length(2),
  combined: z.strictObject({
    totalPlayers: z.number().int().nonnegative(),
    playerRank: z.number().int().positive().nullable(),
    playerScore: z
      .number()
      .int()
      .min(0)
      .max(QUIZ_QUESTION_COUNT * 240)
      .nullable(),
    items: z.array(LeaderboardItemSchema).max(20),
  }),
});

export const PlayerProfileSchema = z.strictObject({
  playerId: z.string().uuid(),
  displayName: z.string().min(2).max(24),
  recoveryCode: z
    .string()
    .regex(/^(?:[A-F0-9]{5}-){7}[A-F0-9]{5}$/)
    .optional(),
});

export const UpdatePlayerNameSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/),
});

export const RecoveryCodeSchema = z.strictObject({
  recoveryCode: z
    .string()
    .trim()
    .regex(/^[A-Fa-f0-9]{5}(?:-?[A-Fa-f0-9]{5}){7}$/),
});

export const PlayerHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const PlayerHistorySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        roundsCompleted: z.number().int().min(1).max(2),
        score: z
          .number()
          .int()
          .min(0)
          .max(QUIZ_QUESTION_COUNT * 240),
        correctCount: z
          .number()
          .int()
          .min(0)
          .max(QUIZ_QUESTION_COUNT * 2),
        completedAt: z.string().datetime(),
      }),
    )
    .max(50),
  nextBefore: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizAnswer = z.infer<typeof QuizAnswerSchema>;
export type QuizState = z.infer<typeof QuizStateSchema>;
export type QuizLeaderboard = z.infer<typeof QuizLeaderboardSchema>;
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;
export type PlayerHistory = z.infer<typeof PlayerHistorySchema>;
