import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { type QuizState, QuizStateSchema } from '../src/shared/schemas/quiz';
import worker from '../src/worker';
import { getNairobiDay } from '../src/worker/lib/game/day';
import { correctOptionId, questionById } from '../src/worker/lib/quiz/question-bank';

const testEnv = Object.assign(env, {
  COOKIE_SIGNING_SECRET: 'test-only-signing-secret-is-long-enough-for-zod',
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('CF-Connecting-IP')) {
    headers.set('CF-Connecting-IP', `test-${crypto.randomUUID()}`);
  }
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://localhost${path}`, { ...init, headers }),
    testEnv,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

function cookieFrom(response: Response): string {
  const value = response.headers.get('Set-Cookie');
  if (!value) throw new Error('Expected a player cookie');
  return value.split(';', 1)[0] ?? '';
}

async function getQuiz(cookie?: string): Promise<{ response: Response; state: QuizState }> {
  const response = await request('/api/quiz', {
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
  });
  return { response, state: QuizStateSchema.parse(await response.json()) };
}

async function submitAnswer(
  questionId: string,
  selectedOptionId: string,
  cookie: string,
  idempotencyKey = `answer-${crypto.randomUUID()}`,
): Promise<Response> {
  return request('/api/quiz/answer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      Cookie: cookie,
    },
    body: JSON.stringify({ questionId, selectedOptionId }),
  });
}

async function resetDatabase(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS daily_quizzes (
      day TEXT PRIMARY KEY NOT NULL,
      question_ids TEXT NOT NULL,
      question_set_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    testEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS quiz_sessions (
      day TEXT NOT NULL,
      player_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 1200),
      correct_count INTEGER NOT NULL DEFAULT 0 CHECK(correct_count BETWEEN 0 AND 10),
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(day, player_id)
    )`),
    testEnv.DB.prepare(`CREATE INDEX IF NOT EXISTS quiz_sessions_daily_leaderboard_index
      ON quiz_sessions(day, completed_at, score, correct_count)`),
    testEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS quiz_answers (
      day TEXT NOT NULL,
      player_id TEXT NOT NULL,
      question_index INTEGER NOT NULL CHECK(question_index BETWEEN 0 AND 9),
      question_id TEXT NOT NULL,
      selected_option_id TEXT NOT NULL CHECK(selected_option_id IN ('a', 'b', 'c', 'd')),
      correct_option_id TEXT NOT NULL CHECK(correct_option_id IN ('a', 'b', 'c', 'd')),
      is_correct INTEGER NOT NULL,
      points INTEGER NOT NULL CHECK(points BETWEEN 0 AND 120),
      response_ms INTEGER NOT NULL CHECK(response_ms BETWEEN 0 AND 86400000),
      idempotency_key TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      PRIMARY KEY(day, player_id, question_index)
    )`),
    testEnv.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS quiz_answers_player_day_idempotency_unique
      ON quiz_answers(day, player_id, idempotency_key)`),
    testEnv.DB.prepare(`CREATE INDEX IF NOT EXISTS quiz_answers_player_day_index
      ON quiz_answers(player_id, day)`),
    testEnv.DB.prepare('DELETE FROM quiz_answers'),
    testEnv.DB.prepare('DELETE FROM quiz_sessions'),
    testEnv.DB.prepare('DELETE FROM daily_quizzes'),
  ]);
}

beforeEach(async () => {
  await resetDatabase();
});

describe('daily quiz routes', () => {
  it('creates an anonymous player and sends only the current question', async () => {
    const { response, state } = await getQuiz();
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('Secure');
    expect(response.headers.get('Set-Cookie')).toContain('SameSite=Lax');
    expect(state.currentQuestion).toBeDefined();
    expect(state.currentQuestion).not.toHaveProperty('correctOptionId');
    expect(state.currentQuestion).not.toHaveProperty('explanation');
    expect(state.currentQuestion).not.toHaveProperty('sourceUrl');
    expect(state).not.toHaveProperty('playerId');
  });

  it('gives every player the same daily question in the same order', async () => {
    const first = await getQuiz();
    const firstCookie = cookieFrom(first.response);
    const second = await getQuiz();
    const secondCookie = cookieFrom(second.response);
    const day = getNairobiDay(new Date());
    const assignment = await testEnv.DB.prepare(
      'SELECT question_ids FROM daily_quizzes WHERE day = ?',
    )
      .bind(day)
      .first<{ question_ids: string }>();
    expect(firstCookie).not.toBe(secondCookie);
    expect(first.state.currentQuestion?.id).toBe(second.state.currentQuestion?.id);
    expect(assignment).toBeDefined();
    expect(JSON.parse(assignment?.question_ids ?? '[]')).toHaveLength(10);
  });

  it('rejects invalid payloads before recording an answer', async () => {
    const cookie = cookieFrom((await getQuiz()).response);
    const response = await request('/api/quiz/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ questionId: 'en-red-planet', selectedOptionId: 'z', score: 500 }),
    });
    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM quiz_answers').first<{
      count: number;
    }>();
    expect(response.status).toBe(400);
    expect(count?.count).toBe(0);
  });

  it('rejects an out-of-order question without consuming a turn', async () => {
    const cookie = cookieFrom((await getQuiz()).response);
    const response = await submitAnswer('not-today-question', 'a', cookie);
    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM quiz_answers').first<{
      count: number;
    }>();
    expect(response.status).toBe(409);
    expect(count?.count).toBe(0);
  });

  it('scores on the server and reveals the answer only after submission', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    const questionId = initial.state.currentQuestion?.id;
    if (!questionId) throw new Error('Current question is missing');
    const entry = questionById(questionId);
    if (!entry) throw new Error('Question bank entry is missing');
    const correctId = correctOptionId(entry, initial.state.day);
    const response = await submitAnswer(questionId, correctId, cookie);
    const state = QuizStateSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(state.answers).toHaveLength(1);
    expect(state.answers[0]?.isCorrect).toBe(true);
    expect(state.answers[0]?.correctOptionId).toBe(correctId);
    expect(state.answers[0]?.points).toBeGreaterThanOrEqual(100);
    expect(state.currentQuestion?.id).not.toBe(questionId);
  });

  it('replays idempotent answers and rejects a changed replay', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    const questionId = initial.state.currentQuestion?.id;
    if (!questionId) throw new Error('Current question is missing');
    const key = 'stable-answer-key-001';
    const first = await submitAnswer(questionId, 'a', cookie, key);
    const replay = await submitAnswer(questionId, 'a', cookie, key);
    const changed = await submitAnswer(questionId, 'b', cookie, key);
    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM quiz_answers').first<{
      count: number;
    }>();
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(changed.status).toBe(409);
    expect(count?.count).toBe(1);
  });

  it('stores only one answer for concurrent duplicate submissions', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    const questionId = initial.state.currentQuestion?.id;
    if (!questionId) throw new Error('Current question is missing');
    const responses = await Promise.all([
      submitAnswer(questionId, 'a', cookie, 'concurrent-answer-001'),
      submitAnswer(questionId, 'a', cookie, 'concurrent-answer-002'),
    ]);
    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM quiz_answers').first<{
      count: number;
    }>();
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(count?.count).toBe(1);
  });

  it('keeps player answers private and gives tampered cookies a new identity', async () => {
    const first = await getQuiz();
    const firstCookie = cookieFrom(first.response);
    const questionId = first.state.currentQuestion?.id;
    if (!questionId) throw new Error('Current question is missing');
    await submitAnswer(questionId, 'a', firstCookie);
    const second = await getQuiz();
    expect(second.state.answers).toHaveLength(0);
    const lastCharacter = firstCookie.at(-1);
    const tampered = `${firstCookie.slice(0, -1)}${lastCharacter === 'x' ? 'y' : 'x'}`;
    const replacement = await request('/api/quiz', { headers: { Cookie: tampered } });
    expect(cookieFrom(replacement)).not.toBe(firstCookie);
  });

  it('finishes after ten questions and ranks only completed players', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    let state = initial.state;
    while (state.status !== 'finished') {
      const question = state.currentQuestion;
      if (!question) throw new Error('Question is missing before the quiz is finished');
      const entry = questionById(question.id);
      if (!entry) throw new Error('Question bank entry is missing');
      const response = await submitAnswer(question.id, correctOptionId(entry, state.day), cookie);
      expect(response.status).toBe(200);
      state = QuizStateSchema.parse(await response.json());
    }
    const leaderboardResponse = await request('/api/quiz/leaderboard', {
      headers: { Cookie: cookie },
    });
    const leaderboard: unknown = await leaderboardResponse.json();
    expect(leaderboardResponse.status).toBe(200);
    expect(state.answers).toHaveLength(10);
    expect(state.correctCount).toBe(10);
    expect(state.rank).toBe(1);
    expect(state.completedPlayers).toBe(1);
    expect(leaderboard).not.toHaveProperty('playerId');
    expect(leaderboard).not.toHaveProperty('answers');

    const anotherPlayer = await request('/api/quiz/leaderboard');
    const anotherBody: unknown = await anotherPlayer.json();
    expect(anotherBody).toMatchObject({ playerRank: null, totalPlayers: 1 });
  });

  it('does not expose the retired Wordle endpoint', async () => {
    const response = await request('/api/game');
    expect(response.status).toBe(401);
  });
});
