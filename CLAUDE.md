# CLAUDE.md

Context for working on this repo.

## What this is

A Cloudflare Worker (TypeScript, no framework) that logs into Life Time on a
user's behalf and serves their class reservations as a subscribable `.ics` feed.
Users: the author plus friends and family, so roughly five accounts.

## Current state

Complete and typechecking, except `login()` and `getReservations()` in
`src/lifetime.ts`, which throw `UpstreamError` until the real endpoints are
filled in from a DevTools capture. `npm test` covers `ics.ts` and `crypto.ts`.

## Design decisions worth preserving

- **The URL is the key.** A random 256-bit secret encrypts each user's
  credentials; only the ciphertext goes to KV, and the secret lives solely in
  the subscription URL. Never add a server-side copy of the secret, a master
  key, or a "recover my link" flow — that would defeat the whole scheme.
- **A wrong secret and a missing feed both return a bare 404,** so the endpoint
  doesn't confirm which feed ids exist.
- **All Life Time specifics stay in `src/lifetime.ts`.** Other modules speak only
  the `Reservation` type from `src/types.ts`.
- **UIDs must be stable** across refreshes or Calendar duplicates every event on
  every poll. They're SHA-256 over `feedId|bookingId`.
- **Auth failures return a valid calendar** holding one "re-subscribe" event
  rather than a 5xx, which Calendar surfaces as an unexplained error.
- **Feeds are cached in KV** for `CACHE_TTL_SECONDS` so Calendar's polling
  doesn't translate into a Life Time request each time.

## Conventions

- Strict TypeScript, ES modules, no default exports except the Worker handler.
- No runtime dependencies. WebCrypto and `fetch` only. Keep it that way unless
  there's a strong reason.
- Errors the user might see get plain-language messages; internal failures get
  status codes and nothing else.
- Run `npm run typecheck` and `npm test` before committing.

## Next steps

1. Capture the login and reservations requests from my.lifetime.life and
   implement the two stubs. Tighten the `RawReservation` interface to the real
   response.
2. Handle cookie-based auth if login returns `Set-Cookie` — Workers keep no
   cookie jar, so cookies must be parsed and replayed manually.
3. Confirm timezone handling against a real reservation. `ics.ts` converts to
   UTC `Z` stamps, which is correct only if the API returns offsets. If it
   returns naive local times, add a `VTIMEZONE` and club-local conversion.
4. Consider a Cron Trigger to pre-warm caches, though lazy refresh on poll may
   be enough at this scale.

## Out of scope

Not a public service. Don't add analytics, accounts, password reset, or an admin
UI. If signups need closing, flip `SIGNUPS_OPEN` in `wrangler.toml`.
