-- 2: рейтинг по лучшей смене (выручка минус комиссия)
ALTER TABLE players ADD COLUMN best_gross INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN best_rides INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN best_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS players_best ON players(best_gross DESC);
