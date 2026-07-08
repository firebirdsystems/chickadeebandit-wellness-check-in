# Wellness Check-In

A gentle daily "I'm OK" check-in for someone living alone (an aging parent, a
partner who travels, a housemate recovering from surgery). The person taps in on
their own schedule; the household care circle watches a shared status board; and
if a check-in is missed past the configured window, designated family members and
external contacts get an alert email.

The positive, caregiver-facing counterpart to **Check-In Switch** (dead-mans-switch):
that app is private and self-owned; this one is a shared care tool with a visible
history and streak.

## How monitoring works

- Each **profile** belongs to one monitored member. Adults set it up; the person
  themselves taps **I'm OK** (with an optional mood + note).
- Check-in goes through the hub's `inactivity_alerts` protocol
  (`POST /run/wellness-check-in/api/check-in`), which stamps `last_checkin_at` on
  that member's profile. The hub's hourly cron emails the recipients when a profile
  is overdue and stamps `last_alerted_at` to dedupe.
- This requires the **Premium** capability bundle (`cron` + `email`). The check-in
  endpoint returns `402` when the household isn't entitled; the UI shows an upgrade
  banner and won't pretend an unmonitored profile is protected.

## Access model

- `profiles` — `adult_writable`: the whole household (the care circle) reads the
  status board; only adults create/configure/pause profiles.
- `checkins` — `owner_only` (`adults_bypass: true`): display-only history for the
  board. `INSERT` forces `member_id` to the caller, so a member can only log their
  own check-ins; adults (caregivers) can read everyone's history.

The authoritative escalation timer is `profiles.last_checkin_at`, written by the
trusted hub endpoint — the `checkins` log is for the streak/history display only.

## Development

```bash
npm install
npm test        # unit tests for src/logic.js + manifest validation
node build.mjs  # validates manifest (incl. row_policies) and bundles src/
```
