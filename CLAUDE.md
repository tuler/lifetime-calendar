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

The **website's** sign-in is Azure AD B2C — the "Microsoft Authentication" that
makes the request hard to spot in DevTools. It's an interactive MSAL redirect,
so it's useless to a headless Worker. Don't try to drive it.

Underneath, the same API gateway still exposes the older first-party auth
service, which the site's own framework bundle calls directly. That is what
`login()` uses, and it's one plain JSON round trip:

- `POST https://api.lifetimefitness.com/auth/v2/login` with
  `{"username": ..., "password": ...}` and an `Ocp-Apim-Subscription-Key`
  header → `{"ssoId": ..., "message": "Success", "token": ..., "status": "0"}`.
- Omit the optional `type` field. It's a `LoginSessionType` enum and any string
  guess 400s; the site omits it too.
- `token` → `X-LTF-CT`, `ssoId` → `X-LTF-SSOID` on every subsequent API call.
- Reservations: `GET https://api.lifetimefitness.com/ux/web-schedules/v3/reservations`
  behind Azure API Management, needing the subscription key (`924c03ce...`,
  from the page config, not a secret) plus those two headers. Returns
  `{ results: [...] }`. Confirmed 401 without a valid session.
- `memberId` scopes the reservations query; `login()` gets it from
  `GET user-profile/api` (with `X-LTF-CT`) as a best-effort step.

**Fallback if the legacy service is retired:** the B2C tenant also has a ROPC
policy, `B2C_1A_ROPCSignIn`, that works headlessly — POST `grant_type=password`
with client id `27e53cd6-9054-444f-bdfa-b341dcb7263d` to
`https://auth.lifetime.life/prdltmembersb2c.onmicrosoft.com/b2c_1a_ropcsignin/oauth2/v2.0/token`.
Its id_token carries the same two values as the `LTF_SSOID` and
`LTF_AccessToken` claims. The recipe is in the header comment of `lifetime.ts`.

`scripts/probe-login.mjs` exercises this whole chain with real credentials from
the environment and prints the result with tokens redacted. Delete it once the
reservation field names are confirmed.

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
