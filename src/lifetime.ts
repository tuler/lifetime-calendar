import type { Reservation, Session } from "./types";

// ---------------------------------------------------------------------------
// Life Time adapter.
//
// Everything site-specific lives in this file. Replace the two TODO blocks with
// what you capture in DevTools; nothing else in the project needs to change.
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Credentials were rejected, or the cached token went stale. */
export class AuthError extends Error {}
/** Life Time returned something we can't use. */
export class UpstreamError extends Error {}

/** Raw shape of one reservation as it comes off the wire. Tighten once known. */
interface RawReservation {
  registrationId?: string | number;
  id?: string | number;
  name?: string;
  className?: string;
  startDateTime?: string;
  endDateTime?: string;
  locationName?: string;
  studioName?: string;
  instructorName?: string;
  stationNumber?: string | number;
  waitlisted?: boolean;
}

export async function login(
  username: string,
  password: string
): Promise<Session> {
  // TODO — replace with the captured login request.
  //
  // const res = await fetch("https://api.lifetimefitness.com/auth/v1/login", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     "User-Agent": UA,
  //     // The SPA sends a static client key header — copy it verbatim from the
  //     // cURL export. It identifies the web app; it is not a secret.
  //     "X-LT-Client": "...",
  //   },
  //   body: JSON.stringify({ username, password }),
  // });
  //
  // if (res.status === 400 || res.status === 401) {
  //   throw new AuthError("Life Time rejected those credentials");
  // }
  // if (!res.ok) throw new UpstreamError(`login failed: ${res.status}`);
  //
  // const data = (await res.json()) as { token: string };
  // return { token: data.token, expiresAt: Date.now() + 55 * 60_000 };

  void username;
  void password;
  void UA;
  throw new UpstreamError("login() is not implemented — see src/lifetime.ts");
}

export async function getReservations(
  session: Session
): Promise<Reservation[]> {
  // TODO — replace with the captured reservations request.
  //
  // const res = await fetch(
  //   "https://api.lifetimefitness.com/sys/registrations/V3/ux/member",
  //   {
  //     headers: {
  //       Accept: "application/json",
  //       "User-Agent": UA,
  //       "X-LT-Token": session.token, // or Authorization: `Bearer ${...}`
  //     },
  //   }
  // );
  //
  // if (res.status === 401) throw new AuthError("session expired");
  // if (!res.ok) throw new UpstreamError(`reservations failed: ${res.status}`);
  //
  // const data = (await res.json()) as RawReservation[];
  // return data.map(normalize);

  void session;
  throw new UpstreamError(
    "getReservations() is not implemented — see src/lifetime.ts"
  );
}

/** Map one raw record onto the shape ics.ts wants. */
export function normalize(raw: RawReservation): Reservation {
  return {
    id: String(raw.registrationId ?? raw.id ?? ""),
    title: raw.name ?? raw.className ?? "Life Time reservation",
    start: raw.startDateTime ?? "",
    end: raw.endDateTime ?? "",
    location: [raw.locationName, raw.studioName].filter(Boolean).join(" — "),
    instructor: raw.instructorName ?? null,
    station: raw.stationNumber != null ? String(raw.stationNumber) : null,
    status: raw.waitlisted ? "waitlisted" : "confirmed",
  };
}

/** Re-logging in on every calendar poll is slow and rude; reuse the token. */
export function sessionIsFresh(session?: Session): session is Session {
  return !!session && !!session.token && session.expiresAt > Date.now() + 60_000;
}
