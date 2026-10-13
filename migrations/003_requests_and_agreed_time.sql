-- Hand-offs and an agreed check-in time.
--
-- Until now an alert went out and stopped there: nobody could see whether
-- someone had picked it up. `requests` is the missing half — a call the person
-- asks for, a missed check-in or a missed dose stays on the board until one
-- relative takes it, and closes with a note about what happened.
CREATE TABLE IF NOT EXISTS app_wellness_check_in__requests (
  id              TEXT NOT NULL,
  member_id       TEXT NOT NULL,                -- the person the request is about
  kind            TEXT NOT NULL DEFAULT 'call', -- call | missed_checkin | missed_dose
  status          TEXT NOT NULL DEFAULT 'open', -- open | claimed | done
  note            TEXT NOT NULL DEFAULT '',     -- the person's own words on a call request
  claimed_by      TEXT,                         -- NULL = nobody; nulled if that member leaves
  claimed_at      TEXT,
  followup_note   TEXT NOT NULL DEFAULT '',
  closed_at       TEXT,
  -- What produced the row, when something other than a tap on "Request a call"
  -- did: an automation's event id, or `checkin:<profile>:<date>` for a missed
  -- check-in a relative picked up from the board. NULL for a call request.
  source_event_id TEXT,
  -- The HOUSEHOLD's day the request was raised, for the Today list. created_at
  -- is a UTC instant and names the wrong day all evening west of Greenwich.
  -- NULL on a row an automation opened, which Today treats as already due.
  opened_on       TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS requests_by_member
  ON app_wellness_check_in__requests (member_id, created_at);
CREATE INDEX IF NOT EXISTS requests_by_created
  ON app_wellness_check_in__requests (created_at);
-- Recent history is read by status in creation order (the board's "Recently
-- handled"); unfinished work is read through requests_by_created.
CREATE INDEX IF NOT EXISTS requests_by_status
  ON app_wellness_check_in__requests (status, created_at);
-- One row per source: two relatives tapping "I've got this" on the same missed
-- check-in must not open two requests, and the automation dispatcher's dedupe
-- guard reads this column before it writes.
CREATE UNIQUE INDEX IF NOT EXISTS requests_by_source
  ON app_wellness_check_in__requests (source_event_id)
  WHERE source_event_id IS NOT NULL;

-- An agreed time of day (hub `schedule_reminders` protocol), alongside the
-- silence window, which stays as the backstop. A JSON list of "HH:MM"; '[]'
-- means no agreed time, so existing profiles keep behaving exactly as before.
ALTER TABLE app_wellness_check_in__profiles ADD COLUMN checkin_times TEXT NOT NULL DEFAULT '[]';
-- What the reminder is called in a notification. The label is optional, and a
-- relative watching two people needs more than the app's name.
ALTER TABLE app_wellness_check_in__profiles ADD COLUMN reminder_title TEXT NOT NULL DEFAULT '';
-- Who hears about a missed agreed time: the agreed-time lane's own audience
-- column, beside recipient_member_ids. The app writes it as blank (all adults)
-- or a non-empty list. The hub can leave '[]' by pruning the last relative
-- named; the lane declares empty_list: "audience", so that is all adults too.
ALTER TABLE app_wellness_check_in__profiles ADD COLUMN timed_alert_member_ids TEXT NOT NULL DEFAULT '';

-- A check-in now also answers the day's agreed time, which the hub matches on
-- these three columns. Rows written before this stay NULL: they are history for
-- past dates and no reminder is waiting on them.
ALTER TABLE app_wellness_check_in__checkins ADD COLUMN profile_id TEXT;
ALTER TABLE app_wellness_check_in__checkins ADD COLUMN checkin_date TEXT;
ALTER TABLE app_wellness_check_in__checkins ADD COLUMN slot TEXT;

CREATE INDEX IF NOT EXISTS checkins_by_profile_date
  ON app_wellness_check_in__checkins (profile_id, checkin_date);
