# lifetime-calendar

A Cloudflare Worker that turns Life Time class reservations into a calendar feed
you can subscribe to. Multi-user, no database, no readable passwords at rest.

## How credentials are handled

On registration the Worker generates a random 256-bit secret, encrypts the
username and password with it (AES-GCM), stores only the ciphertext in KV, and
returns the secret inside the subscription URL:

```
webcal://lifetime-calendar.<subdomain>.workers.dev/feed/{feedId}/{secret}.ics
```

Each time Calendar polls, the Worker decrypts using the secret from the path,
signs in, and builds the `.ics`. Nothing server-side can decrypt a stored record
without the URL.

This protects against someone reading the KV namespace. It does not protect
against the operator, since a modified Worker could log secrets as they arrive.
That's an acceptable trade for friends and family; it isn't a model for
strangers.

## Setup

```sh
npm install
npx wrangler kv namespace create FEEDS
npx wrangler kv namespace create FEEDS --preview
# paste both ids into wrangler.toml
npm run dev
npm run deploy
```

Set `SIGNUPS_OPEN = "0"` in `wrangler.toml` and redeploy once everyone has
registered, so the form stops accepting new users.

## Before it works: capture the two Life Time calls

`src/lifetime.ts` has `login()` and `getReservations()` stubbed. To fill them in:

1. Log into my.lifetime.life with DevTools open on Network, filtered to
   Fetch/XHR, "Preserve log" checked.
2. Log out and back in. Find the POST carrying the credentials. Note the URL,
   request body, custom headers the SPA sends, and how the token comes back
   (JSON field vs. `Set-Cookie`).
3. Open the reservations page. Find the GET returning bookings as JSON. Note the
   URL, query params, and auth header.
4. Translate both into `fetch` calls, then adjust `normalize()` and
   `RawReservation` to match the real field names.

Watch for:

- **Cookie auth.** Workers' `fetch` keeps no cookie jar. If login returns
  `Set-Cookie`, parse it and send it back manually as a `Cookie` header.
- **Bot protection.** If login returns a challenge page, a Worker can't complete
  it and you'd need Browser Rendering, which costs far more per request.
- **Date windows.** The reservations endpoint may default to a narrow range;
  pass explicit start/end so future bookings appear.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Router, registration, cached feed endpoint |
| `src/lifetime.ts` | The only Life Time–specific code; stubs live here |
| `src/crypto.ts` | AES-GCM seal/unseal keyed by the URL secret |
| `src/ics.ts` | RFC 5545 output: folding, escaping, stable UIDs |
| `src/page.ts` | Signup page markup |
| `src/types.ts` | `Env`, `Reservation`, `Credentials`, `SealedBox` |

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
