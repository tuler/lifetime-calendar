import type { Reservation, Session } from "./types";

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
const PROFILE_PATH = "user-profile/api";
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

/**
 * One reservation as the v3 endpoint returns it, inside `{ results: [...] }`.
 *
 * Verified from the SPA's own parsing (it reads `start`, `end`, `eventId`,
 * `location`, and a nested `registration` object). The precise field names for
 * the class title, instructor, and station/spot are best-effort until checked
 * against a live authenticated response — hence the several optionals below.
 */
interface RawReservation {
  registrationId?: string | number;
  id?: string | number;
  eventId?: string | number;
  name?: string;
  eventName?: string;
  className?: string;
  start?: string;
  end?: string;
  startDateTime?: string;
  endDateTime?: string;
  location?: string;
  locationName?: string;
  studioName?: string;
  instructorName?: string;
  instructor?: string | { name?: string };
  organizers?: Array<string | { name?: string }>;
  stationNumber?: string | number;
  spot?: string | number;
  waitlisted?: boolean;
  isWaitlisted?: boolean;
  status?: string;
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
      memberId: await memberIdFor(token, data),
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

/**
 * The reservations query is scoped by member id. The login response may already
 * carry one; otherwise ask the profile service. Best-effort — a failure here
 * shouldn't sink an otherwise good login, it just widens the query.
 */
async function memberIdFor(
  token: string,
  login: LoginResponse
): Promise<string | null> {
  if (login.memberId != null) return String(login.memberId);
  try {
    const res = await fetch(`${APIM_ROOT}${PROFILE_PATH}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        "Ocp-Apim-Subscription-Key": APIM_KEY,
        "X-LTF-CT": token,
      },
    });
    if (!res.ok) return null;
    const profile = (await res.json()) as { memberId?: string | number };
    return profile.memberId != null ? String(profile.memberId) : null;
  } catch {
    return null;
  }
}

/** US-format date the reservations query expects, e.g. 09/05/2026. */
function usDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

export async function getReservations(
  session: Session
): Promise<Reservation[]> {
  const now = new Date();
  const end = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);

  const params = new URLSearchParams({
    start: usDate(now),
    end: usDate(end),
    pageSize: "0", // 0 = no page limit, matching the SPA
  });
  if (session.memberId) params.set("memberIds", session.memberId);

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

  return (data.results ?? []).map(normalize);
}

/** Map one raw record onto the shape ics.ts wants. */
export function normalize(raw: RawReservation): Reservation {
  const location =
    raw.location ??
    [raw.locationName, raw.studioName].filter(Boolean).join(" — ");

  const waitlisted = raw.isWaitlisted ?? raw.waitlisted ?? raw.status === "waitlisted";

  return {
    id: String(raw.registrationId ?? raw.id ?? raw.eventId ?? ""),
    title:
      raw.name ?? raw.eventName ?? raw.className ?? "Life Time reservation",
    start: raw.start ?? raw.startDateTime ?? "",
    end: raw.end ?? raw.endDateTime ?? "",
    location: location ?? "",
    instructor: readInstructor(raw),
    station:
      raw.stationNumber != null
        ? String(raw.stationNumber)
        : raw.spot != null
          ? String(raw.spot)
          : null,
    status: waitlisted ? "waitlisted" : "confirmed",
  };
}

function readInstructor(raw: RawReservation): string | null {
  if (raw.instructorName) return raw.instructorName;
  if (typeof raw.instructor === "string") return raw.instructor;
  if (raw.instructor && typeof raw.instructor === "object") {
    return raw.instructor.name ?? null;
  }
  if (raw.organizers && raw.organizers.length) {
    const names = raw.organizers.map((o) =>
      typeof o === "string" ? o : (o?.name ?? "")
    );
    const joined = names.filter(Boolean).join(", ");
    return joined || null;
  }
  return null;
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
