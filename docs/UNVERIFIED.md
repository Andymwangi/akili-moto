# Unverified

## Current daily quiz MVP

- The sourced starter bank in `data/quiz-questions.json` is a draft, not yet reviewed by the owner or a fluent Swahili reviewer. No production deployment has been run.
- Local Workers tests and local D1 can verify behavior in the configured test environment, but do not prove remote D1 behavior, Cloudflare routing, cron delivery, or production capacity.
- The new quiz migration has not been applied to the remote D1 database. No remote migration, content seed, secret update, or deployment has been run.
- The `workers.dev` account subdomain is `andymwangi3.workers.dev`; the expected production Worker origin is configured in `wrangler.jsonc`. The final hostname should be confirmed in Cloudflare after the Worker exists.

## Legacy Wordle material

- The supplied Swahili answer and dictionary candidates remain unreviewed and are not used by the active quiz application.
- The old Wordle schema and logic are retained as inactive legacy code and have not been removed from the local D1 database.
- Remote D1 and KV resources were created earlier, but no remote migration or deployment has been performed.
