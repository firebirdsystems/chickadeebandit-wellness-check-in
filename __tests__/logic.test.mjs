import { describe, it, expect } from "vitest";
import {
  hoursToDays, daysToHours, intervalLabel, profileStatus, formatRemaining,
  computeStreak, validateConfig, recipientsSummary, profileTitle, moodMeta,
  normalizeEmail, isValidEmail, MAX_EXTERNAL_RECIPIENTS, searchableFields,
} from "../src/logic.js";
import * as L from "../src/logic.js";

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

// ── agreed time ─────────────────────────────────────────────────────────────

describe("agreed time", () => {
  it("parses clock times and refuses anything else", () => {
    expect(L.parseClockTime("00:00")).toBe(0);
    expect(L.parseClockTime("10:05")).toBe(605);
    expect(L.parseClockTime("23:59")).toBe(1439);
    for (const bad of ["24:00", "9:00", "10:60", "", null, "ten"]) expect(L.parseClockTime(bad)).toBeNull();
  });

  it("reads a profile's agreed time, and none from a profile without one", () => {
    expect(L.agreedTime({ checkin_times: '["10:00"]' })).toBe("10:00");
    expect(L.agreedTime({ checkin_times: "[]" })).toBeNull();
    expect(L.agreedTime({})).toBeNull();
    expect(L.agreedTime({ checkin_times: "not json" })).toBeNull();
    expect(L.agreedTime({ checkin_times: '["soon","08:30"]' })).toBe("08:30");
  });

  it("stores a time as a one-item list and no time as an empty list", () => {
    expect(L.checkinTimesValue("10:00")).toBe('["10:00"]');
    expect(L.checkinTimesValue("")).toBe("[]");
    expect(L.agreedTime({ checkin_times: L.checkinTimesValue("07:15") })).toBe("07:15");
  });

  it("never stores an empty list as the timed audience: blank means all adults, [] would mean nobody", () => {
    expect(L.timedAlertValue([])).toBe("");
    expect(L.timedAlertValue(undefined)).toBe("");
    expect(L.timedAlertValue([""])).toBe("");
    expect(L.timedAlertValue(["m1", "m2"])).toBe('["m1","m2"]');
  });

  it("names the reminder after the label, else the person", () => {
    expect(L.reminderTitle("Morning check-in", "Joe")).toBe("Morning check-in");
    expect(L.reminderTitle("  ", "Joe")).toBe("Joe's check-in");
    expect(L.reminderTitle("", undefined)).toBe("Check-in");
  });

  it("formats a clock time for reading", () => {
    expect(L.formatClock("00:05")).toBe("12:05 AM");
    expect(L.formatClock("10:00")).toBe("10:00 AM");
    expect(L.formatClock("12:30")).toBe("12:30 PM");
    expect(L.formatClock("21:45")).toBe("9:45 PM");
    expect(L.formatClock("nope")).toBe("");
  });

  it("validateConfig refuses a malformed agreed time and accepts none", () => {
    const base = { intervalDays: 1, message: "", recipientEmails: [] };
    expect(L.validateConfig({ ...base, checkinTime: "" })).toBeNull();
    expect(L.validateConfig({ ...base, checkinTime: "10:00" })).toBeNull();
    expect(L.validateConfig({ ...base, checkinTime: "25:00" })).toMatch(/time of day/);
  });
});

describe("missedCheckins", () => {
  const today = "2026-03-10";
  const dayOf = (iso) => String(iso).slice(0, 10);
  // Minutes past midnight on `today`, as an instant in a household on UTC.
  const nowAt = (minutes) => Date.parse(`${today}T00:00:00Z`) + minutes * 60_000;
  // Checked in yesterday morning: well inside a two-day window at 11:00 today.
  const profile = {
    id: "p1", member_id: "joe", active: 1, interval_hours: 48,
    last_checkin_at: "2026-03-09T08:00:00Z", checkin_times: '["10:00"]',
  };
  const at = (hhmm) => L.parseClockTime(hhmm);
  const missed = (over = {}) => L.missedCheckins(
    over.profiles ?? [profile], over.checkins ?? [], over.requests ?? [],
    { today, now: nowAt(over.nowMinutes ?? at("11:00")), timeZone: "UTC", dayOf },
  ).map(m => `${m.profile.id}:${m.reason}`);

  it("an agreed time is missed only once the grace has run out", () => {
    expect(missed({ nowMinutes: at("10:00") })).toEqual([]);
    expect(missed({ nowMinutes: at("10:00") + L.GRACE_MINUTES - 1 })).toEqual([]);
    expect(missed({ nowMinutes: at("10:00") + L.GRACE_MINUTES })).toEqual(["p1:agreed"]);
  });

  it("is not missed after a check-in today, early or late", () => {
    expect(missed({ checkins: [{ member_id: "joe", checkin_date: today, checked_at: "x" }] })).toEqual([]);
    // A row from before the agreed time existed has no checkin_date.
    expect(missed({ checkins: [{ member_id: "joe", checked_at: `${today}T07:00:00Z` }] })).toEqual([]);
  });

  it("is still missed after yesterday's check-in or someone else's", () => {
    expect(missed({ checkins: [{ member_id: "joe", checkin_date: "2026-03-09" }] })).toEqual(["p1:agreed"]);
    expect(missed({ checkins: [{ member_id: "ann", checkin_date: today }] })).toEqual(["p1:agreed"]);
  });

  it("a silence window that ran out is missed too, with or without an agreed time", () => {
    const quiet = { ...profile, interval_hours: 24, checkin_times: "[]" };
    expect(missed({ profiles: [quiet] })).toEqual(["p1:window"]);
    expect(missed({ profiles: [{ ...quiet, interval_hours: 48 }] })).toEqual([]);
    // Before the agreed time's grace is up, the window is what says so.
    expect(missed({ profiles: [{ ...quiet, checkin_times: '["10:00"]' }], nowMinutes: at("09:00") })).toEqual(["p1:window"]);
  });

  it("raises one item per person, naming the agreed time when both ran out", () => {
    expect(missed({ profiles: [{ ...profile, interval_hours: 24 }] })).toEqual(["p1:agreed"]);
  });

  it("skips paused profiles and ones still waiting for a first check-in", () => {
    expect(missed({ profiles: [{ ...profile, active: 0 }] })).toEqual([]);
    expect(missed({ profiles: [{ ...profile, checkin_times: "[]", last_checkin_at: null }] })).toEqual([]);
  });

  it("carries the day each miss belongs to, which is what its request is keyed on", () => {
    const [m] = L.missedCheckins([profile], [], [], { today, now: nowAt(at("11:00")), timeZone: "UTC", dayOf });
    expect(m.date).toBe(today);
  });

  describe("an agreed time whose grace runs past midnight", () => {
    const late = { ...profile, checkin_times: '["23:30"]' };
    const yesterday = "2026-03-09";
    const lateMissed = (nowMinutes, over = {}) => L.missedCheckins(
      [late], over.checkins ?? [], over.requests ?? [], { today, now: nowAt(nowMinutes), timeZone: "UTC", dayOf },
    ).map(m => `${m.reason}:${m.date}`);

    it("is raised after midnight, under the day it was due", () => {
      expect(lateMissed(at("00:29"))).toEqual([]);
      expect(lateMissed(at("00:30"))).toEqual([`agreed:${yesterday}`]);
      expect(lateMissed(at("09:00"))).toEqual([`agreed:${yesterday}`]);
    });

    it("is answered by a check-in filed under either day", () => {
      expect(lateMissed(at("00:30"), { checkins: [{ member_id: "joe", checkin_date: yesterday }] })).toEqual([]);
      expect(lateMissed(at("09:00"), { checkins: [{ member_id: "joe", checkin_date: today }] })).toEqual([]);
      expect(lateMissed(at("09:00"), { checkins: [{ member_id: "joe", checkin_date: "2026-03-08" }] })).toEqual([`agreed:${yesterday}`]);
    });

    it("is deduplicated on the day it was due, and does not come back as a window item", () => {
      const overdue = { ...late, interval_hours: 12 };
      const taken = [{ source_event_id: L.missedSourceKey("p1", yesterday) }];
      expect(L.missedCheckins([overdue], [], taken, { today, now: nowAt(at("00:45")), timeZone: "UTC", dayOf })).toEqual([]);
      // Today's key is a different occurrence and does not hide last night's.
      expect(lateMissed(at("00:45"), { requests: [{ source_event_id: L.missedSourceKey("p1", today) }] })).toEqual([`agreed:${yesterday}`]);
    });

    it("exactly at the day's end, 23:00 escalates at midnight", () => {
      const eleven = { ...profile, checkin_times: '["23:00"]' };
      const run = (n) => L.missedCheckins([eleven], [], [], { today, now: nowAt(n), timeZone: "UTC", dayOf }).map(m => m.date);
      expect(run(at("00:00"))).toEqual([yesterday]);
      expect(run(at("22:59"))).toEqual([yesterday]);
    });
  });

  // The hub adds the grace as ELAPSED minutes to the occurrence's instant. The
  // board must agree with it on the two nights a year the clocks move.
  describe("across a daylight-saving change (America/Denver)", () => {
    const tz = "America/Denver";
    // Last heard from the day before, well inside a two-day window, so only
    // the agreed time can raise anything.
    const p = (time, day) => ({ ...profile, interval_hours: 48, last_checkin_at: `${L.previousDay(day)}T12:00:00Z`, checkin_times: `["${time}"]` });
    const run = (time, day, iso) => L.missedCheckins([p(time, day)], [], [], {
      today: day, now: Date.parse(iso), timeZone: tz, dayOf,
    }).map(m => `${m.reason}:${m.date}`);

    it("resolves a local time to the instant the hub would", () => {
      expect(L.instantFromLocal("2026-03-07", 90, tz)).toBe(Date.parse("2026-03-07T08:30:00Z")); // MST
      expect(L.instantFromLocal("2026-03-09", 90, tz)).toBe(Date.parse("2026-03-09T07:30:00Z")); // MDT
      expect(L.instantFromLocal("2026-03-10", 600, "UTC")).toBe(Date.parse("2026-03-10T10:00:00Z"));
      // 02:30 does not exist on the night the clocks go forward: it moves on to 03:30.
      expect(L.instantFromLocal("2026-03-08", 150, tz)).toBe(Date.parse("2026-03-08T09:30:00Z"));
      // 01:30 happens twice on the night they go back: the earlier one.
      expect(L.instantFromLocal("2026-11-01", 90, tz)).toBe(Date.parse("2026-11-01T07:30:00Z"));
    });

    it("clocks forward: 01:30 is missed a real hour later, at 03:30 on the wall, not at 03:00", () => {
      const day = "2026-03-08"; // 01:30 MST = 08:30Z; 02:00 → 03:00
      expect(run("01:30", day, "2026-03-08T09:00:00Z")).toEqual([]); // 03:00 MDT, 30 real minutes in
      expect(run("01:30", day, "2026-03-08T09:29:00Z")).toEqual([]);
      expect(run("01:30", day, "2026-03-08T09:30:00Z")).toEqual([`agreed:${day}`]); // 03:30 MDT
    });

    it("clocks back: 01:30 is missed a real hour later, at the second 01:30, not at 02:30", () => {
      const day = "2026-11-01"; // first 01:30 is MDT = 07:30Z
      expect(run("01:30", day, "2026-11-01T08:29:00Z")).toEqual([]);
      expect(run("01:30", day, "2026-11-01T08:30:00Z")).toEqual([`agreed:${day}`]); // 01:30 MST
    });

    it("a late agreed time on the night the clocks go forward still carries past midnight", () => {
      // 23:30 MST on the 7th = 06:30Z on the 8th; told at 07:30Z = 00:30 MST.
      expect(run("23:30", "2026-03-08", "2026-03-08T07:29:00Z")).toEqual([]);
      expect(run("23:30", "2026-03-08", "2026-03-08T07:30:00Z")).toEqual(["agreed:2026-03-07"]);
      expect(L.checkinDateFor(p("23:30", "2026-03-08"), "2026-03-08", Date.parse("2026-03-08T07:10:00Z"), tz)).toBe("2026-03-07");
      expect(L.checkinDateFor(p("23:30", "2026-03-08"), "2026-03-08", Date.parse("2026-03-08T07:30:00Z"), tz)).toBe("2026-03-08");
    });

    it("falls back to the device clock on a missing or unusable zone", () => {
      const device = new Date(2026, 2, 10, 0, 600).getTime();
      expect(L.instantFromLocal("2026-03-10", 600, null)).toBe(device);
      expect(L.instantFromLocal("2026-03-10", 600, "Not/AZone")).toBe(device);
    });
  });

  describe("checkinDateFor", () => {
    const late = { checkin_times: '["23:30"]' };
    it("is today for any ordinary time of day", () => {
      expect(L.checkinDateFor({ checkin_times: '["10:00"]' }, today, nowAt(at("00:10")), "UTC")).toBe(today);
      expect(L.checkinDateFor({ checkin_times: "[]" }, today, nowAt(at("00:10")), "UTC")).toBe(today);
      expect(L.checkinDateFor(late, today, nowAt(at("23:40")), "UTC")).toBe(today);
    });
    it("is yesterday just after midnight, while last night's agreed time is still in its grace", () => {
      expect(L.checkinDateFor(late, today, nowAt(at("00:10")), "UTC")).toBe("2026-03-09");
      expect(L.checkinDateFor(late, today, nowAt(at("00:29")), "UTC")).toBe("2026-03-09");
      expect(L.checkinDateFor(late, today, nowAt(at("00:30")), "UTC")).toBe(today);
    });
    it("steps back across a month and a year", () => {
      expect(L.previousDay("2026-03-01")).toBe("2026-02-28");
      expect(L.previousDay("2026-01-01")).toBe("2025-12-31");
    });
  });

  it("drops off the list once a relative has taken it, for that day only", () => {
    expect(missed({ requests: [{ source_event_id: L.missedSourceKey("p1", today) }] })).toEqual([]);
    expect(missed({ requests: [{ source_event_id: L.missedSourceKey("p1", "2026-03-09") }] })).toEqual(["p1:agreed"]);
  });
});

// ── requests ────────────────────────────────────────────────────────────────

describe("requests", () => {
  const open = { id: "r1", member_id: "joe", kind: "call", status: "open", claimed_by: null };
  const claimed = { ...open, status: "claimed", claimed_by: "maria" };
  const done = { ...claimed, status: "done" };
  const orphaned = { ...open, status: "claimed", claimed_by: null };

  it("a claimed request with nobody on it is open again", () => {
    expect(L.requestState(open)).toBe("open");
    expect(L.requestState(claimed)).toBe("claimed");
    expect(L.requestState(done)).toBe("done");
    expect(L.requestState(orphaned)).toBe("open");
    expect(L.requestState({ ...orphaned, claimed_by: "" })).toBe("open");
  });

  it("only someone who handles requests, and not the person it is about, can take an open one", () => {
    expect(L.canClaim(open, "maria", true)).toBe(true);
    expect(L.canClaim(orphaned, "maria", true)).toBe(true);
    expect(L.canClaim(open, "maria", false)).toBe(false);
    expect(L.canClaim(open, "joe", true)).toBe(false);
    expect(L.canClaim(claimed, "dev", true)).toBe(false);
    expect(L.canClaim(done, "dev", true)).toBe(false);
  });

  it("only whoever holds a request closes it or hands it back", () => {
    expect(L.canResolve(claimed, "maria")).toBe(true);
    expect(L.canResolve(claimed, "dev")).toBe(false);
    expect(L.canResolve(open, "maria")).toBe(false);
    expect(L.canResolve(done, "maria")).toBe(false);
  });

  it("the asker withdraws their own call request, and only while nobody has it", () => {
    expect(L.canCancel(open, "joe")).toBe(true);
    expect(L.canCancel(open, "maria")).toBe(false);
    expect(L.canCancel(claimed, "joe")).toBe(false);
    expect(L.canCancel({ ...open, kind: "missed_dose" }, "joe")).toBe(false);
  });

  it("tells the person who has it", () => {
    const nameOf = (id) => ({ maria: "Maria" })[id] ?? "Someone";
    expect(L.requestStatusLine(open, nameOf)).toBe("No one has picked this up yet.");
    expect(L.requestStatusLine(orphaned, nameOf)).toBe("No one has picked this up yet.");
    expect(L.requestStatusLine(claimed, nameOf)).toBe("Maria is handling this.");
    expect(L.requestStatusLine(done, nameOf)).toBe("Maria followed up.");
  });

  it("puts unclaimed first, then the longest wait", () => {
    const rows = [
      { ...claimed, id: "c", created_at: "2026-03-10T08:00:00Z" },
      { ...open, id: "late", created_at: "2026-03-10T10:00:00Z" },
      { ...done, id: "d", created_at: "2026-03-10T07:00:00Z" },
      { ...open, id: "early", created_at: "2026-03-10T09:00:00Z" },
    ];
    expect(L.sortRequests(rows).map(r => r.id)).toEqual(["early", "late", "c", "d"]);
    expect(rows[0].id).toBe("c"); // not sorted in place
  });

  it("names each kind, and survives one it does not know", () => {
    expect(L.requestKind("call").headline("Joe")).toBe("Joe asked for a call");
    expect(L.requestKind("missed_checkin").headline("Joe")).toBe("Joe missed a check-in");
    expect(L.requestKind("missed_dose").headline("Joe")).toBe("Joe missed a dose");
    expect(L.requestKind("something_new").headline("Joe")).toBe("Joe needs a hand");
  });

  it("requires a follow-up note but not a call reason, and caps both", () => {
    expect(L.validateNote("")).toBeNull();
    expect(L.validateNote("  ", { required: true })).toMatch(/what happened/);
    expect(L.validateNote("Called, all fine.", { required: true })).toBeNull();
    expect(L.validateNote("x".repeat(L.MAX_NOTE_LENGTH + 1))).toMatch(/under/);
  });

  it("notifies the chosen relatives, minus the sender, or all adults when none are chosen", () => {
    const p = { recipient_member_ids: '["maria","dev"]' };
    expect(L.notifyAudience(p, "joe", true)).toEqual(["maria", "dev"]);
    expect(L.notifyAudience(p, "maria", true)).toEqual(["dev"]);
    expect(L.notifyAudience({ recipient_member_ids: "[]" }, "joe", true)).toBe("adults");
    expect(L.notifyAudience({ recipient_member_ids: '["maria"]' }, "maria", true)).toBe("adults");
    expect(L.notifyAudience(null, "joe", true)).toBe("adults");
    expect(L.notifyAudience({ recipient_member_ids: "oops" }, "joe", true)).toBe("adults");
  });

  it("a sender who is not an adult always addresses adults, which the hub's default policy allows", () => {
    expect(L.notifyAudience({ recipient_member_ids: '["maria"]' }, "kid", false)).toBe("adults");
  });
});
