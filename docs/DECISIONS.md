# Decisions

Reviewed 2026-11-02 for the daily trivia MVP. Versions were checked against current npm package pages and Cloudflare documentation on this date. `package.json` pins exact versions.

| ID | Decision | Status |
|---|---|---|
| D1 | Cloudflare D1 with Drizzle ORM is the system of record for daily quiz assignments, answers, scores, and completion. | Confirmed for MVP. |
| D2 | Anonymous player ID in a signed HttpOnly cookie; no email or password. | Confirmed for MVP. |
| D3 | No Durable Objects; D1 uniqueness constraints allow only one answer per player and question. | Confirmed for MVP. |
| D4 | One package; no shared workspace. | Confirmed for MVP. |
| D5 | Each daily challenge has ten four-option questions, seven in English and three in Swahili, shared in the same order. | Confirmed by owner on 2026-11-02. |
| D6 | Correct answers earn 100 points plus a speed bonus that falls by one point per second for 20 seconds. | Confirmed by owner approval of the proposed defaults. The server measures elapsed time. |
| D7 | Equal point totals share the same rank. Only completed challenges appear on the daily board. | Confirmed by owner approval of the proposed defaults. |
| D8 | Server decides the day at midnight Africa/Nairobi (UTC+3, no daylight saving). | Confirmed for MVP. Cloudflare Cron Triggers use UTC; 21:00 UTC maps to midnight at UTC+3. |

## Quiz architecture decisions

| ID | Decision | Reason |
|---|---|---|
| Q1 | The current question bank is a versioned, server-only JSON module. D1 stores a single daily question ID assignment so all players receive the same sequence. | Small MVP without a content-management service. Question IDs referenced by persisted assignments must remain available. |
| Q2 | D1 stores each answer and server-computed points. Unique keys on `(day, player_id, question_index)` and `(day, player_id, idempotency_key)` prevent duplicate scoring. | Retries and concurrent submissions must not increase a player's tally twice. |
| Q3 | The client receives only the current question. Correct choice, explanation, and source are returned after that question is answered. | Avoids exposing future answer keys in the browser. |
| Q4 | The leaderboard ranks only completed sessions by points; equal totals share rank. It returns no player ID or handle. | Preserves anonymous play while making the daily score comparable. |
| Q5 | The new quiz migration is additive. Wordle tables and code are retained as inactive legacy artifacts until their removal is separately reviewed. | Avoid changing already-applied schema or discarding supplied word-list work during the product pivot. |

The sourced starter bank is a draft. A fluent Swahili reviewer and the owner should check translations, distractors, explanations, and sources before production gameplay. See [QUESTIONS.md](QUESTIONS.md).

## Verified core tooling versions

Exact package versions are recorded in `package.json`. The primary version checks were: Hono 4.13.7, `@cloudflare/vite-plugin` 1.66.0, Vite 8.3.5, React 19.3.1, Zod 4.6.7, Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, Wrangler 4.156.1, TypeScript 5.9.3 (the project standard requires the 5.x line), TanStack Query 5.105.1, Vitest 5.0.0, and `@cloudflare/vitest-plugin` 1.4.7. Cloudflare's current testing docs require Vitest 4.1 or later and use `@cloudflare/vitest-plugin`; this replaces the older package name in the task plan. pnpm 10.34.9 was selected from the stable 10.x line to follow the project standard rather than move to a newly released package-manager major.

The package manager is pnpm as required by the project. The current environment has Node 24.15.0; Corepack could not read its default state under sandbox permissions during preflight. Installation and compatibility will be verified once the local toolchain is accessible.

## MVP boundary

The active product is a daily English and Swahili trivia challenge. It includes anonymous identity, D1 persistence, deterministic shared daily question selection, server-side scoring, a playable UI, and a daily completed-player leaderboard. Public handles, accounts, historic challenge archives, and production deployment remain outside this slice. The prior Wordle implementation remains unmounted and is not part of the active app.
