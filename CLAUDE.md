# CLAUDE.md

Context for working on this repo.

## What this is

A Cloudflare Worker (TypeScript, no framework) that logs into Life Time on a
user's behalf and serves their class reservations as a subscribable `.ics` feed.
Users: the author plus friends and family, so roughly five accounts.

## Current state

Complete and typechecking. `login()` and `getReservations()` in
`src/lifetime.ts` are now implemented against the real endpoints (see the "Auth"
notes below). `bun run test` covers `ics.ts` and `crypto.ts`; the Life Time
calls have no unit tests yet and haven't been exercised with real credentials.

## Auth (reverse-engineered Sept 2026)

Sign-in is delegated to **Azure AD B2C** — the "Microsoft Authentication" you
saw. The website itself uses an interactive MSAL redirect
(`B2C_1A_WebUsernameSignIn`), useless to a headless Worker. The same tenant also
exposes a **ROPC** policy, `B2C_1A_ROPCSignIn`, which takes username + password
in one form POST and returns tokens — that's what `login()` uses.

- Token URL: `https://auth.lifetime.life/prdltmembersb2c.onmicrosoft.com/b2c_1a_ropcsignin/oauth2/v2.0/token`
- Public client id `27e53cd6-9054-444f-bdfa-b341dcb7263d`, scope `openid offline_access https://prdltmembersb2c.onmicrosoft.com/27e53cd6-.../read`.
- The id_token carries Life Time claims `LTF_SSOID` and `LTF_AccessToken`, which
  become the `X-LTF-SSOID` and `X-LTF-CT` headers on the API call.
- Reservations: `GET https://api.lifetimefitness.com/ux/web-schedules/v3/reservations`
  behind Azure API Management, needing a static `ocp-apim-subscription-key`
  (`924c03ce...`, from the page config, not a secret) plus the two headers above.
  Returns `{ results: [...] }`. Confirmed 401 without a valid SSO id.

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
- Run `bun run typecheck` and `bun run test` before committing.

## Next steps

1. Run one real sign-in end to end and capture the authenticated
   `/ux/web-schedules/v3/reservations` response, then tighten `RawReservation`
   and `normalize()` to the actual field names. The title/instructor/station
   mapping is currently best-effort — `start`, `end`, `eventId`, and `location`
   are the fields confirmed from the SPA's own parsing.
2. Confirm whether the API needs `X-LTF-CT` in addition to `X-LTF-SSOID` (the
   SPA's cancel call sends only SSOID + key; the read path sends both). Also
   decide whether `memberIds` should be omitted to pick up family members on the
   same login, or kept to scope to the primary member.
3. Timezone: the SPA reads `start`/`end` with `moment.parseZone`, i.e. the API
   returns ISO stamps *with* offsets, so `ics.ts`'s UTC `Z` conversion is
   correct. Re-confirm against a real reservation before trusting it fully.
4. Consider a Cron Trigger to pre-warm caches, though lazy refresh on poll may
   be enough at this scale.

## Out of scope

Not a public service. Don't add analytics, accounts, password reset, or an admin
UI. If signups need closing, flip `SIGNUPS_OPEN` in `wrangler.toml`.
