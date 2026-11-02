# Akili Moto

Akili Moto is a mobile-first daily trivia challenge. Everyone gets the same ten multiple-choice questions in the same order each Nairobi day: seven in English and three in Swahili. Players earn points for correct answers, with a small server-timed speed bonus, then see their rank against completed challenges.

## MVP scope

The playable MVP includes the daily shared question set, anonymous signed player identity, server-side scoring, answer explanations and sources, D1 persistence, and a daily leaderboard. Email accounts, public handles, weekly leagues, historic challenges, Sheng mode, ads, payments, and production deployment are outside this milestone.

The included question bank is a sourced starter draft for owner review. Its language mix and factual wording need review before public gameplay. The old Swahili word candidates remain in `data/` for possible future use but are not used by Akili Moto.

## Scoring

- A correct answer is worth 100 points.
- A correct answer can earn up to 20 extra points for speed. The bonus decreases each second and reaches zero after 20 seconds.
- The server records answer time and computes all points. The browser never submits a score.
- The leaderboard ranks completed games by points. Equal scores share a rank.
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

The app uses local D1. Start Vite and open the printed URL. Check the project with:

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

Questions live in a server-only JSON file. The Worker returns only the current prompt and choices; answer keys, explanations, and sources are returned after submission. A build check scans client assets for question text and answer choices. Question sources and review status are tracked in [docs/QUESTIONS.md](docs/QUESTIONS.md).

Players are identified by a random signed, HttpOnly, Secure, SameSite=Lax cookie. The leaderboard shows scores and completion counts, not player IDs or cookies. The server validates answer order and calculates scores. See [docs/CLOUDFLARE-SETUP.md](docs/CLOUDFLARE-SETUP.md) for resource setup; do not deploy until the question bank is reviewed.
