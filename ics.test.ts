import { describe, it, expect } from "vitest";
import { buildIcs } from "../src/ics";
import type { Reservation } from "../src/types";

const sample: Reservation = {
  id: "42",
  title: "Ultra Fit, GT",
  start: "2026-09-08T17:30:00-05:00",
  end: "2026-09-08T18:30:00-05:00",
  location:
    "Life Time Ashburn — Studio 2, a deliberately long location to force folding",
  instructor: "Dana",
  station: "14",
  status: "waitlisted",
};

describe("buildIcs", () => {
  it("emits a well-formed calendar", async () => {
    const ics = await buildIcs("feed1", [sample]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("DTSTART:20260908T223000Z");
    expect(ics).toContain("STATUS:TENTATIVE");
  });

  it("escapes commas in summaries", async () => {
    const ics = await buildIcs("feed1", [sample]);
    expect(ics).toContain("SUMMARY:Ultra Fit\\, GT (waitlist)");
  });

  it("folds lines to 75 octets", async () => {
    const ics = await buildIcs("feed1", [sample]);
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("keeps UIDs stable across rebuilds but distinct per feed", async () => {
    const uid = (s: string) => s.match(/UID:(.+)/)![1];
    const a = uid(await buildIcs("feed1", [sample]));
    const b = uid(await buildIcs("feed1", [sample]));
    const c = uid(await buildIcs("feed2", [sample]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("rejects unparseable dates rather than emitting junk", async () => {
    await expect(
      buildIcs("feed1", [{ ...sample, start: "not a date" }])
    ).rejects.toThrow();
  });
});
