-- База рейтинга игроков (Cloudflare D1, это SQLite)
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,              -- случайный id игрока
  name        TEXT NOT NULL,                 -- ник, как его ввёл игрок
  name_key    TEXT NOT NULL UNIQUE,          -- ник маленькими буквами: «Ринат» и «ринат» - один ник
  platform    TEXT NOT NULL,                 -- web, tg, vk, ya
  ext_id      TEXT,                          -- id игрока на площадке (Telegram, ВК, Яндекс), для web пусто
  token_hash  TEXT NOT NULL,                 -- хеш ключа игрока (сам ключ хранится только в игре)
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  shifts      INTEGER NOT NULL DEFAULT 0,    -- номер последней присланной смены
  earned      INTEGER NOT NULL DEFAULT 0,    -- заработано за всё время (сумма «чистыми» за смены)
  rides       INTEGER NOT NULL DEFAULT 0,    -- поездок за всё время
  best_shift  INTEGER NOT NULL DEFAULT 0,    -- лучшая смена, ₽
  rating      REAL    NOT NULL DEFAULT 5,    -- рейтинг водителя
  stage       TEXT    NOT NULL DEFAULT 'novice',
  week        TEXT    NOT NULL DEFAULT '',   -- неделя, к которой относится week_earned (например 2026-W46)
  week_earned INTEGER NOT NULL DEFAULT 0,
  week_rides  INTEGER NOT NULL DEFAULT 0,
  strikes     INTEGER NOT NULL DEFAULT 0,    -- сколько раз присылал невозможные цифры
  last_at     INTEGER NOT NULL DEFAULT 0,    -- когда пришла последняя засчитанная смена (0 - ни одной)
  name_changed INTEGER NOT NULL DEFAULT 0,   -- начало суток, в которые меняли ник (0 - не меняли)
  name_count  INTEGER NOT NULL DEFAULT 0,    -- сколько раз меняли ник в эти сутки
  best_gross  INTEGER NOT NULL DEFAULT 0,    -- рекорд: лучшая смена, выручка минус комиссия (без топлива и аренды)
  best_rides  INTEGER NOT NULL DEFAULT 0,    -- поездок в этой смене
  best_at     INTEGER NOT NULL DEFAULT 0     -- когда поставлен рекорд
);
CREATE UNIQUE INDEX IF NOT EXISTS players_ext ON players(platform, ext_id) WHERE ext_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS players_earned ON players(earned DESC);
CREATE INDEX IF NOT EXISTS players_week ON players(week, week_earned DESC);
CREATE INDEX IF NOT EXISTS players_best ON players(best_gross DESC);
