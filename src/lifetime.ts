import type { Member, Reservation, Session } from "./types";

// ---------------------------------------------------------------------------
// Life Time adapter.
//
// Everything site-specific lives in this file. Other modules speak only the
// `Reservation` type from ./types.
//
// How login works (captured from my.lifetime.life, Sept 2026):
//
// The website's own sign-in page delegates to Azure AD B2C — the "Microsoft
// Authentication" you see in DevTools. That flow is an interactive MSAL
// redirect, useless to a headless Worker.
//
// Underneath it, though, the same API gateway still exposes the older
// first-party auth service, which the framework bundle uses directly:
//
//   POST {APIM_ROOT}auth/v2/login   {"username": ..., "password": ...}
//     → {"ssoId": ..., "message": "Success", "token": ..., "status": "0"}
//
// That is one plain JSON round trip and it hands back exactly the two values
// the reservations API wants:
//   - `token` → the site's `lt-authentication` cookie → `X-LTF-CT` header
//   - `ssoId` → the `LTFSSOIDCookie`                  → `X-LTF-SSOID` header
//
// Note the site omits the request's optional `type` field; sending it requires
// a valid `LoginSessionType` enum value and 400s otherwise, so we omit it too.
//
// The login response carries a `partyId` but *no* `memberId`, and the profile
// service that used to supply one (`user-profile/api`) now 401s for auth-v2
// sessions on every header shape the site's own interceptor can produce. That
// doesn't matter: on a family membership the reservations endpoint returns the
// whole household regardless of who signs in, and tags each row with the
// `memberId`/`memberName` it belongs to. So we fetch unscoped and split the
// rows by member here. (The `memberIds` query param does still work, but it
// takes a single id — a comma-separated pair 400s — and it is not enforced
// per-session anyway: any member of a household can request any other's.)
//
// If this legacy service is ever retired, the B2C fallback is a ROPC policy
// (Resource Owner Password Credentials), which also works headlessly:
//   POST https://auth.lifetime.life/prdltmembersb2c.onmicrosoft.com
//        /b2c_1a_ropcsignin/oauth2/v2.0/token
//   grant_type=password, client_id=27e53cd6-9054-444f-bdfa-b341dcb7263d,
//   scope=openid offline_access https://<tenant>/<client_id>/read
// Its id_token carries the same values as the `LTF_SSOID` and
// `LTF_AccessToken` claims.
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// --- Life Time API (Azure API Management) ---------------------------------
const APIM_ROOT = "https://api.lifetimefitness.com/";
// `window.lt.api.apimKey` from the page config. A gateway throttling key, not
// a credential; requests still 401 without a valid session.
const APIM_KEY = "924c03ce573d473793e184219a6a19bd";
const LOGIN_PATH = "auth/v2/login";
const RESERVATIONS_PATH = "ux/web-schedules/v3/reservations";
// Calendars subscribe far ahead; the SPA's own "brief" call looks 270 days out.
const LOOKAHEAD_DAYS = 270;
// The upstream token is a session cookie with no stated lifetime. Re-login is
// cheap and `index.ts` retries on a 401, so keep the assumption conservative.
const SESSION_TTL_MS = 55 * 60_000;

/** Credentials were rejected, or the cached token went stale. */
export class AuthError extends Error {}
/** Life Time returned something we can't use. */
export class UpstreamError extends Error {}

/** Response from `auth/v2/login`. */
interface LoginResponse {
  ssoId?: string;
  /** Older casing seen in the framework's own fallback path. */
  ssoid?: string;
  token?: string;
  /** "Success" on a good login, otherwise a human-readable reason. */
  message?: string;
  /** "0" on success; negative codes such as "-201" are credential failures. */
  status?: string;
  memberId?: string | number;
  partyId?: string | number;
}

/** A household member as the registration block lists them. */
export interface RawMember {
  name?: string;
  id?: number | string;
  /** Confirmed booking: the assigned bike/station/court spot. */
  spot?: number | string;
  /** Present instead of `spot` when this member is on the waitlist. */
  spotWaitlist?: number | string;
}

/**
 * One reservation as the v3 endpoint returns it, inside `{ results: [...] }`.
 *
 * Confirmed against a live authenticated response (Sept 2026). Note the row
 * carries `memberId`/`memberName`: on a family membership the endpoint returns
 * the whole household, and these are what say whose booking it is.
 */
export interface RawReservation {
  /** The registration id. Stable per booking, so UIDs derive from it. */
  id?: string;
  memberId?: number | string;
  /** First name only, e.g. "Danilo". */
  memberName?: string;
  eventId?: string;
  eventName?: string;
  /** Already a full description, e.g. "Court 1 – 3, Princeton". */
  location?: string;
  locationName?: string;
  instructors?: Array<{ name?: string }>;
  registration?: {
    registeredMembers?: RawMember[];
    unregisteredMembers?: RawMember[];
  };
  start?: string;
  end?: string;
  reservationType?: string;
  category?: string;
}

interface ReservationsResponse {
  results?: RawReservation[];
}

export async function login(
  username: string,
  password: string
): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${APIM_ROOT}${LOGIN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json",
        "User-Agent": UA,
        "Ocp-Apim-Subscription-Key": APIM_KEY,
      },
      // `type` is deliberately omitted — see the note at the top of this file.
      body: JSON.stringify({ username, password }),
    });
  } catch (err) {
    throw new UpstreamError(`login network error: ${String(err)}`);
  }

  let data: LoginResponse;
  try {
    data = (await res.json()) as LoginResponse;
  } catch {
    throw new UpstreamError(`login: non-JSON response (${res.status})`);
  }

  const token = data.token;
  const sso = data.ssoId ?? data.ssoid;

  if (data.message === "Success" && data.status === "0" && token && sso) {
    return {
      token,
      sso,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  }

  // A rejected sign-in comes back as a 4xx carrying a plain-language message
  // (e.g. "User account not found", status "-201"). Anything else — a 5xx, a
  // gateway problem, a success-shaped body missing its token — is upstream.
  if (res.status >= 400 && res.status < 500 && data.message) {
    throw new AuthError(`Life Time rejected the sign-in: ${data.message}`);
  }
  throw new UpstreamError(
    `login failed: ${res.status} ${data.message ?? "unexpected response"}`
  );
}

/** US-format date the reservations query expects, e.g. 09/05/2026. */
function usDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/**
 * Every reservation the account can see. On a family membership that is the
 * whole household, not just the person who signed in — see the note up top.
 */
export async function getReservations(
  session: Session
): Promise<Reservation[]> {
  return (await fetchRows(session)).map(normalize);
}

/**
 * The household roster, as far as the schedule endpoint reveals it. Members
 * turn up three ways: as the owner of a row, and in a row's registered and
 * unregistered lists. Union them, because any single row only lists the
 * members eligible for *that* event.
 *
 * A household with no bookings at all therefore looks empty. Callers must
 * handle that — see `handleRegister`.
 */
export async function getHousehold(session: Session): Promise<Member[]> {
  return rosterFrom(await fetchRows(session));
}

/** The roster-building half of `getHousehold`, split out so it can be tested. */
export function rosterFrom(rows: RawReservation[]): Member[] {
  const byId = new Map<string, string>();
  const add = (id?: string | number | null, name?: string | null) => {
    if (id == null || !name) return;
    byId.set(String(id), name);
  };

  for (const row of rows) {
    add(row.memberId, row.memberName);
    for (const m of row.registration?.registeredMembers ?? []) add(m.id, m.name);
    for (const m of row.registration?.unregisteredMembers ?? []) add(m.id, m.name);
  }

  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchRows(session: Session): Promise<RawReservation[]> {
  const now = new Date();
  const end = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);

  const params = new URLSearchParams({
    start: usDate(now),
    end: usDate(end),
    pageSize: "0", // 0 = no page limit, matching the SPA
  });

  const url = `${APIM_ROOT}${RESERVATIONS_PATH}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        "Ocp-Apim-Subscription-Key": APIM_KEY,
        "X-LTF-SSOID": session.sso,
        "X-LTF-CT": session.token,
      },
    });
  } catch (err) {
    throw new UpstreamError(`reservations network error: ${String(err)}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AuthError("session expired");
  }
  if (!res.ok) throw new UpstreamError(`reservations failed: ${res.status}`);

  let data: ReservationsResponse;
  try {
    data = (await res.json()) as ReservationsResponse;
  } catch {
    throw new UpstreamError("reservations: non-JSON response");
  }

  return data.results ?? [];
}

/** Map one raw record onto the shape ics.ts wants. */
export function normalize(raw: RawReservation): Reservation {
  // The row's own `memberId` picks this member out of the registration block,
  // which is where the spot (or waitlist position) actually lives.
  const me = raw.registration?.registeredMembers?.find(
    (m) => String(m.id) === String(raw.memberId)
  );
  const waitlisted = me?.spotWaitlist != null;

  return {
    id: String(raw.id ?? raw.eventId ?? ""),
    memberId: raw.memberId != null ? String(raw.memberId) : null,
    memberName: raw.memberName ?? null,
    title: raw.eventName ?? "Life Time reservation",
    start: raw.start ?? "",
    end: raw.end ?? "",
    location: raw.location ?? raw.locationName ?? "",
    instructor: readInstructor(raw),
    station: me?.spot != null ? String(me.spot) : null,
    waitlistPosition: waitlisted ? Number(me!.spotWaitlist) : null,
    status: waitlisted ? "waitlisted" : "confirmed",
  };
}

function readInstructor(raw: RawReservation): string | null {
  const names = (raw.instructors ?? [])
    .map((i) => i?.name ?? "")
    .filter(Boolean);
  return names.length ? names.join(", ") : null;
}

/** Re-logging in on every calendar poll is slow and rude; reuse the token. */
export function sessionIsFresh(session?: Session): session is Session {
  return (
    !!session &&
    !!session.sso &&
    !!session.token &&
    session.expiresAt > Date.now() + 60_000
  );
}
