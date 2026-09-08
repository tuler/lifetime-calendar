export interface Env {
  FEEDS: KVNamespace;
  CACHE_TTL_SECONDS: string;
  SIGNUPS_OPEN: string;
}

/** A single Life Time booking, normalized out of whatever their API returns. */
export interface Reservation {
  /** Stable per booking. Prefer the upstream id; UIDs are derived from it. */
  id: string;
  title: string;
  /** ISO 8601 with offset, e.g. 2026-09-08T17:30:00-05:00 */
  start: string;
  /** ISO 8601 with offset. */
  end: string;
  location: string;
  instructor: string | null;
  /** Bike or station number, when the class assigns one. */
  station: string | null;
  /** Place in line when waitlisted, otherwise null. */
  waitlistPosition: number | null;
  status: "confirmed" | "waitlisted";
  /**
   * Whose booking this is. On a family membership one login sees the whole
   * household, so these are what distinguish the members.
   */
  memberId: string | null;
  /** First name only, as Life Time returns it. */
  memberName: string | null;
}

export interface Session {
  /** Session token — the site's `lt-authentication` value, sent as `X-LTF-CT`. */
  token: string;
  /** The account's SSO id, sent as `X-LTF-SSOID`. */
  sso: string;
  /** Epoch millis. */
  expiresAt: number;
}

/** One person on a household membership. */
export interface Member {
  /** Life Time's `memberId`, matching the one on a reservation row. */
  id: string;
  /** First name only, as Life Time returns it, e.g. "Marina". */
  name: string;
}

export interface Credentials {
  username: string;
  password: string;
  session?: Session;
  /**
   * Which household member this feed is for. `null` means everyone the
   * account can see, which is what a one-person membership gets.
   */
  memberId: string | null;
  /** Only for naming the calendar; `null` alongside a null `memberId`. */
  memberName: string | null;
}

/** AES-GCM ciphertext, both fields base64url. */
export interface SealedBox {
  iv: string;
  ct: string;
}

export interface FeedRecord extends SealedBox {
  createdAt: number;
}
