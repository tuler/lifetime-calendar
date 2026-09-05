import type { Reservation } from "./types";

const PRODID = "-//lifetime-calendar//EN";

function escapeText(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 caps lines at 75 octets; continuations start with a space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 73) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const chLen = enc.encode(ch).length;
    if (curLen + chLen > 73) {
      out.push(cur);
      cur = " ";
      curLen = 1;
    }
    cur += ch;
    curLen += chLen;
  }
  out.push(cur);
  return out.join("\r\n");
}

function toUtcStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`bad date: ${iso}`);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * UIDs must be stable across refreshes or Calendar duplicates the event on
 * every poll. Derived from the booking id, scoped to the feed.
 */
async function uidFor(feedId: string, r: Reservation): Promise<string> {
  const basis = r.id || `${r.title}|${r.start}|${r.location}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${feedId}|${basis}`)
  );
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex}@lifetime-calendar`;
}

function describe(r: Reservation): string {
  const parts: string[] = [];
  if (r.instructor) parts.push(`Instructor: ${r.instructor}`);
  if (r.station) parts.push(`Station: ${r.station}`);
  if (r.status === "waitlisted") parts.push("You are on the waitlist.");
  return parts.join("\n");
}

export async function buildIcs(
  feedId: string,
  reservations: Reservation[],
  opts: { ttlMinutes?: number } = {}
): Promise<string> {
  const ttlMinutes = opts.ttlMinutes ?? 30;
  const now = toUtcStamp(new Date().toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "NAME:Life Time",
    "X-WR-CALNAME:Life Time",
    `X-PUBLISHED-TTL:PT${ttlMinutes}M`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${ttlMinutes}M`,
  ];

  for (const r of reservations) {
    const uid = await uidFor(feedId, r);
    const summary =
      r.status === "waitlisted" ? `${r.title} (waitlist)` : r.title;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${toUtcStamp(r.start)}`,
      `DTEND:${toUtcStamp(r.end)}`,
      `SUMMARY:${escapeText(summary)}`
    );
    if (r.location) lines.push(`LOCATION:${escapeText(r.location)}`);
    const desc = describe(r);
    if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
    lines.push(
      r.status === "waitlisted" ? "STATUS:TENTATIVE" : "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
