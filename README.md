# Akili Moto

Akili Moto is a mobile-first daily trivia challenge. Everyone gets the same two rounds of fifteen multiple-choice questions in the same order each Nairobi day: each round has eleven English and four Swahili questions, progressing from medium through challenging to hard. Round two unlocks after round one is complete. Correct answers earn a 2× to 1× speed multiplier over 30 seconds, one bonus question per round doubles its points, and expired answers score zero. Players see separate round rankings and a combined ranking if they finish both rounds.

## MVP scope

The playable MVP includes two daily shared question sets, recoverable anonymous player identity, editable unique player names, private completed-game history, server-side scoring, answer explanations and sources, D1 persistence, per-round leaderboards, and a combined leaderboard. Email accounts, weekly leagues, historic challenge replay, Sheng mode, ads, payments, and production deployment are outside this milestone.

The active question bank contains 139 sourced draft questions across 15 topic areas. Each round has six medium, seven challenging, and two hard questions, with eleven English and four Swahili questions. Questions used on the previous three days are avoided. Round assignments have no questions in common. Swahili wording, distractors, and all question sourcing still need review before public gameplay. The old Swahili word candidates remain in `data/` for possible future use but are not used by Akili Moto.

## Scoring

- A correct answer scores up to 200 points immediately, then declines to 100 points across 30 seconds.
- The timer starts when the server reveals the question and survives page refreshes. Answers that arrive within 1.5 seconds after the deadline (slow networks) score 100; later answers score zero.
- One question per round, the same for every player that day, is a bonus question marked before answering. It doubles that question's points (up to 400).
- The server records answer time and computes all points. The browser never submits a score.
- The leaderboard ranks completed games by points. Equal scores share a rank.
- A player may complete at most two rounds per Nairobi day. Round two opens only after round one is complete. The combined leaderboard includes players who completed both rounds and sums their points.
- Each player can use a recovery code to restore their player ID and history on another browser. The code is shown only at creation or rotation and is stored as a hash on the server.
- A daily question set is shared by all players and is never assigned again. If the server cannot find a fresh set, it fails closed instead of repeating one.
- Correct answers and explanations are returned only after that question is answered.

## Stack

- Cloudflare Workers with Hono, serving the React app through Vite and the Cloudflare Vite plugin.
- D1 with Drizzle ORM for daily assignments, player answers, scores, and completion state.
- Zod schemas shared by the server and client; TanStack Query with the typed Hono client.
- TypeScript strict mode, pnpm, Biome, and Vitest with the Cloudflare Workers test plugin.
- The server sets the daily boundary at midnight Africa/Nairobi. A UTC cron trigger preassigns today’s and tomorrow’s question sets; requests create a missing assignment lazily.

## Local setup

Requirements: Node.js 24.15.0 and Corepack-enabled pnpm.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate:local
corepack pnpm dev
```

The app uses local D1. Start Vite and open the printed URL. Appearance follows the device preference by default; use the header control to switch themes. Each round has 15 shared questions (11 English, 4 Swahili), with six medium, seven challenging, and two hard questions. A correct answer scores up to 200 points when answered immediately and declines to 100 over 30 seconds; the bonus question doubles its points. Check the project with:

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

## Shareable hosting

The frontend is configured for Vercel while the API and D1 remain on Cloudflare Workers. Vercel publishes `dist/client` and proxies `/api/*` to the Cloudflare Worker.

## Layout

```text
src/worker/       Hono routes, D1 repositories, quiz selection and scoring
src/client/       React daily challenge, feedback, and leaderboard
src/shared/       Runtime-neutral request and response schemas
data/             Server-only question bank and legacy word-list source material
migrations/       Reviewed, versioned D1 schema migrations
scripts/          Word-list validation and client-bundle leak checks
test/             Pure logic and Workers integration tests
docs/             Decisions, question provenance, deployment notes, and verification gaps
```

## Content and privacy

Questions live in server-only JSON files. The Worker returns only the current prompt, choices, and difficulty; answer keys, explanations, and sources are returned after submission. Compatibility banks preserve already assigned questions through the end of their day. A build check scans client assets for the server-only banks. Source URLs are stored with each question in the versioned files under `data/`.

Players are identified by a random signed, HttpOnly, Secure, SameSite=Lax cookie. A unique display name appears on the leaderboard, while player IDs and cookies remain private. Recovery codes can restore the same identity after a cookie is lost; keep the code private. History and profile endpoints use the identity from the signed cookie, not a client-supplied player ID. The server validates answer order and calculates scores. Do not deploy publicly until the question bank is reviewed.
