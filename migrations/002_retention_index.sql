CREATE INDEX IF NOT EXISTS app_wellness_check_in__checkins_retention_idx
  ON app_wellness_check_in__checkins (checked_at, id);
