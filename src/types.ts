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
  status: "confirmed" | "waitlisted";
}

export interface Session {
  /** Session token — the site's `lt-authentication` value, sent as `X-LTF-CT`. */
  token: string;
  /** The account's SSO id, sent as `X-LTF-SSOID`. */
  sso: string;
  /** Scopes the reservations query. Best-effort; may be absent. */
  memberId: string | null;
  /** Epoch millis. */
  expiresAt: number;
}

export interface Credentials {
  username: string;
  password: string;
  session?: Session;
}

/** AES-GCM ciphertext, both fields base64url. */
export interface SealedBox {
  iv: string;
  ct: string;
}

export interface FeedRecord extends SealedBox {
  createdAt: number;
}
