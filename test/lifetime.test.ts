import { describe, it, expect } from "vitest";
import { normalize, rosterFrom } from "../src/lifetime";

// Captured verbatim from a live `ux/web-schedules/v3/reservations` response,
// Sept 2026. Trimmed to the fields normalize() reads, but not reshaped.
const waitlistedRow = {
  id: "ZXhlcnA6MjU4cDEyNjg3MjoyNThib29rOTE4OTg5",
  memberId: 113746495,
  memberName: "Danilo",
  eventId: "ZXhlcnA6MjU4Ym9vazkxODk4OToyMDI2LTA5LTA4",
  eventName: "Pickleball Open Play: MID INTERMEDIATE (3.0-3.5)",
  location: "Waitlist Spot 7, Indoor Pickleball Court 1 – 3, Princeton",
  locationName: "Princeton",
  instructors: [{ name: "Shahar G." }],
  registration: {
    registeredMembers: [
      { name: "Danilo", id: 113746495, spotWaitlist: 7 },
    ],
    unregisteredMembers: [
      { name: "Marina", id: 113805698, age: 17 },
      { name: "Diego", id: 113805697, age: 17 },
    ],
  },
  start: "2026-09-08T20:30:00-04:00",
  end: "2026-09-08T22:00:00-04:00",
};

describe("normalize", () => {
  it("maps the confirmed fields off a real row", () => {
    const r = normalize(waitlistedRow);
    expect(r.id).toBe("ZXhlcnA6MjU4cDEyNjg3MjoyNThib29rOTE4OTg5");
    expect(r.title).toBe("Pickleball Open Play: MID INTERMEDIATE (3.0-3.5)");
    expect(r.start).toBe("2026-09-08T20:30:00-04:00");
    expect(r.end).toBe("2026-09-08T22:00:00-04:00");
    expect(r.location).toBe(
      "Waitlist Spot 7, Indoor Pickleball Court 1 – 3, Princeton"
    );
  });

  it("reads the instructor out of the `instructors` array", () => {
    expect(normalize(waitlistedRow).instructor).toBe("Shahar G.");
  });

  it("joins multiple instructors", () => {
    const r = normalize({
      ...waitlistedRow,
      instructors: [{ name: "Shahar G." }, { name: "Pat L." }],
    });
    expect(r.instructor).toBe("Shahar G., Pat L.");
  });

  it("reports a waitlist entry as waitlisted, with its position", () => {
    const r = normalize(waitlistedRow);
    expect(r.status).toBe("waitlisted");
    expect(r.waitlistPosition).toBe(7);
    // A waitlist place is not a station assignment.
    expect(r.station).toBeNull();
  });

  it("reads a confirmed booking's spot as the station", () => {
    const r = normalize({
      ...waitlistedRow,
      registration: {
        registeredMembers: [{ name: "Danilo", id: 113746495, spot: 12 }],
      },
    });
    expect(r.status).toBe("confirmed");
    expect(r.station).toBe("12");
    expect(r.waitlistPosition).toBeNull();
  });

  it("carries the member through, so a household feed can be split", () => {
    const r = normalize(waitlistedRow);
    expect(r.memberId).toBe("113746495");
    expect(r.memberName).toBe("Danilo");
  });

  it("picks the right member out of a multi-member registration", () => {
    const r = normalize({
      ...waitlistedRow,
      memberId: 113805698,
      memberName: "Marina",
      registration: {
        registeredMembers: [
          { name: "Danilo", id: 113746495, spotWaitlist: 7 },
          { name: "Marina", id: 113805698, spot: 3 },
        ],
      },
    });
    expect(r.memberName).toBe("Marina");
    expect(r.status).toBe("confirmed");
    expect(r.station).toBe("3");
  });

  it("survives a row with nothing but timestamps", () => {
    const r = normalize({ start: "2026-01-01T00:00:00Z", end: "" });
    expect(r.title).toBe("Life Time reservation");
    expect(r.instructor).toBeNull();
    expect(r.status).toBe("confirmed");
    expect(r.memberId).toBeNull();
  });
});

describe("rosterFrom", () => {
  it("unions the three places a member can appear", () => {
    // Danilo owns the row; the twins only show up as eligible non-registrants.
    expect(rosterFrom([waitlistedRow])).toEqual([
      { id: "113746495", name: "Danilo" },
      { id: "113805697", name: "Diego" },
      { id: "113805698", name: "Marina" },
    ]);
  });

  it("merges across rows, since one event only lists who it is open to", () => {
    const adultsOnly = {
      memberId: 113746495,
      memberName: "Danilo",
      registration: { registeredMembers: [{ name: "Danilo", id: 113746495 }] },
    };
    const openToAll = {
      memberId: 113805698,
      memberName: "Marina",
      registration: {
        registeredMembers: [{ name: "Marina", id: 113805698 }],
        unregisteredMembers: [{ name: "Diego", id: 113805697 }],
      },
    };
    expect(rosterFrom([adultsOnly, openToAll]).map((m) => m.name)).toEqual([
      "Danilo",
      "Diego",
      "Marina",
    ]);
  });

  it("dedupes a member seen many times", () => {
    expect(rosterFrom([waitlistedRow, waitlistedRow, waitlistedRow])).toHaveLength(3);
  });

  it("is empty when the household has no bookings to reveal it", () => {
    expect(rosterFrom([])).toEqual([]);
  });

  it("skips entries missing an id or a name", () => {
    expect(
      rosterFrom([
        {
          memberId: 1,
          registration: {
            registeredMembers: [{ name: "Nameless" }, { id: 2, name: "Real" }],
          },
        },
      ])
    ).toEqual([{ id: "2", name: "Real" }]);
  });
});
