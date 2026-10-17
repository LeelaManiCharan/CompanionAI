import { describe, expect, it } from "vitest";
import type { ActivityLog, CheckIn } from "@/core/models";
import {
  activeSecondsOnDate,
  canSnooze,
  computePreferredTime,
  evaluateSchedule,
  localDate,
  resolveLocalTime,
  snoozeUntil,
} from "@/core/schedule";

const NY = "America/New_York";

let seq = 0;
function log(startedAt: string, endedAt: string): ActivityLog {
  seq += 1;
  return {
    id: `log-${seq}`,
    profileId: "p1",
    startedAt,
    endedAt,
    durationSeconds: Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000),
    page: "/",
  };
}

function checkIn(date: string, partial: Partial<CheckIn> = {}): CheckIn {
  return {
    profileId: "p1",
    date,
    triggeredAt: `${date}T23:00:00.000Z`,
    snoozedUntil: null,
    completedAt: null,
    snoozeFiredAt: null,
    ...partial,
  };
}

describe("localDate", () => {
  it("uses the zone's calendar date", () => {
    expect(localDate("2024-03-10T03:30:00.000Z", NY)).toBe("2024-03-09");
    expect(localDate("2024-03-10T05:00:00.000Z", NY)).toBe("2024-03-10");
    expect(localDate("2024-03-10T11:00:00.000Z", "Pacific/Kiritimati")).toBe("2024-03-11");
  });
});

describe("resolveLocalTime", () => {
  it("resolves a normal time", () => {
    expect(resolveLocalTime("2024-06-01", "19:00", NY)).toBe("2024-06-01T23:00:00.000Z");
  });

  it("moves a spring-forward gap time to the first valid instant after", () => {
    // 02:30 does not exist on 2024-03-10 in New York; clocks jump to 03:00 EDT.
    expect(resolveLocalTime("2024-03-10", "02:30", NY)).toBe("2024-03-10T07:00:00.000Z");
    // Lord Howe skips 02:00–02:30 (+10:30 → +11:00).
    expect(resolveLocalTime("2024-10-06", "02:15", "Australia/Lord_Howe")).toBe("2024-10-05T15:30:00.000Z");
  });

  it("uses the first occurrence of a repeated fall-back time", () => {
    expect(resolveLocalTime("2024-11-03", "01:30", NY)).toBe("2024-11-03T05:30:00.000Z");
  });
});

describe("computePreferredTime", () => {
  const logs = [
    log("2024-05-01T13:05:00.000Z", "2024-05-01T13:35:00.000Z"), // 09:05 EDT
    log("2024-05-02T13:10:00.000Z", "2024-05-02T13:20:00.000Z"), // 09:10
    log("2024-05-03T22:00:00.000Z", "2024-05-03T22:10:00.000Z"), // 18:00
    log("2024-05-04T22:00:00.000Z", "2024-05-04T22:10:00.000Z"), // 18:00 (latest)
  ];

  it("prefers the override", () => {
    expect(computePreferredTime(logs, true, "07:45", NY)).toBe("07:45");
  });

  it("falls back to 19:00 when tracking is off or fewer than 3 dates", () => {
    expect(computePreferredTime(logs, false, null, NY)).toBe("19:00");
    expect(computePreferredTime(logs.slice(0, 2), true, null, NY)).toBe("19:00");
  });

  it("breaks ties by the most recent start", () => {
    expect(computePreferredTime(logs, true, null, NY)).toBe("18:00");
  });
});

describe("evaluateSchedule", () => {
  const base = { timeZone: NY, preferredTime: "19:00", appOpening: false };

  it("waits until the preferred time, then triggers once", () => {
    expect(evaluateSchedule({ ...base, now: "2024-06-01T22:59:00.000Z", today: null })).toBe("none");
    expect(evaluateSchedule({ ...base, now: "2024-06-01T23:00:00.000Z", today: null })).toBe("trigger");
    expect(evaluateSchedule({ ...base, now: "2024-06-01T23:10:00.000Z", today: checkIn("2024-06-01") })).toBe("none");
  });

  it("prompts on open after the preferred time", () => {
    expect(evaluateSchedule({ ...base, appOpening: true, now: "2024-06-02T01:00:00.000Z", today: null })).toBe(
      "prompt_on_open",
    );
  });

  it("fires one snooze reminder on the same date, and none after completion", () => {
    const snoozed = checkIn("2024-06-01", { snoozedUntil: "2024-06-01T23:30:00.000Z" });
    const now = "2024-06-01T23:30:00.000Z";
    expect(evaluateSchedule({ ...base, now: "2024-06-01T23:29:00.000Z", today: snoozed })).toBe("none");
    expect(evaluateSchedule({ ...base, now, today: snoozed })).toBe("snooze_reminder");
    expect(evaluateSchedule({ ...base, now, today: { ...snoozed, snoozeFiredAt: now } })).toBe("none");
    expect(evaluateSchedule({ ...base, now, today: { ...snoozed, completedAt: "2024-06-01T23:20:00.000Z" } })).toBe(
      "none",
    );
  });

  it("drops a snooze reminder that falls on the next date and ignores earlier-date records", () => {
    const lateSnooze = checkIn("2024-06-01", { snoozedUntil: "2024-06-02T04:10:00.000Z" }); // 00:10 local next day
    // Now is 2024-06-02 local; the 06-01 record is ignored and 06-02 is evaluated fresh.
    expect(evaluateSchedule({ ...base, now: "2024-06-02T04:15:00.000Z", today: lateSnooze })).toBe("none");
  });

  it("allows one snooze per date", () => {
    expect(canSnooze(checkIn("2024-06-01"))).toBe(true);
    expect(canSnooze(checkIn("2024-06-01", { snoozedUntil: snoozeUntil("2024-06-01T23:00:00.000Z") }))).toBe(false);
    expect(snoozeUntil("2024-06-01T23:00:00.000Z")).toBe("2024-06-01T23:30:00.000Z");
  });
});

describe("activeSecondsOnDate", () => {
  it("clips sessions at local midnight on a 23-hour DST day", () => {
    // 23:00 Mar 9 EST → 01:00 Mar 10 EST; midnight is 05:00Z.
    const logs = [log("2024-03-10T04:00:00.000Z", "2024-03-10T06:00:00.000Z")];
    expect(activeSecondsOnDate(logs, null, "2024-03-10T12:00:00.000Z", NY)).toBe(3600);
  });

  it("includes the in-progress session up to now", () => {
    expect(
      activeSecondsOnDate([], { startedAt: "2024-03-10T11:00:00.000Z" }, "2024-03-10T11:30:00.000Z", NY),
    ).toBe(1800);
  });
});
