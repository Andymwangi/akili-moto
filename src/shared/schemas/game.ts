import { z } from 'zod';
import { MAX_ATTEMPTS, WORD_LENGTH } from '../constants';

export const LetterFeedbackSchema = z.enum(['correct', 'present', 'absent']);

export const GuessSchema = z
  .string()
  .max(100)
  .transform((guess) => guess.normalize('NFC').trim().toLocaleLowerCase('en'))
  .pipe(
    z
      .string()
      .length(WORD_LENGTH)
      .regex(/^[a-z]+$/),
  );

export const GuessBodySchema = z.strictObject({
  guess: GuessSchema,
});

export const IdempotencyHeaderSchema = z.object({
  'idempotency-key': z
    .string()
    .min(8)
    .max(100)
    .regex(/^[A-Za-z0-9._~-]+$/),
});

export const AttemptSchema = z.strictObject({
  guess: z
    .string()
    .length(WORD_LENGTH)
    .regex(/^[a-z]{5}$/),
  feedback: z.array(LetterFeedbackSchema).length(WORD_LENGTH),
});

export const GameStateSchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attempts: z.array(AttemptSchema).max(MAX_ATTEMPTS),
  maxAttempts: z.literal(MAX_ATTEMPTS),
  status: z.enum(['in_progress', 'won', 'lost']),
  answer: z
    .string()
    .length(WORD_LENGTH)
    .regex(/^[a-z]{5}$/)
    .optional(),
});

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

export type GameState = z.infer<typeof GameStateSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
