# Cloudflare setup

## Resources created

The production resources are attached to the `production` Wrangler environment in `wrangler.jsonc`:

- D1 database `neno-word-game`, primary region WEUR.
- KV namespace bound as `RATE_LIMIT`.

The development environment remains local and uses the separate `neno-local` D1 database.

## Before first deployment

1. The production `ALLOWED_ORIGIN` is configured as `https://neno-word-game-production.andymwangi3.workers.dev`. Change it only if the Worker name or domain changes.
2. Confirm the Worker is enabled on `workers.dev` or that its custom domain is configured.
3. Have the owner and a fluent Swahili reviewer review the question wording, translations, answers, explanations, and sources in `docs/QUESTIONS.md` before production gameplay.
4. Apply the database migration when the owner is ready to mutate the production database:

   ```powershell
   corepack pnpm exec wrangler d1 migrations apply neno-word-game --remote --env production
   ```

5. Review the production build without deploying:

   ```powershell
   corepack pnpm exec wrangler deploy --dry-run --env production --config wrangler.jsonc
   ```

6. When content and configuration are ready, deploy:

   ```powershell
   corepack pnpm exec wrangler deploy --env production --config wrangler.jsonc
   ```

7. Set `COOKIE_SIGNING_SECRET` through Cloudflare Worker secrets:

   ```powershell
   corepack pnpm exec wrangler secret put COOKIE_SIGNING_SECRET --env production
   ```

   Wrangler's `secret put` deploys a new Worker version. Set the secret only when the deployment is intended to become active. Use a random value of at least 32 characters and do not put it in `wrangler.jsonc` or source control.

## Current blockers

- The account subdomain is configured as `andymwangi3.workers.dev`; confirm the final production hostname in the Cloudflare dashboard once the Worker exists.
- The starter question bank is a draft. Production gameplay must wait for owner and fluent-reviewer approval.
- The created D1 primary region is WEUR. It is an account resource choice, not a code requirement.

No remote migration, production seed, secret, or deployment has been run as part of this setup.
