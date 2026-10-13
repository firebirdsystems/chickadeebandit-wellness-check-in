# Wellness Check-In

A [Chickadee Bandit](https://chickadeebandit.com/app-library/wellness-check-in) app.

A gentle daily "I'm OK" check-in for someone living alone (an aging parent, a
partner who travels, a housemate recovering from surgery). The person taps in on
their own schedule or at an agreed time of day, and can ask for a family call.
The household care circle watches a shared status board; if a check-in is missed
past the configured window, designated family members and external contacts get
an alert email. Anything that needs someone — a missed check-in, a missed dose, a
call request — stays on the board until one relative takes it, shows everyone
who has it, and closes with a note about what happened.

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
- This uses the `cron` + `email` capabilities, which every live plan includes.
  The check-in endpoint returns `402` while the household's plan is inactive; the
  UI shows a renew banner and won't pretend an unmonitored profile is protected.

## Agreed time

A profile may also carry an agreed time of day (`checkin_times`), driven by the
hub's `schedule_reminders` protocol: the person gets a push at that time, and if
there is still no check-in 60 minutes later the chosen relatives are told. A
check-in on that household day stands both down — it is matched on
`checkins.profile_id` / `checkin_date` / `slot`, which is why the app writes them.

The silence window stays on as the backstop. The two read different audience
columns: `recipient_member_ids` for the silence window and
`timed_alert_member_ids` for the agreed-time lane. In both, an empty value means
"all adults" and never nobody: the page writes `[]` to the first and blank to
the second, and the lane declares `empty_list: "audience"` so the `[]` the hub
leaves when it prunes the only relative named reads the same way. The off
switch is `active`.

## Requests: who is handling it

`requests` holds a call request, a missed check-in or a missed dose. A row is
`open` until a relative taps **I've got this**, `claimed` while they hold it
(they can hand it back), and `done` once they record the follow-up.

- A call request is written when the person taps **Request a family call**; the
  chosen relatives are notified.
- A missed check-in (agreed time or silence window) is shown on the board
  without a row; the row is written when a relative takes it. Its
  `source_event_id` is `checkin:<profile>:<household day>` and unique, so two
  relatives tapping at once open one request.
- A missed dose arrives from the Medications app through the suggested
  automation on `medication.dose_missed` (`automation_actions.open_request`).
  A household admin turns it on in Automations.

Open requests also appear on the Today list, under whoever took them.

## Access model

- `profiles` — `adult_writable` with `member_read_column`: a member reads their
  own profile; whoever supervises reads and configures everyone's. That is any
  adult in a household and the steward alone in a shared space, where another
  adult sets up and manages only their own. In a roster only the steward
  writes profiles.
- `checkins` — `owner_only` (`adults_bypass: true`): display-only history for the
  board. `INSERT` forces `member_id` to the caller, so a member can only log their
  own check-ins; whoever supervises reads everyone's history.

- `requests` — `owner_or_visibility` (every row carries `visibility = 'adults'`):
  the person a request is about reads it and can raise or withdraw their own
  call request; any adult reads and takes everyone's, in a household and in a
  shared space (in a roster, the steward alone). Only whoever supervises opens
  a request about someone else. Who a request is about cannot be changed
  afterwards, and only that person writes its `note`. Claims are guarded in SQL
  (`WHERE status = 'open'`), so a second claim changes nothing.
  Taking or handing back a request notifies the profile's chosen relatives
  when the sender can read that profile. A relative taking part in a shared
  space cannot, so their change shows on the board and is not pushed.

The authoritative escalation timer is `profiles.last_checkin_at`, written by the
trusted hub endpoint — the `checkins` log is for the streak/history display only.

## Development

```bash
npm install
npm test        # unit tests for src/logic.js + manifest validation
node build.mjs  # validates manifest (incl. row_policies) and bundles src/
```
