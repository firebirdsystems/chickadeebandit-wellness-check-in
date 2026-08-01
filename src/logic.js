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
