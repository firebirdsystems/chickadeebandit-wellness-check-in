// Pure, browser-free helpers for Wellness Check-In. Imported by both the app
// (src/index.html) and the unit tests (__tests__/logic.test.mjs).

export const MAX_PROFILES = 20;
export const MAX_EXTERNAL_RECIPIENTS = 10;
export const MIN_INTERVAL_HOURS = 12;
export const MAX_INTERVAL_HOURS = 24 * 14; // two weeks

export const MOODS = [
  { key: "good", emoji: "🙂", label: "Good" },
  { key: "ok", emoji: "😐", label: "OK" },
  { key: "unwell", emoji: "🙁", label: "Not great" },
];

export function moodMeta(key) {
  return MOODS.find(m => m.key === key) ?? null;
}

// ── interval helpers ────────────────────────────────────────────────────────

export function hoursToDays(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 1;
  return Math.round((h / 24) * 100) / 100;
}

export function daysToHours(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 24;
  return Math.round(d * 24);
}

export function intervalLabel(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return "—";
  if (h % 24 === 0) {
    const days = h / 24;
    return days === 1 ? "daily" : `every ${days} days`;
  }
  return h === 1 ? "hourly" : `every ${h} hours`;
}

// ── status ──────────────────────────────────────────────────────────────────
// Mirrors the hub's inactivity_alerts model: a profile is armed (active=1) and
// carries an interval; last_checkin_at anchors the deadline. `now` is injected
// so the logic stays pure and testable.

export function profileStatus(row, now = Date.now()) {
  if (Number(row.active) !== 1) return { state: "disarmed" };
  if (!row.last_checkin_at) return { state: "unstarted" };

  const last = Date.parse(row.last_checkin_at);
  if (Number.isNaN(last)) return { state: "unstarted" };

  const intervalMs = Number(row.interval_hours) * 3600 * 1000;
  const deadline = last + intervalMs;
  const remainingMs = deadline - now;

  if (remainingMs <= 0) return { state: "overdue", overdueMs: -remainingMs };
  // "due soon" once inside the last quarter of the window (min 2h).
  const soonWindow = Math.max(intervalMs * 0.25, 2 * 3600 * 1000);
  if (remainingMs <= soonWindow) return { state: "due_soon", remainingMs };
  return { state: "ok", remainingMs };
}

export function formatRemaining(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ── streak ──────────────────────────────────────────────────────────────────
// Consecutive calendar days (in the viewer's local zone) with at least one
// check-in, counting today if present, otherwise anchored to yesterday so a
// not-yet-checked-in-today person keeps their streak until the day rolls over.

function localDayKey(iso, dayMs) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // dayMs is a reference "start of a day" offset so tests can inject a zone.
  return Math.floor((t - dayMs) / (24 * 3600 * 1000));
}

export function computeStreak(checkins, now = Date.now()) {
  if (!Array.isArray(checkins) || checkins.length === 0) return 0;
  // Use the local-midnight offset so day boundaries follow the viewer's clock.
  const ref = new Date(now);
  const midnight = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  const todayIdx = Math.floor((now - midnight) / (24 * 3600 * 1000)); // == 0
  void todayIdx;

  const days = new Set();
  for (const c of checkins) {
    const t = Date.parse(c.checked_at);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    days.add(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
  }
  if (days.size === 0) return 0;

  const oneDay = 24 * 3600 * 1000;
  let cursor = midnight;
  // If they haven't checked in today yet, start counting from yesterday.
  if (!days.has(cursor)) cursor -= oneDay;
  if (!days.has(cursor)) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= oneDay;
  }
  return streak;
}

// ── validation ──────────────────────────────────────────────────────────────

export function validateConfig(cfg) {
  const hours = daysToHours(cfg.intervalDays);
  if (hours < MIN_INTERVAL_HOURS || hours > MAX_INTERVAL_HOURS) {
    return `Choose a check-in window between ${hoursToDays(MIN_INTERVAL_HOURS)} and ${hoursToDays(MAX_INTERVAL_HOURS)} days.`;
  }
  if ((cfg.message ?? "").length > 2000) return "Message is too long.";
  if (cfg.checkinTime && parseClockTime(cfg.checkinTime) === null) return "Enter the agreed time as a time of day.";
  if ((cfg.recipientEmails?.length ?? 0) > MAX_EXTERNAL_RECIPIENTS) {
    return `You can add up to ${MAX_EXTERNAL_RECIPIENTS} external contacts.`;
  }
  return null;
}

// ── recipients summary ──────────────────────────────────────────────────────

export function recipientsSummary(memberIds, members, selfId, emails = []) {
  const names = (memberIds ?? [])
    .filter(id => id !== selfId)
    .map(id => members.find(m => m.id === id)?.name)
    .filter(Boolean);
  const parts = [];
  if (names.length === 0 && (emails?.length ?? 0) === 0) {
    parts.push("all adults in the household");
  } else {
    parts.push(...names);
    for (const e of emails ?? []) parts.push(e);
  }
  if (parts.length === 0) return "nobody yet";
  if (parts.length <= 3) return parts.join(", ");
  return `${parts.slice(0, 2).join(", ")} +${parts.length - 2} more`;
}

// ── email helpers ───────────────────────────────────────────────────────────

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function isValidEmail(email) {
  const e = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function profileTitle(row, members) {
  const who = members.find(m => m.id === row.member_id)?.name;
  if (row.label) return row.label;
  return who ? `${who}'s check-in` : "Check-in";
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * A board card shows only the last three check-ins, so search is how
 * an older note is reached. The caller passes in the person's name and
 * their check-in text, since the profile row carries neither. Note the
 * app loads the most recent 200 check-ins, so search covers those.
 */
export function searchableFields(profile, memberName = "", checkinText = "") {
  return [profile.label, memberName, checkinText];
}

// ── agreed time ─────────────────────────────────────────────────────────────
// A profile may carry an agreed time of day on top of its silence window. The
// hub's schedule_reminders protocol nudges the person at that time and, when
// there is still no check-in GRACE_MINUTES later, tells the care circle. The
// number mirrors manifest.schedule_reminders.escalation.grace_minutes — the
// board only shows a check-in as missed once the hub has said so too.

export const GRACE_MINUTES = 60;

/** "HH:MM" → minutes since midnight, or null when it is not a clock time. */
export function parseClockTime(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The profile's agreed time as "HH:MM", or null when it has none. */
export function agreedTime(profile) {
  let times;
  try { times = JSON.parse(profile?.checkin_times || "[]"); } catch { return null; }
  if (!Array.isArray(times)) return null;
  return times.find(t => parseClockTime(t) !== null) ?? null;
}

/** What is stored in profiles.checkin_times for a time input's value. */
export function checkinTimesValue(time) {
  return parseClockTime(time) === null ? "[]" : JSON.stringify([String(time).trim()]);
}

/**
 * What is stored in profiles.timed_alert_member_ids.
 *
 * Blank, never "[]", when nobody is picked: the reminder protocol reads an
 * explicit empty list as "this lane is switched off", where this app's own
 * recipients list has always meant "all adults" when empty.
 */
export function timedAlertValue(recipientIds) {
  const ids = (recipientIds ?? []).filter(id => typeof id === "string" && id);
  return ids.length ? JSON.stringify(ids) : "";
}

/** The name a reminder notification uses for this profile. */
export function reminderTitle(label, memberName) {
  const own = String(label ?? "").trim();
  if (own) return own;
  return memberName ? `${memberName}'s check-in` : "Check-in";
}

export function formatClock(time) {
  const minutes = parseClockTime(time);
  if (minutes === null) return "";
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

function zoneOffsetMs(ts, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const f = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);
  // Date.UTC of the LOCAL wall-clock reading minus the real instant is the offset.
  return Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second) - (ts - (ts % 1000));
}

/**
 * The instant (ms) at which the household's clock reads `day` ("yyyy-mm-dd")
 * at `minutes` past midnight.
 *
 * An agreed time is a wall-clock time, but the grace after it is ELAPSED time:
 * the hub resolves the occurrence to an instant and adds real minutes. Adding
 * minutes to the wall-clock reading instead is only right while the offset
 * holds still — on the night the clocks go forward, 01:30 plus an hour of
 * wall clock is 03:00, which is thirty real minutes later.
 *
 * Mirrors the hub's own resolution (household-date.ts `utcFromLocalTime`), so
 * the board and the scheduler agree to the minute: a time repeated when the
 * clocks go back is the EARLIER of the two; one skipped when they go forward
 * moves on by the size of the gap (02:30 → 03:30).
 *
 * Without a usable zone it reads the device's clock, like the SDK's hubToday.
 */
export function instantFromLocal(day, minutes, timeZone = null) {
  const [y, m, d] = String(day).split("-").map(Number);
  if (timeZone) {
    try {
      const wall = Date.UTC(y, m - 1, d) + minutes * 60_000;
      // Sample both sides of the target: a transition yields two offsets.
      const offsets = new Set([
        zoneOffsetMs(wall - 36 * 3600_000, timeZone),
        zoneOffsetMs(wall, timeZone),
        zoneOffsetMs(wall + 36 * 3600_000, timeZone),
      ]);
      const candidates = [...offsets].map(offset => {
        const ts = wall - offset;
        return { ts, localWall: ts + zoneOffsetMs(ts, timeZone) };
      });
      const exact = candidates.filter(c => c.localWall === wall).sort((a, b) => a.ts - b.ts);
      if (exact.length) return exact[0].ts;
      const after = candidates.filter(c => c.localWall > wall).sort((a, b) => a.localWall - b.localWall || a.ts - b.ts);
      if (after.length) return after[0].ts;
      return Math.max(...candidates.map(c => c.ts));
    } catch { /* unusable zone — fall through to the device clock */ }
  }
  return new Date(y, m - 1, d, 0, minutes).getTime();
}

// ── requests ────────────────────────────────────────────────────────────────
// A request is something one relative should take: a call the person asked
// for, a missed check-in, a missed dose. It is open until someone takes it,
// claimed while they have it, and done once they record what happened.

export const MAX_NOTE_LENGTH = 500;

const REQUEST_KINDS = {
  call: { glyph: "phone", label: "call request", headline: (name) => `${name} asked for a call` },
  missed_checkin: { glyph: "clock", label: "missed check-in", headline: (name) => `${name} missed a check-in` },
  missed_dose: { glyph: "pill", label: "missed dose", headline: (name) => `${name} missed a dose` },
};

export function requestKind(kind) {
  return REQUEST_KINDS[kind] ?? { glyph: "dot", label: "request", headline: (name) => `${name} needs a hand` };
}

/**
 * open | claimed | done. A claimed row with nobody on it is OPEN: that is what
 * is left when the relative who took it leaves the household, and it must go
 * back on the board rather than look handled forever.
 */
export function requestState(row) {
  if (row?.status === "done") return "done";
  if (row?.status === "claimed" && row.claimed_by) return "claimed";
  return "open";
}

/** Someone other than the person it is about takes an open request. */
export function canClaim(row, memberId, canHandle) {
  return !!canHandle && !!memberId && requestState(row) === "open" && row.member_id !== memberId;
}

/** Only whoever holds a request closes it or hands it back. */
export function canResolve(row, memberId) {
  return !!memberId && requestState(row) === "claimed" && row.claimed_by === memberId;
}

/** The person who asked for a call may withdraw it until someone takes it. */
export function canCancel(row, memberId) {
  return !!memberId && row?.kind === "call" && requestState(row) === "open" && row.member_id === memberId;
}

/** What the person a request is about reads under their own check-in. */
export function requestStatusLine(row, nameOf) {
  const state = requestState(row);
  if (state === "open") return "No one has picked this up yet.";
  const who = nameOf(row.claimed_by);
  return state === "claimed" ? `${who} is handling this.` : `${who} followed up.`;
}

/** Unclaimed first, then oldest first — the longest wait is at the top. */
export function sortRequests(rows) {
  const rank = { open: 0, claimed: 1, done: 2 };
  return [...rows].sort((a, b) =>
    rank[requestState(a)] - rank[requestState(b)]
    || String(a.created_at).localeCompare(String(b.created_at)));
}

export function validateNote(note, { required = false } = {}) {
  const text = String(note ?? "").trim();
  if (required && !text) return "Add a short note about what happened.";
  if (text.length > MAX_NOTE_LENGTH) return `Keep the note under ${MAX_NOTE_LENGTH} characters.`;
  return null;
}

/** The source key of the request for one profile's missed check-in on one day. */
export function missedSourceKey(profileId, date) {
  return `checkin:${profileId}:${date}`;
}

/** The calendar day before a "yyyy-mm-dd" day. */
export function previousDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** When the care circle is told about the agreed time due on `day`: the occurrence plus the grace, in real minutes. */
function graceDeadline(due, day, timeZone) {
  return instantFromLocal(day, due, timeZone) + GRACE_MINUTES * 60_000;
}

/**
 * The agreed-time occurrence the care circle has been told about most
 * recently: `{ date }` once its grace has run out, else null.
 *
 * An agreed time late in the evening runs out of grace AFTER midnight — 23:30
 * is escalated at 00:30 — so the occurrence that matters in the small hours
 * belongs to yesterday. Looking only at today's would mean the hub tells the
 * family and the board has nothing for anyone to take. Yesterday's counts only
 * when its deadline falls today; an ordinary daytime miss does not carry over.
 */
export function escalatedOccurrence(profile, today, now, timeZone = null) {
  const due = parseClockTime(agreedTime(profile));
  if (due === null) return null;
  if (now >= graceDeadline(due, today, timeZone)) return { date: today };
  const yesterday = previousDay(today);
  const carried = graceDeadline(due, yesterday, timeZone);
  if (carried >= instantFromLocal(today, 0, timeZone) && now >= carried) return { date: yesterday };
  return null;
}

/**
 * The household day a check-in made now is recorded under. Normally today.
 * Just after midnight, while yesterday's late agreed time is still inside its
 * grace, it is yesterday: the hub matches a check-in to an occurrence by that
 * occurrence's own date, so a check-in at 00:10 filed under the new day would
 * leave last night's 23:30 unanswered and the family alerted anyway.
 */
export function checkinDateFor(profile, today, now, timeZone = null) {
  const due = parseClockTime(agreedTime(profile));
  if (due === null) return today;
  const yesterday = previousDay(today);
  return now < graceDeadline(due, yesterday, timeZone) ? yesterday : today;
}

/**
 * Profiles that have missed a check-in with nobody on it yet, each with the
 * reason and the household day it belongs to: "agreed" when an agreed time
 * passed, grace included, with no check-in since; "window" when the silence
 * window ran out. Derived on every render instead of stored: a quiet day
 * writes nothing, and the row only exists once a relative takes it.
 *
 * One per profile per day (`date` is what the request is keyed on). Someone
 * still silent tomorrow is raised again tomorrow, which is what a relative
 * would want to know.
 *
 * `dayOf(iso)` names the household day an instant fell on. Check-ins written
 * before the agreed time existed carry no checkin_date, so the timestamp is
 * the fallback.
 */
export function missedCheckins(profiles, checkins, requests, { today, dayOf, now = Date.now(), timeZone = null }) {
  const taken = new Set((requests ?? []).map(r => r.source_event_id).filter(Boolean));
  const out = [];
  for (const p of profiles ?? []) {
    if (Number(p.active) !== 1) continue;
    const occurrence = escalatedOccurrence(p, today, now, timeZone);
    if (occurrence) {
      // Someone already has that occurrence: nothing more to raise for it,
      // and not a second item for the same silence under the window either.
      if (taken.has(missedSourceKey(p.id, occurrence.date))) continue;
      // Any check-in on or after the occurrence's day answers it — including
      // one made late, after the family was told.
      const answered = (checkins ?? []).some(c =>
        c.member_id === p.member_id && (c.checkin_date ?? dayOf(c.checked_at)) >= occurrence.date);
      if (!answered) { out.push({ profile: p, reason: "agreed", date: occurrence.date }); continue; }
    }
    if (profileStatus(p, now).state === "overdue" && !taken.has(missedSourceKey(p.id, today))) {
      out.push({ profile: p, reason: "window", date: today });
    }
  }
  return out;
}

/**
 * Whether the sender can tell who a request's notification is for. They can
 * with the person's profile in hand. Without it they can only when they would
 * have it if it existed: `readsTheirProfile` is true for whoever supervises
 * (and for the person themself), and then no profile means nobody was chosen,
 * so all adults. The caller reads the profiles afresh before asking, and
 * sends nothing if that read fails. Otherwise the profile may exist unread,
 * with relatives chosen on it (a relative taking part in a shared space), and
 * nothing is sent: "all adults" would be a guess that tells people who were
 * never chosen. The board shows them the change instead.
 */
export function knowsRequestAudience(profile, readsTheirProfile) {
  return !!profile || readsTheirProfile === true;
}

/**
 * Who a request's notification goes to: the profile's chosen relatives without
 * the sender, or every adult when none are chosen. A chosen list the sender
 * was the only one on comes back empty, and nothing is sent: it does not
 * widen to all adults. A sender who is not an adult may only address "adults"
 * under the household's default notification policy, so they always get that
 * audience.
 */
export function notifyAudience(profile, senderId, senderIsAdult) {
  let ids = [];
  try { ids = JSON.parse(profile?.recipient_member_ids || "[]"); } catch { ids = []; }
  const chosen = (Array.isArray(ids) ? ids : []).filter(id => typeof id === "string" && id);
  if (!senderIsAdult || !chosen.length) return "adults";
  return chosen.filter(id => id !== senderId);
}

function isAdultMember(member) {
  return !!member && (member.role === "adult" || member.role === "admin");
}

/**
 * Whether a member looks after the whole care circle: reads everyone's
 * profiles and check-ins and sets up a profile for someone else. Mirrors the
 * hub's rule for those two tables (adult_writable with a member read column,
 * owner_only with adults_bypass): any adult in a household, and only the
 * steward in a shared space. An adult who merely takes part in a space reads
 * and writes their own profile and check-ins alone. Requests are wider than
 * this: see takesOthersRequests.
 */
export function supervisesCareCircle(member, { tenantKind = "household", isAdmin = false } = {}) {
  return tenantKind === "household" ? isAdultMember(member) : isAdmin === true;
}

/**
 * Whether a member may change, pause or delete a profile. Whoever supervises
 * the care circle manages every profile; any other adult manages their own,
 * except in a roster, where the steward alone writes profiles.
 */
export function canManageProfile(profile, member, tenant = {}) {
  if (!profile || !member) return false;
  if (supervisesCareCircle(member, tenant)) return true;
  return tenant.spaceKind !== "roster" && isAdultMember(member) && profile.member_id === member.id;
}

/**
 * The members a new profile may be set up for. Whoever supervises picks from
 * everyone without one. Any other adult may only add themself (the hub
 * refuses a profile they create for someone else), and nobody in a roster.
 * `profiles` is what the member can read, so for them it holds only their own.
 */
export function profileSubjects(members, profiles, member, tenant = {}) {
  if (!member) return [];
  const taken = new Set((profiles ?? []).map(p => p.member_id));
  const free = (members ?? []).filter(m => !taken.has(m.id));
  if (supervisesCareCircle(member, tenant)) return free;
  if (tenant.spaceKind === "roster" || !isAdultMember(member)) return [];
  return free.filter(m => m.id === member.id);
}

/**
 * Whether a member may open a request about someone else, which is what
 * picking up a missed check-in does. Mirrors the hub's supervisor_assigns_owner
 * grant on the requests table: whoever supervises the care circle, except in a
 * co-parenting space, where a request one parent opens is recorded as their own.
 */
export function opensRequestsForOthers(member, tenant = {}) {
  return tenant.spaceKind !== "coparenting" && supervisesCareCircle(member, tenant);
}

/**
 * Whether a member may take a request about someone else. Every request is
 * readable, and so writable, by any adult (owner_or_visibility with the
 * 'adults' value) in a household and in a shared space. A roster is the
 * exception: there the hub keeps a member's writes to their own rows, so only
 * the steward takes one.
 */
export function takesOthersRequests(member, tenant = {}) {
  if (tenant.spaceKind === "roster") return tenant.isAdmin === true;
  return isAdultMember(member);
}
