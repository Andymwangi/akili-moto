import { hc } from 'hono/client';
import {
  ApiErrorSchema,
  type QuizLeaderboard,
  QuizLeaderboardSchema,
  type QuizState,
  QuizStateSchema,
} from '../shared/schemas/quiz';
import type { AppType } from '../worker';

export class ApiClientError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly status: number;

  constructor(message: string, code: string, requestId: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}

const client = hc<AppType>(window.location.origin);

async function parseResponse<T>(
  response: {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  },
  schema: { parse(value: unknown): T },
): Promise<T> {
  if (!response.ok) {
    const result = ApiErrorSchema.safeParse(await response.json());
    if (result.success) {
      throw new ApiClientError(
        result.data.error.message,
        result.data.error.code,
        result.data.error.requestId,
        response.status,
      );
    }
    throw new ApiClientError(
      'The request failed.',
      'unknown_error',
      'unavailable',
      response.status,
    );
  }
  return schema.parse(await response.json());
}

export async function getQuiz(): Promise<QuizState> {
  const response = await client.api.quiz.$get();
  return parseResponse(response, QuizStateSchema);
}

export async function submitQuizAnswer(
  questionId: string,
  selectedOptionId: 'a' | 'b' | 'c' | 'd',
  idempotencyKey: string,
): Promise<QuizState> {
  const response = await client.api.quiz.answer.$post({
    json: { questionId, selectedOptionId },
    header: { 'idempotency-key': idempotencyKey },
  });
  return parseResponse(response, QuizStateSchema);
}

export async function getQuizLeaderboard(): Promise<QuizLeaderboard> {
  const response = await client.api.quiz.leaderboard.$get();
  return parseResponse(response, QuizLeaderboardSchema);
}
