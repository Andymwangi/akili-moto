import { hc } from 'hono/client';
import {
  ApiErrorSchema,
  type PlayerHistory,
  PlayerHistorySchema,
  type PlayerProfile,
  PlayerProfileSchema,
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

export async function getQuiz(round: 1 | 2 = 1): Promise<QuizState> {
  const response = await client.api.quiz.$get({ query: { round: String(round) as '1' | '2' } });
  return parseResponse(response, QuizStateSchema);
}

export async function submitQuizAnswer(
  round: 1 | 2,
  questionId: string,
  selectedOptionId: 'a' | 'b' | 'c' | 'd' | undefined,
  idempotencyKey: string,
): Promise<QuizState> {
  const response = await client.api.quiz.answer.$post({
    json: { round, questionId, ...(selectedOptionId ? { selectedOptionId } : {}) },
    header: { 'idempotency-key': idempotencyKey },
  });
  return parseResponse(response, QuizStateSchema);
}

export async function getQuizLeaderboard(): Promise<QuizLeaderboard> {
  const response = await client.api.quiz.leaderboard.$get();
  return parseResponse(response, QuizLeaderboardSchema);
}

export async function getPlayerProfile(): Promise<PlayerProfile> {
  const response = await client.api.player.$get();
  return parseResponse(response, PlayerProfileSchema);
}

export async function updatePlayerName(displayName: string): Promise<PlayerProfile> {
  const response = await client.api.player.name.$patch({ json: { displayName } });
  return parseResponse(response, PlayerProfileSchema);
}

export async function rotatePlayerRecoveryCode(): Promise<PlayerProfile> {
  const response = await client.api.player['recovery-code'].$post();
  return parseResponse(response, PlayerProfileSchema);
}

export async function recoverPlayer(recoveryCode: string): Promise<PlayerProfile> {
  const response = await client.api.player.recover.$post({ json: { recoveryCode } });
  return parseResponse(response, PlayerProfileSchema);
}

export async function getPlayerHistory(
  input: { limit?: number; before?: string } = {},
): Promise<PlayerHistory> {
  const response = await client.api.player.history.$get({
    query: {
      ...(input.limit ? { limit: String(input.limit) } : {}),
      ...(input.before ? { before: input.before } : {}),
    },
  });
  return parseResponse(response, PlayerHistorySchema);
}
