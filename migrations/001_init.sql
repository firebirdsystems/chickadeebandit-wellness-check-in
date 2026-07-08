-- Wellness Check-In
--
-- One profile per monitored person. The person taps "I'm OK" and the hub's
-- inactivity_alerts protocol stamps last_checkin_at (via
-- POST /run/wellness-check-in/api/check-in) and, when a profile's window is
-- overdue, stamps last_alerted_at and emails the recipients from its hourly
-- cron. The care circle (household) reads the profile board; adults configure.
CREATE TABLE IF NOT EXISTS app_wellness_check_in__profiles (
  id                   TEXT    NOT NULL,
  member_id            TEXT    NOT NULL,          -- the monitored person (owner of the profile)
  label                TEXT    NOT NULL DEFAULT '',
  active               INTEGER NOT NULL DEFAULT 0, -- 0 = paused, 1 = monitoring
  interval_hours       INTEGER NOT NULL DEFAULT 24 CHECK (interval_hours > 0), -- silence window before alerting
  message              TEXT    NOT NULL DEFAULT '', -- included in the alert email
  recipient_member_ids TEXT    NOT NULL DEFAULT '[]', -- JSON array of member ids; empty = all adults
  recipient_emails     TEXT    NOT NULL DEFAULT '[]', -- JSON array of external emails; only CONFIRMED ones are alerted
  last_checkin_at      TEXT,                        -- ISO, endpoint-stamped
  last_alerted_at      TEXT,                        -- ISO, cron-stamped (dedupe)
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS profiles_by_member
  ON app_wellness_check_in__profiles (member_id);

-- Visible check-in history for the shared status board (streaks, recent moods).
-- Display-only: the authoritative escalation timer is profiles.last_checkin_at.
-- owner_only forces member_id to the caller on INSERT, so a member can only log
-- their own check-ins.
CREATE TABLE IF NOT EXISTS app_wellness_check_in__checkins (
  id         TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  mood       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS checkins_by_member
  ON app_wellness_check_in__checkins (member_id, checked_at);
