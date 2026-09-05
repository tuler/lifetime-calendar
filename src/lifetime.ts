import type { Reservation, Session } from "./types";
import { b64urlDecode } from "./crypto";

// ---------------------------------------------------------------------------
// Life Time adapter.
//
// Everything site-specific lives in this file. Other modules speak only the
// `Reservation` type from ./types.
//
// How login works (captured from my.lifetime.life, Sept 2026):
//
// The site delegates sign-in to Azure AD B2C ("Microsoft Authentication").
// The browser uses an interactive redirect (MSAL) against the
// `B2C_1A_WebUsernameSignIn` policy, which is no use to a headless Worker.
// But the same B2C tenant also exposes a **ROPC** policy
// (`B2C_1A_ROPCSignIn`) — Resource Owner Password Credentials — which accepts
// username + password in a single form POST and returns tokens directly. That
// is what we use here.
//
// The id_token that comes back carries two Life Time-specific claims:
//   - `LTF_SSOID`        → sent onward as the `X-LTF-SSOID` header
//   - `LTF_AccessToken`  → sent onward as the `X-LTF-CT`  header
// The reservations API sits behind Azure API Management and additionally wants
// a static subscription key (not a secret — it ships in the page's config).
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// --- Azure AD B2C (ROPC) --------------------------------------------------
const B2C_TENANT = "prdltmembersb2c.onmicrosoft.com";
const B2C_ROPC_POLICY = "b2c_1a_ropcsignin";
const B2C_TOKEN_URL =
  `https://auth.lifetime.life/${B2C_TENANT}/${B2C_ROPC_POLICY}` +
  "/oauth2/v2.0/token";
// Public SPA client id — identifies the web app, not a secret.
const B2C_CLIENT_ID = "27e53cd6-9054-444f-bdfa-b341dcb7263d";
const B2C_SCOPE =
  "openid offline_access " +
  `https://${B2C_TENANT}/${B2C_CLIENT_ID}/read`;

// --- Life Time API (Azure API Management) ---------------------------------
const APIM_ROOT = "https://api.lifetimefitness.com/";
// `window.lt.api.apimKey` from the page config. A gateway throttling key, not
// a credential; the request still 401s without a valid SSO id.
const APIM_KEY = "924c03ce573d473793e184219a6a19bd";
const RESERVATIONS_PATH = "ux/web-schedules/v3/reservations";
// Calendars subscribe far ahead; the SPA's own "brief" call looks 270 days out.
const LOOKAHEAD_DAYS = 270;

/** Credentials were rejected, or the cached token went stale. */
export class AuthError extends Error {}
/** Life Time returned something we can't use. */
export class UpstreamError extends Error {}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Claims we read out of the B2C id_token. */
interface IdTokenClaims {
  LTF_SSOID?: string;
  LTF_AccessToken?: string;
  memberId?: string | number;
  exp?: number;
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

/** Decode a JWT payload without verifying it (B2C already did). */
function decodeJwtClaims(jwt: string): IdTokenClaims {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new UpstreamError("malformed id_token");
  const json = new TextDecoder().decode(b64urlDecode(parts[1]));
  return JSON.parse(json) as IdTokenClaims;
}

export async function login(
  username: string,
  password: string
): Promise<Session> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: B2C_CLIENT_ID,
    scope: B2C_SCOPE,
    username,
    password,
    response_type: "token id_token",
  });

  let res: Response;
  try {
    res = await fetch(B2C_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body,
    });
  } catch (err) {
    throw new UpstreamError(`login network error: ${String(err)}`);
  }

  let data: TokenResponse;
  try {
    data = (await res.json()) as TokenResponse;
  } catch {
    throw new UpstreamError(`login: non-JSON response (${res.status})`);
  }

  if (!res.ok || data.error) {
    // B2C reports bad credentials as `access_denied` / `invalid_grant` with an
    // `AADB2C90225` code; treat those as auth failures and everything else as
    // an upstream problem.
    const desc = data.error_description ?? "";
    const isAuth =
      data.error === "access_denied" ||
      data.error === "invalid_grant" ||
      /AADB2C90225/.test(desc);
    if (isAuth) throw new AuthError("Life Time rejected those credentials");
    throw new UpstreamError(`login failed: ${res.status} ${data.error ?? ""}`);
  }

  if (!data.id_token) throw new UpstreamError("login: no id_token in response");

  const claims = decodeJwtClaims(data.id_token);
  const sso = claims.LTF_SSOID;
  const authToken = claims.LTF_AccessToken;
  if (!sso || !authToken) {
    throw new UpstreamError("login: id_token missing Life Time claims");
  }

  // Prefer the token's own expiry; fall back to a conservative 55 minutes.
  const expiresAt =
    typeof claims.exp === "number"
      ? claims.exp * 1000
      : Date.now() + 55 * 60_000;

  return {
    token: data.id_token,
    sso,
    authToken,
    memberId: claims.memberId != null ? String(claims.memberId) : null,
    expiresAt,
  };
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
        "ocp-apim-subscription-key": APIM_KEY,
        "X-LTF-SSOID": session.sso,
        "X-LTF-CT": session.authToken,
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
    !!session.authToken &&
    session.expiresAt > Date.now() + 60_000
  );
}
