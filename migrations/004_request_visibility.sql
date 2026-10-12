-- Who may read a request besides the person it is about.
--
-- A request is something the whole care circle can act on: any adult may see
-- it and say they have it. The row policy reads this column to decide that,
-- so every request carries 'adults'. It is never set by the page.
ALTER TABLE app_wellness_check_in__requests ADD COLUMN visibility TEXT NOT NULL DEFAULT 'adults';
