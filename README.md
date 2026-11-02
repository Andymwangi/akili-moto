# Akili Moto

Akili Moto is a mobile-first daily trivia challenge. Everyone gets the same ten multiple-choice questions in the same order each Nairobi day: seven in English and three in Swahili. Players earn points for correct answers, with a small server-timed speed bonus, then see their rank against completed challenges.

## MVP scope

The playable MVP includes the daily shared question set, recoverable anonymous player identity, editable unique player names, private completed-game history, server-side scoring, answer explanations and sources, D1 persistence, and a daily leaderboard. Email accounts, weekly leagues, historic challenge replay, Sheng mode, ads, payments, and production deployment are outside this milestone.

The question bank contains 40 sourced draft questions across four progressive difficulty levels. The daily set moves from medium to very hard, with seven English and three Swahili questions. Swahili wording and all question sourcing still need review before public gameplay. The old Swahili word candidates remain in `data/` for possible future use but are not used by Akili Moto.

## Scoring

- A correct answer is worth 100 points.
- A correct answer can earn up to 20 extra points for speed. The bonus decreases each second and reaches zero after 20 seconds.
- The server records answer time and computes all points. The browser never submits a score.
- The leaderboard ranks completed games by points. Equal scores share a rank.
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

The app uses local D1. Start Vite and open the printed URL. Appearance follows the device preference by default; use the header control to switch themes. Check the project with:

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

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

Questions live in server-only JSON files. The Worker returns only the current prompt, choices, and difficulty; answer keys, explanations, and sources are returned after submission. A compatibility bank preserves already assigned v1 challenges through the end of their day. A build check scans client assets for both banks. Source URLs are stored with each question in `data/quiz-questions.json`.

Players are identified by a random signed, HttpOnly, Secure, SameSite=Lax cookie. A unique display name appears on the leaderboard, while player IDs and cookies remain private. Recovery codes can restore the same identity after a cookie is lost; keep the code private. History and profile endpoints use the identity from the signed cookie, not a client-supplied player ID. The server validates answer order and calculates scores. Do not deploy publicly until the question bank is reviewed.
