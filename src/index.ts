import { seal, unseal, newSecret, newFeedId } from "./crypto";
import {
  login,
  getReservations,
  sessionIsFresh,
  AuthError,
} from "./lifetime";
import { buildIcs } from "./ics";
import { signupPage } from "./page";
import type { Credentials, Env, FeedRecord, Reservation } from "./types";

const FEED_PATH = /^\/feed\/([\w-]+)\/([\w-]+)\.ics$/;

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(signupPage, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/register" && request.method === "POST") {
      return handleRegister(request, env, url);
    }

    const match = FEED_PATH.exec(url.pathname);
    if (match) {
      const [, feedId, secret] = match;
      return request.method === "DELETE"
        ? handleRevoke(env, feedId, secret)
        : handleFeed(env, ctx, feedId, secret);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleRegister(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (env.SIGNUPS_OPEN !== "1") {
    return json({ error: "Signups are closed." }, 403);
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Send JSON." }, 400);
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return json({ error: "Enter your username and password." }, 400);
  }

  // Verify before storing, so a typo doesn't create a dead feed.
  let session;
  try {
    session = await login(username, password);
  } catch (err) {
    // The response stays deliberately vague; the log is where the cause goes,
    // otherwise a local `wrangler dev` run has nothing to debug against.
    console.error("register: login failed —", err);
    return err instanceof AuthError
      ? json({ error: "Life Time didn't accept that sign-in." }, 401)
      : json({ error: "Life Time isn't responding. Try again." }, 502);
  }

  const feedId = newFeedId();
  const secret = newSecret();
  const box = await seal(secret, { username, password, session });
  const record: FeedRecord = { ...box, createdAt: Date.now() };
  await env.FEEDS.put(`feed:${feedId}`, JSON.stringify(record));

  return json({
    webcal: `webcal://${url.host}/feed/${feedId}/${secret}.ics`,
    https: `https://${url.host}/feed/${feedId}/${secret}.ics`,
  });
}

async function handleRevoke(
  env: Env,
  feedId: string,
  secret: string
): Promise<Response> {
  const record = await env.FEEDS.get<FeedRecord>(`feed:${feedId}`, "json");
  if (record) {
    try {
      await unseal<Credentials>(secret, record); // proves the caller holds the key
    } catch {
      return json({ error: "No such feed." }, 404);
    }
    await env.FEEDS.delete(`feed:${feedId}`);
    await env.FEEDS.delete(`ics:${feedId}`);
    return json({ ok: true });
  }
  return json({ error: "No such feed." }, 404);
}

async function handleFeed(
  env: Env,
  ctx: ExecutionContext,
  feedId: string,
  secret: string
): Promise<Response> {
  const ttl = Number(env.CACHE_TTL_SECONDS || 900);

  const cached = await env.FEEDS.get(`ics:${feedId}`, "text");
  if (cached) return icsResponse(cached, ttl, "HIT");

  const record = await env.FEEDS.get<FeedRecord>(`feed:${feedId}`, "json");
  if (!record) return new Response("Not found", { status: 404 });

  let creds: Credentials;
  try {
    creds = await unseal<Credentials>(secret, record);
  } catch {
    // A wrong secret and a missing feed look identical on purpose.
    return new Response("Not found", { status: 404 });
  }

  let reservations: Reservation[];
  try {
    reservations = await fetchWithRetry(creds);
  } catch (err) {
    if (err instanceof AuthError) {
      // The password changed upstream. Serve a valid calendar carrying the bad
      // news, because Calendar renders a 500 as an unexplained error badge.
      return icsResponse(await authFailureIcs(feedId), 300, "AUTH");
    }
    console.error("feed: upstream failure —", err);
    return new Response("Upstream error", { status: 502 });
  }

  const ics = await buildIcs(feedId, reservations, {
    ttlMinutes: Math.round(ttl / 60),
  });

  ctx.waitUntil(
    (async () => {
      await env.FEEDS.put(`ics:${feedId}`, ics, {
        expirationTtl: Math.max(60, ttl),
      });
      // Persist the refreshed session token alongside the credentials.
      const box = await seal(secret, creds);
      const updated: FeedRecord = { ...box, createdAt: record.createdAt };
      await env.FEEDS.put(`feed:${feedId}`, JSON.stringify(updated));
    })()
  );

  return icsResponse(ics, ttl, "MISS");
}

/** Reuse the cached token; on a 401, log in once more and retry. */
async function fetchWithRetry(creds: Credentials): Promise<Reservation[]> {
  if (sessionIsFresh(creds.session)) {
    try {
      return await getReservations(creds.session);
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
    }
  }
  creds.session = await login(creds.username, creds.password);
  return getReservations(creds.session);
}

function authFailureIcs(feedId: string): Promise<string> {
  const now = new Date();
  return buildIcs(feedId, [
    {
      id: "auth-failed",
      title: "Life Time sign-in failed — re-subscribe",
      start: now.toISOString(),
      end: new Date(now.getTime() + 30 * 60_000).toISOString(),
      location: "",
      instructor: null,
      station: null,
      status: "confirmed",
    },
  ]);
}

function icsResponse(body: string, ttl: number, cacheState: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="lifetime.ics"',
      "Cache-Control": `public, max-age=${ttl}`,
      "X-Cache": cacheState,
    },
  });
}
