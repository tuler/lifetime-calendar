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
  /** Raw B2C id_token. Kept for debugging; requests use the fields below. */
  token: string;
  /** `LTF_SSOID` claim → the `X-LTF-SSOID` request header. */
  sso: string;
  /** `LTF_AccessToken` claim → the `X-LTF-CT` request header. */
  authToken: string;
  /** `memberId` claim, used to scope the reservations query. May be absent. */
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
