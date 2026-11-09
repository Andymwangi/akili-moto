import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { type QuizState, QuizStateSchema } from '../src/shared/schemas/quiz';
import worker from '../src/worker';
import { QuizRepository } from '../src/worker/db/queries/quiz-repository';
import { getNairobiDay } from '../src/worker/lib/game/day';
import { ensureDailyQuiz } from '../src/worker/lib/quiz/daily-quiz';
import {
  bonusQuestionIndex,
  correctOptionId,
  questionById,
  selectDailyQuestionPair,
} from '../src/worker/lib/quiz/question-bank';

const testEnv = Object.assign(env, {
  COOKIE_SIGNING_SECRET: 'test-only-signing-secret-is-long-enough-for-zod',
});

async function request(
  path: string,
  init: RequestInit = {},
  includeBrowserOrigin = true,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (
    includeBrowserOrigin &&
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes((init.method ?? 'GET').toUpperCase()) &&
    !headers.has('Origin')
  ) {
    headers.set('Origin', 'http://localhost:5173');
  }
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

async function getQuiz(
  cookie?: string,
  round: 1 | 2 = 1,
): Promise<{ response: Response; state: QuizState }> {
  const response = await request(`/api/quiz?round=${round}`, {
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
  });
  return { response, state: QuizStateSchema.parse(await response.json()) };
}

async function submitAnswer(
  questionId: string,
  selectedOptionId: string,
  cookie: string,
  idempotencyKey = `answer-${crypto.randomUUID()}`,
  round: 1 | 2 = 1,
): Promise<Response> {
  return request('/api/quiz/answer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      Cookie: cookie,
    },
    body: JSON.stringify({ round, questionId, selectedOptionId }),
  });
}

// Changing the first signature character always changes the decoded bytes. The last
// base64url character carries padding bits, so editing it can leave the signature valid.
function tamperCookie(cookie: string): string {
  const signatureStart = cookie.lastIndexOf('.') + 1;
  const first = cookie[signatureStart];
  return `${cookie.slice(0, signatureStart)}${first === 'A' ? 'B' : 'A'}${cookie.slice(signatureStart + 1)}`;
}

async function postAnswer(
  cookie: string,
  body: Record<string, unknown>,
  idempotencyKey = `answer-${crypto.randomUUID()}`,
): Promise<Response> {
  return request('/api/quiz/answer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

/** Opens the current question the way the client does (GET), then answers it correctly. */
async function answerCurrentCorrectly(
  cookie: string,
  round: 1 | 2 = 1,
): Promise<{ opened: QuizState; answered: QuizState; response: Response }> {
  const opened = (await getQuiz(cookie, round)).state;
  const question = opened.currentQuestion;
  if (!question) throw new Error('Current question is missing');
  const entry = questionById(question.id);
  if (!entry) throw new Error('Question bank entry is missing');
  const response = await submitAnswer(
    question.id,
    correctOptionId(entry, opened.day),
    cookie,
    `answer-${crypto.randomUUID()}`,
    round,
  );
  const answered = QuizStateSchema.parse(await response.clone().json());
  return { opened, answered, response };
}

async function backdateCurrentQuestion(cookie: string, millisecondsAgo: number): Promise<void> {
  const playerId = cookie.split('=')[1]?.split('.')[0];
  await testEnv.DB.prepare(
    'UPDATE quiz_round_sessions SET current_question_opened_at = ? WHERE player_id = ?',
  )
    .bind(new Date(Date.now() - millisecondsAgo).toISOString(), playerId)
    .run();
}

async function resetDatabase(): Promise<void> {
  await testEnv.DB.batch(
    [
      'quiz_round_answers',
      'quiz_round_sessions',
      'quiz_answers',
      'quiz_sessions',
      'daily_quizzes',
      'players',
      'player_recovery_rate_limits',
    ].map((table) => testEnv.DB.prepare(`DELETE FROM ${table}`)),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

describe('daily quiz routes', () => {
  it('creates a unique recoverable identity and restores it in another browser', async () => {
    const firstResponse = await request('/api/player');
    const firstProfile = (await firstResponse.json()) as {
      playerId: string;
      displayName: string;
      recoveryCode: string;
    };
    const firstCookie = cookieFrom(firstResponse);
    const secondResponse = await request('/api/player');
    const secondProfile = (await secondResponse.json()) as { playerId: string };
    expect(firstResponse.status).toBe(200);
    expect(firstProfile.playerId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstProfile.recoveryCode).toMatch(/^(?:[A-F0-9]{5}-){7}[A-F0-9]{5}$/);
    expect(secondProfile.playerId).not.toBe(firstProfile.playerId);

    const recovered = await request('/api/player/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFrom(secondResponse) },
      body: JSON.stringify({ recoveryCode: firstProfile.recoveryCode }),
    });
    const recoveredProfile = (await recovered.json()) as { playerId: string };
    expect(recovered.status).toBe(200);
    expect(recoveredProfile.playerId).toBe(firstProfile.playerId);
    expect(cookieFrom(recovered).split('=')[1]?.split('.')[0]).toBe(
      firstCookie.split('=')[1]?.split('.')[0],
    );
    const stored = await testEnv.DB.prepare('SELECT recovery_code_hash FROM players WHERE id = ?')
      .bind(firstProfile.playerId)
      .first<{ recovery_code_hash: string }>();
    expect(stored?.recovery_code_hash).not.toBe(firstProfile.recoveryCode);
  });

  it('returns recovery codes only on creation or rotation and invalidates the previous code', async () => {
    const initial = await request('/api/player');
    const cookie = cookieFrom(initial);
    const original = (await initial.json()) as { recoveryCode: string };
    const nextProfile = await request('/api/player', { headers: { Cookie: cookie } });
    expect(nextProfile.status).toBe(200);
    expect(nextProfile.headers.get('Set-Cookie')).toBeNull();
    expect(((await nextProfile.json()) as { recoveryCode?: string }).recoveryCode).toBeUndefined();

    const rotated = await request('/api/player/recovery-code', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const next = (await rotated.json()) as { recoveryCode: string };
    const rejected = await request('/api/player/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryCode: original.recoveryCode }),
    });
    const accepted = await request('/api/player/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryCode: next.recoveryCode }),
    });
    expect(rotated.status).toBe(200);
    expect(rejected.status).toBe(404);
    expect(accepted.status).toBe(200);
  });

  it('validates and updates unique display names', async () => {
    const firstCookie = cookieFrom(await request('/api/player'));
    const secondCookie = cookieFrom(await request('/api/player'));
    const first = await request('/api/player/name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: firstCookie },
      body: JSON.stringify({ displayName: 'Ada Lovelace' }),
    });
    const conflict = await request('/api/player/name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: secondCookie },
      body: JSON.stringify({ displayName: 'ada lovelace' }),
    });
    const invalid = await request('/api/player/name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: firstCookie },
      body: JSON.stringify({ displayName: 'x'.repeat(40) }),
    });
    expect(first.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(invalid.status).toBe(400);

    const thirdCookie = cookieFrom(await request('/api/player'));
    const fourthCookie = cookieFrom(await request('/api/player'));
    const concurrent = await Promise.all(
      [thirdCookie, fourthCookie].map((cookie) =>
        request('/api/player/name', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ displayName: 'Concurrent Name' }),
        }),
      ),
    );
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('returns only the signed-in player completed history', async () => {
    const profileResponse = await request('/api/player');
    const profile = (await profileResponse.json()) as { playerId: string };
    const cookie = cookieFrom(profileResponse);
    const otherResponse = await request('/api/player');
    const otherProfile = (await otherResponse.json()) as { playerId: string };
    const now = new Date().toISOString();
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO quiz_round_sessions
        (day, player_id, round_no, started_at, score, correct_count, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        '2026-11-01',
        profile.playerId,
        1,
        now,
        800,
        8,
        now,
        now,
        now,
      ),
      testEnv.DB.prepare(`INSERT INTO quiz_round_sessions
        (day, player_id, round_no, started_at, score, correct_count, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        '2026-11-01',
        otherProfile.playerId,
        1,
        now,
        1200,
        10,
        now,
        now,
        now,
      ),
    ]);
    const response = await request('/api/player/history?limit=10', { headers: { Cookie: cookie } });
    const history = (await response.json()) as { items: { day: string; score: number }[] };
    const tampered = await request('/api/player/history', {
      headers: { Cookie: tamperCookie(cookie) },
    });
    const privateHistory = (await tampered.json()) as { items: unknown[] };
    const invalid = await request('/api/player/history?limit=1000', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(history.items).toEqual([
      { day: '2026-11-01', roundsCompleted: 1, score: 800, correctCount: 8, completedAt: now },
    ]);
    expect(privateHistory.items).toEqual([]);
    expect(invalid.status).toBe(400);
  });

  it('assigns different shared question sets to each day and one set under concurrent requests', async () => {
    const repository = new QuizRepository(testEnv.DB);
    const dayOne = await ensureDailyQuiz(repository, '2027-01-01');
    const dayTwo = await ensureDailyQuiz(repository, '2027-01-02');
    expect([...dayOne].sort().join(',')).not.toBe([...dayTwo].sort().join(','));

    const contestedPair = selectDailyQuestionPair('fixed-contested-set');
    await repository.assignDailyQuestionPair(
      '2027-01-03',
      contestedPair[0],
      contestedPair[1],
      'v4',
    );
    const rejectedReuse = await repository.assignDailyQuestionPair(
      '2027-01-04',
      contestedPair[0],
      contestedPair[1],
      'v4',
    );
    expect(rejectedReuse).toBeUndefined();
    const freshReplacement = await ensureDailyQuiz(repository, '2027-01-04');
    expect([...freshReplacement].sort().join(',')).not.toBe([...contestedPair[0]].sort().join(','));

    const sameDay = await Promise.all([
      ensureDailyQuiz(repository, '2027-01-05'),
      ensureDailyQuiz(repository, '2027-01-05'),
    ]);
    expect(sameDay[0]).toEqual(sameDay[1]);
    const uniqueKeys = await testEnv.DB.prepare(
      `SELECT COUNT(DISTINCT question_set_key) + COUNT(DISTINCT round_two_question_set_key) AS total FROM daily_quizzes`,
    ).first<{ total: number }>();
    expect(uniqueKeys?.total).toBe(10);
  });

  it('allows the display-name PATCH method through the configured CORS policy', async () => {
    const response = await request('/api/player/name', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
  });

  it('rejects mutating requests without the allowed browser origin', async () => {
    const missing = await request(
      '/api/player/recover',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryCode: 'A'.repeat(40) }),
      },
      false,
    );
    const foreign = await request('/api/player/recover', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.invalid',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recoveryCode: 'A'.repeat(40) }),
    });
    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
  });

  it('limits repeated recovery attempts by client address', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        request('/api/player/recover', {
          method: 'POST',
          headers: {
            'CF-Connecting-IP': '192.0.2.19',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recoveryCode: `${String(index).padStart(5, '0')}${'A'.repeat(35)}`,
          }),
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      404, 404, 404, 404, 404, 429,
    ]);
    expect(responses.find((response) => response.status === 429)?.headers.get('Retry-After')).toBe(
      '900',
    );
    await testEnv.DB.prepare(
      'UPDATE player_recovery_rate_limits SET window_started_at = ? WHERE hit_count > 0',
    )
      .bind(Math.floor(Date.now() / 1000) - 901)
      .run();
    const afterWindow = await request('/api/player/recover', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '192.0.2.19',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recoveryCode: `${'B'.repeat(40)}` }),
    });
    expect(afterWindow.status).toBe(404);
  });

  it('allows same-origin development writes when Vite selects a fallback port', async () => {
    const profileResponse = await request('/api/player');
    const response = await request('/api/player/name', {
      method: 'PATCH',
      headers: {
        Origin: 'http://localhost',
        Cookie: cookieFrom(profileResponse),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'Local Player' }),
    });
    expect(response.status).toBe(200);
  });

  it('creates an anonymous player and sends only the current question', async () => {
    const { response, state } = await getQuiz();
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('Secure');
    expect(response.headers.get('Set-Cookie')).toContain('SameSite=Lax');
    expect(state.currentQuestion).toBeDefined();
    expect(state.currentQuestion?.difficulty).toBe('medium');
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
    expect(JSON.parse(assignment?.question_ids ?? '[]')).toHaveLength(15);
  });

  it('resumes a persisted v1 assignment using the compatibility question bank', async () => {
    const day = getNairobiDay(new Date());
    const legacyIds = [
      'en-red-planet',
      'en-water-formula',
      'en-earth-satellite',
      'en-largest-animal',
      'en-heart-chambers',
      'en-nearest-star',
      'en-african-un-members',
      'en-plant-gas',
      'en-jupiter-day',
      'en-saturn-rings',
    ];
    await testEnv.DB.prepare(
      'INSERT INTO daily_quizzes (day, question_ids, question_set_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        day,
        JSON.stringify(legacyIds),
        'v1',
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();

    const { response, state } = await getQuiz();
    expect(response.status).toBe(200);
    expect(state.currentQuestion?.id).toBe('en-red-planet');
    expect(state.currentQuestion?.difficulty).toBe('medium');
    expect(state.currentQuestion).not.toHaveProperty('correctOptionIndex');
  });

  it('rejects invalid payloads before recording an answer', async () => {
    const cookie = cookieFrom((await getQuiz()).response);
    const response = await request('/api/quiz/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ questionId: 'en-red-planet', selectedOptionId: 'z', score: 500 }),
    });
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM quiz_round_answers',
    ).first<{
      count: number;
    }>();
    expect(response.status).toBe(400);
    expect(count?.count).toBe(0);
  });

  it('rejects an out-of-order question without consuming a turn', async () => {
    const cookie = cookieFrom((await getQuiz()).response);
    const response = await submitAnswer('not-today-question', 'a', cookie);
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM quiz_round_answers',
    ).first<{
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
    // The next question is only revealed by GET, which also starts its timer.
    expect(state.currentQuestion).toBeUndefined();
    expect(state.currentQuestionOpenedAt).toBeUndefined();
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
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM quiz_round_answers',
    ).first<{
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
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM quiz_round_answers',
    ).first<{
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
    const replacement = await request('/api/quiz', {
      headers: { Cookie: tamperCookie(firstCookie) },
    });
    expect(cookieFrom(replacement)).not.toBe(firstCookie);
  });

  it('finishes after fifteen questions and ranks only completed players', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    const thirdRound = await request('/api/quiz?round=3', { headers: { Cookie: cookie } });
    expect(thirdRound.status).toBe(400);
    const lockedRound = await request('/api/quiz?round=2', { headers: { Cookie: cookie } });
    expect(lockedRound.status).toBe(409);
    expect(
      await testEnv.DB.prepare(
        'SELECT COUNT(*) AS count FROM quiz_round_sessions WHERE round_no = 2',
      ).first<{ count: number }>(),
    ).toMatchObject({ count: 0 });
    let state = initial.state;
    while (state.status !== 'finished') {
      const step = await answerCurrentCorrectly(cookie, 1);
      expect(step.response.status).toBe(200);
      state = step.answered;
    }
    const leaderboardResponse = await request('/api/quiz/leaderboard', {
      headers: { Cookie: cookie },
    });
    const leaderboard: unknown = await leaderboardResponse.json();
    expect(leaderboardResponse.status).toBe(200);
    expect(state.answers).toHaveLength(15);
    expect(state.correctCount).toBe(15);
    expect(state.rank).toBe(1);
    expect(state.completedPlayers).toBe(1);
    const secondRoundStart = await getQuiz(cookie, 2);
    expect(secondRoundStart.state.round).toBe(2);
    const pair = await testEnv.DB.prepare(
      'SELECT question_ids, round_two_question_ids FROM daily_quizzes WHERE day = ?',
    )
      .bind(state.day)
      .first<{ question_ids: string; round_two_question_ids: string }>();
    const firstIds = JSON.parse(pair?.question_ids ?? '[]') as string[];
    const secondIds = JSON.parse(pair?.round_two_question_ids ?? '[]') as string[];
    expect(secondIds).toHaveLength(15);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    let secondState = secondRoundStart.state;
    while (secondState.status !== 'finished') {
      const step = await answerCurrentCorrectly(cookie, 2);
      expect(step.response.status).toBe(200);
      secondState = step.answered;
    }
    expect(leaderboard).not.toHaveProperty('playerId');
    expect(leaderboard).not.toHaveProperty('answers');
    const finalLeaderboardResponse = await request('/api/quiz/leaderboard', {
      headers: { Cookie: cookie },
    });
    const finalLeaderboard = await finalLeaderboardResponse.json();
    expect(finalLeaderboard).toMatchObject({
      rounds: [
        { round: 1, totalPlayers: 1, playerRank: 1 },
        { round: 2, totalPlayers: 1, playerRank: 1 },
      ],
      combined: {
        totalPlayers: 1,
        playerRank: 1,
        playerScore: state.score + secondState.score,
      },
    });
    const historyResponse = await request('/api/player/history?limit=1', {
      headers: { Cookie: cookie },
    });
    const history = await historyResponse.json();
    expect(history).toMatchObject({
      items: [
        {
          day: state.day,
          roundsCompleted: 2,
          score: state.score + secondState.score,
          correctCount: 30,
        },
      ],
    });

    const anotherPlayer = await request('/api/quiz/leaderboard');
    const anotherBody: unknown = await anotherPlayer.json();
    expect(anotherBody).toMatchObject({
      rounds: [
        { round: 1, playerRank: null, totalPlayers: 1 },
        { round: 2, playerRank: null, totalPlayers: 1 },
      ],
      combined: { totalPlayers: 0, playerRank: null },
    });
  });

  it('rejects an answer to a question that was never opened by GET', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    await answerCurrentCorrectly(cookie);
    const assignment = await testEnv.DB.prepare(
      'SELECT question_ids FROM daily_quizzes WHERE day = ?',
    )
      .bind(initial.state.day)
      .first<{ question_ids: string }>();
    const nextId = (JSON.parse(assignment?.question_ids ?? '[]') as string[])[1];
    if (!nextId) throw new Error('Second question is missing');
    const entry = questionById(nextId);
    if (!entry) throw new Error('Question bank entry is missing');
    const blind = await submitAnswer(nextId, correctOptionId(entry, initial.state.day), cookie);
    const body = (await blind.json()) as { error: { code: string } };
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM quiz_round_answers',
    ).first<{ count: number }>();
    expect(blind.status).toBe(409);
    expect(body.error.code).toBe('question_not_opened');
    expect(count?.count).toBe(1);
  });

  it('keeps the question timer running across refreshes', async () => {
    const first = await getQuiz();
    const cookie = cookieFrom(first.response);
    const again = await getQuiz(cookie);
    expect(first.state.currentQuestionOpenedAt).toBeDefined();
    expect(again.state.currentQuestionOpenedAt).toBe(first.state.currentQuestionOpenedAt);
    await backdateCurrentQuestion(cookie, 20_000);
    const later = await getQuiz(cookie);
    expect(later.state.currentQuestionTimeRemainingMs).toBeLessThanOrEqual(10_000);
    expect(later.state.currentQuestionTimeRemainingMs).toBeGreaterThan(8_000);
  });

  it('rejects an early timeout and records a real timeout as zero points', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    const questionId = initial.state.currentQuestion?.id;
    if (!questionId) throw new Error('Current question is missing');
    const early = await postAnswer(cookie, { round: 1, questionId });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe(
      'answer_too_early',
    );

    await backdateCurrentQuestion(cookie, 31_000);
    const timedOut = await postAnswer(cookie, { round: 1, questionId });
    const state = QuizStateSchema.parse(await timedOut.json());
    expect(timedOut.status).toBe(200);
    expect(state.answers[0]).toMatchObject({ selectedOptionId: null, isCorrect: false, points: 0 });
  });

  it('counts a correct answer in the grace window at the minimum and drops later ones', async () => {
    const graceCookie = cookieFrom((await getQuiz()).response);
    await backdateCurrentQuestion(graceCookie, 30_500);
    const graceState = (await getQuiz(graceCookie)).state;
    const question = graceState.currentQuestion;
    if (!question) throw new Error('Current question is missing');
    const entry = questionById(question.id);
    if (!entry) throw new Error('Question bank entry is missing');
    const correctId = correctOptionId(entry, graceState.day);
    const inGrace = QuizStateSchema.parse(
      await (await submitAnswer(question.id, correctId, graceCookie)).json(),
    );
    const bonus = graceState.bonusQuestionIndex === 0 ? 2 : 1;
    expect(inGrace.answers[0]).toMatchObject({ isCorrect: true, points: 100 * bonus });

    const lateCookie = cookieFrom((await getQuiz()).response);
    await backdateCurrentQuestion(lateCookie, 40_000);
    const late = QuizStateSchema.parse(
      await (await submitAnswer(question.id, correctId, lateCookie)).json(),
    );
    expect(late.answers[0]).toMatchObject({ selectedOptionId: null, isCorrect: false, points: 0 });
  });

  it('replays a late answer that was stored as a timeout instead of reporting a conflict', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    const questionId = initial.state.currentQuestion?.id;
    if (!questionId) throw new Error('Current question is missing');
    await backdateCurrentQuestion(cookie, 40_000);
    const first = await submitAnswer(questionId, 'a', cookie, 'late-answer-key-01');
    const replay = await submitAnswer(questionId, 'a', cookie, 'late-answer-key-01');
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
  });

  it('doubles the points of the shared bonus question', async () => {
    const initial = await getQuiz();
    const cookie = cookieFrom(initial.response);
    const bonusIndex = initial.state.bonusQuestionIndex;
    if (bonusIndex === undefined) throw new Error('Bonus question index is missing');
    const ids = JSON.parse(
      (
        await testEnv.DB.prepare('SELECT question_ids FROM daily_quizzes WHERE day = ?')
          .bind(initial.state.day)
          .first<{ question_ids: string }>()
      )?.question_ids ?? '[]',
    ) as string[];
    expect(bonusQuestionIndex(initial.state.day, 1, ids)).toBe(bonusIndex);
    const otherPlayer = await getQuiz();
    expect(otherPlayer.state.bonusQuestionIndex).toBe(bonusIndex);

    let state = initial.state;
    for (let index = 0; index <= bonusIndex; index += 1) {
      state = (await answerCurrentCorrectly(cookie)).answered;
    }
    const bonusAnswer = state.answers[bonusIndex];
    const regularAnswer = state.answers.find((answer) => answer.questionIndex !== bonusIndex);
    expect(bonusAnswer?.points).toBeGreaterThan(300);
    expect(bonusAnswer?.points).toBeLessThanOrEqual(400);
    if (regularAnswer) expect(regularAnswer.points).toBeLessThanOrEqual(200);
  });

  it('does not expose the retired Wordle endpoint', async () => {
    const response = await request('/api/game');
    expect(response.status).toBe(401);
  });
});
