import { describe, it, expect } from "vitest";
import {
  hoursToDays, daysToHours, intervalLabel, profileStatus, formatRemaining,
  computeStreak, validateConfig, recipientsSummary, profileTitle, moodMeta,
  normalizeEmail, isValidEmail, MAX_EXTERNAL_RECIPIENTS, searchableFields,
} from "../src/logic.js";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

describe("interval helpers", () => {
  it("round-trips days ↔ hours", () => {
    expect(daysToHours(1)).toBe(24);
    expect(daysToHours(0.5)).toBe(12);
    expect(hoursToDays(48)).toBe(2);
  });
  it("labels common intervals", () => {
    expect(intervalLabel(24)).toBe("daily");
    expect(intervalLabel(48)).toBe("every 2 days");
    expect(intervalLabel(12)).toBe("every 12 hours");
  });
  it("guards bad input", () => {
    expect(daysToHours(0)).toBe(24);
    expect(daysToHours(-3)).toBe(24);
    expect(hoursToDays("nope")).toBe(1);
  });
});

describe("profileStatus", () => {
  const now = Date.parse("2026-07-07T12:00:00Z");
  it("is disarmed when not active", () => {
    expect(profileStatus({ active: 0 }, now).state).toBe("disarmed");
  });
  it("is unstarted when armed but no check-in", () => {
    expect(profileStatus({ active: 1, interval_hours: 24, last_checkin_at: null }, now).state).toBe("unstarted");
  });
  it("is ok well within the window", () => {
    const s = profileStatus({ active: 1, interval_hours: 24, last_checkin_at: new Date(now - 2 * HOUR).toISOString() }, now);
    expect(s.state).toBe("ok");
    expect(s.remainingMs).toBeGreaterThan(0);
  });
  it("is due_soon in the last quarter of the window", () => {
    const s = profileStatus({ active: 1, interval_hours: 24, last_checkin_at: new Date(now - 20 * HOUR).toISOString() }, now);
    expect(s.state).toBe("due_soon");
  });
  it("is overdue past the deadline", () => {
    const s = profileStatus({ active: 1, interval_hours: 24, last_checkin_at: new Date(now - 30 * HOUR).toISOString() }, now);
    expect(s.state).toBe("overdue");
    expect(s.overdueMs).toBeGreaterThan(0);
  });
});

describe("computeStreak", () => {
  const now = Date.parse("2026-07-07T18:00:00Z");
  const atDaysAgo = n => ({ checked_at: new Date(now - n * DAY).toISOString() });
  it("is 0 with no check-ins", () => expect(computeStreak([], now)).toBe(0));
  it("counts today + consecutive prior days", () => {
    expect(computeStreak([atDaysAgo(0), atDaysAgo(1), atDaysAgo(2)], now)).toBe(3);
  });
  it("keeps the streak when today is missing but yesterday is present", () => {
    expect(computeStreak([atDaysAgo(1), atDaysAgo(2)], now)).toBe(2);
  });
  it("breaks on a gap", () => {
    expect(computeStreak([atDaysAgo(0), atDaysAgo(2)], now)).toBe(1);
  });
  it("resets to 0 when the last check-in is older than yesterday", () => {
    expect(computeStreak([atDaysAgo(3), atDaysAgo(4)], now)).toBe(0);
  });
  it("dedupes multiple check-ins on the same day", () => {
    expect(computeStreak([atDaysAgo(0), atDaysAgo(0), atDaysAgo(1)], now)).toBe(2);
  });
});

describe("validateConfig", () => {
  it("accepts a sane daily config", () => {
    expect(validateConfig({ intervalDays: 1, message: "hi", recipientEmails: [] })).toBeNull();
  });
  it("rejects an out-of-range window", () => {
    expect(validateConfig({ intervalDays: 30 })).toMatch(/window/);
    expect(validateConfig({ intervalDays: 0.25 })).toMatch(/window/);
  });
  it("rejects too many external contacts", () => {
    const emails = Array.from({ length: MAX_EXTERNAL_RECIPIENTS + 1 }, (_, i) => `a${i}@x.com`);
    expect(validateConfig({ intervalDays: 1, recipientEmails: emails })).toMatch(/external/);
  });
});

describe("recipientsSummary", () => {
  const members = [{ id: "a", name: "Ann" }, { id: "b", name: "Bo" }, { id: "s", name: "Self" }];
  it("defaults to all adults when empty", () => {
    expect(recipientsSummary([], members, "s", [])).toMatch(/all adults/);
  });
  it("excludes the subject and lists names + emails", () => {
    expect(recipientsSummary(["a", "s"], members, "s", ["x@y.com"])).toBe("Ann, x@y.com");
  });
});

describe("profileTitle", () => {
  const members = [{ id: "m1", name: "Grandpa" }];
  it("prefers an explicit label", () => {
    expect(profileTitle({ label: "Morning", member_id: "m1" }, members)).toBe("Morning");
  });
  it("falls back to the member name", () => {
    expect(profileTitle({ label: "", member_id: "m1" }, members)).toBe("Grandpa's check-in");
  });
});

describe("misc", () => {
  it("moodMeta looks up known moods", () => {
    expect(moodMeta("good").emoji).toBe("🙂");
    expect(moodMeta("nope")).toBeNull();
  });
  it("normalizes and validates emails", () => {
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
  });
  it("formats remaining time", () => {
    expect(formatRemaining(2 * DAY + 3 * HOUR)).toBe("2d 3h");
    expect(formatRemaining(90 * 60 * 1000)).toBe("1h 30m");
  });
});

describe("searchableFields", () => {
  it("matches on the person's name and on what they wrote in a check-in", () => {
    const fields = searchableFields({ label: "Mum" }, "Ada Lovelace", "dizzy again this morning");
    expect(fields).toContain("Ada Lovelace");
    expect(fields).toContain("dizzy again this morning");
  });
});
