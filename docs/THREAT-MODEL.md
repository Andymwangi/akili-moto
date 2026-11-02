# Player identity and history threat model

Reviewed 2026-11-02 for the anonymous player profile and history feature.

## Data stored

- A random UUID links a browser identity to quiz sessions and answers.
- A unique display name is shown publicly beside a completed daily score.
- A SHA-256 hash of the player's high-entropy recovery code is stored in D1. The raw code is returned only at account creation or rotation.
- Completed game dates, scores, correct-answer counts, and completion times are stored for private history and leaderboard ranking.

## Trust boundaries and controls

- The browser receives a signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie. The server derives the player ID from that cookie and does not accept an ID in name or history requests.
- History queries include the authenticated player ID in the database predicate. Integration tests cover a second player and a tampered cookie.
- Recovery codes carry 160 bits of random entropy, are normalized and hashed with Web Crypto, and are rate limited by an atomic D1 counter keyed by a hash of the Cloudflare client IP. Rotating a code invalidates its previous hash.
- Display names are validated, escaped by React's text rendering, and unique case-insensitively in D1. They are public and should not contain sensitive personal information.
- D1 enforces unique player IDs, recovery-code hashes, display names, and daily question-set fingerprints.

## Risks and open work

- Anyone with a player's browser cookie or recovery code can act as that player. Players should keep recovery codes private and rotate a code after suspected exposure.
- Recovery is not a second factor. There is no email or phone recovery path; losing both the cookie and code means the identity cannot be restored.
- Player names, scores, and history are retained indefinitely in the current schema. A player data export/deletion flow and retention period remain follow-up work before public production.
- Public display names and linked score history are pseudonymous personal data. Review collection, retention, deletion, and public display under Kenya's Data Protection Act before production. This engineering note is not legal advice.
- The recovery rate limiter trusts Cloudflare's client IP header and stores only a hash of that value. Production behavior still needs observation under real traffic.
