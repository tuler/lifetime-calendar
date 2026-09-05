# lifetime-calendar

A Cloudflare Worker that turns Life Time class reservations into a calendar feed
you can subscribe to. Multi-user, no database, no readable passwords at rest.

## How credentials are handled

On registration the Worker generates a random 256-bit secret, encrypts the
username and password with it (AES-GCM), stores only the ciphertext in KV, and
returns the secret inside the subscription URL:

```
webcal://lifetime.tuler.dev/feed/{feedId}/{secret}.ics
```

Each time Calendar polls, the Worker decrypts using the secret from the path,
signs in, and builds the `.ics`. Nothing server-side can decrypt a stored record
without the URL.

This protects against someone reading the KV namespace. It does not protect
against the operator, since a modified Worker could log secrets as they arrive.
That's an acceptable trade for friends and family; it isn't a model for
strangers.

## Setup

Already deployed to **https://lifetime.tuler.dev**. The KV namespaces exist and
their ids are in `wrangler.toml`, so day to day it's just:

```sh
bun install
bun run dev      # client + Worker together on http://localhost:5173
bun run deploy   # builds, then deploys to lifetime.tuler.dev
```

From scratch on a new account you'd also need:

```sh
bunx wrangler kv namespace create FEEDS
bunx wrangler kv namespace create FEEDS --preview
# paste both ids into wrangler.toml
```

The custom domain is declared as a `[[routes]]` entry with `custom_domain =
true`; wrangler creates and manages the DNS record in the `tuler.dev` zone, so
there is no CNAME to add by hand.

`bun run dev` uses the Cloudflare Vite plugin, so the Worker runs in workerd
exactly as it does in production, with hot reload for the React client.

Set `SIGNUPS_OPEN = "0"` in `wrangler.toml` and redeploy once everyone has
registered, so the form stops accepting new users.

## How sign-in works

Life Time's own login page uses Azure AD B2C, an interactive Microsoft redirect
that a Worker can't drive. Underneath it, the same API gateway still exposes the
older first-party auth service, and that's what `src/lifetime.ts` uses:

```
POST https://api.lifetimefitness.com/auth/v2/login
{"username": ..., "password": ...}
→ {"ssoId": ..., "message": "Success", "token": ..., "status": "0"}
```

`token` becomes the `X-LTF-CT` header and `ssoId` the `X-LTF-SSOID` header on
every later call, alongside a static `Ocp-Apim-Subscription-Key` taken from the
site's own page config. Reservations come from
`ux/web-schedules/v3/reservations`. See `CLAUDE.md` for the full notes, including
the B2C fallback if the legacy service is ever retired.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Router, registration, cached feed endpoint |
| `src/lifetime.ts` | The only Life Time–specific code; stubs live here |
| `src/crypto.ts` | AES-GCM seal/unseal keyed by the URL secret |
| `src/ics.ts` | RFC 5545 output: folding, escaping, stable UIDs |
| `src/types.ts` | `Env`, `Reservation`, `Credentials`, `SealedBox` |
| `src/client/` | Vite + React signup page (`App.tsx`, `styles.css`) |
| `index.html` | Client entry point |

## Calendar behaviour

- macOS Calendar largely ignores `REFRESH-INTERVAL`; the per-subscription
  "Refresh" setting in Calendar preferences governs polling. Set it to 15 min.
- Feeds are cached in KV for `CACHE_TTL_SECONDS`, so repeated polls cost one
  Life Time request per user per interval rather than one per poll.
- UIDs are SHA-256 digests of the booking id, so refreshes update events in
  place instead of duplicating them. Cancelled classes vanish because the whole
  calendar is regenerated each refresh.
- A failed sign-in returns a valid calendar containing a single "re-subscribe"
  event, because Calendar renders a 5xx as an unexplained error badge.

## Revoking a link

```sh
curl -X DELETE "https://<host>/feed/{feedId}/{secret}.ics"
```

Deletes the credentials and cached feed. Since the secret can't be recovered
server-side, anyone who loses their URL just registers again.

## Cost

Comfortably inside the free tier: 100k Worker requests/day and 1k KV writes/day.
Five users polling every 15 minutes is roughly 500 requests/day.
