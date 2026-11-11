-- 1: смена ника (3 раза в сутки)
ALTER TABLE players ADD COLUMN name_changed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN name_count INTEGER NOT NULL DEFAULT 0;
