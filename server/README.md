# Сервер рейтинга «Такси Уфа»

Cloudflare Worker + база D1. Игра присылает итог каждой законченной смены, сервер проверяет его и ведёт общий рейтинг.

## Адреса
- `GET /api/name?n=Ник` - свободен ли ник
- `POST /api/register` `{ name, platform: "web" | "tg", initData? }` -> `{ id, token, name }`
- `GET /api/me` - мои цифры и места (заголовок `Authorization: Bearer <token>`)
- `POST /api/shift` `{ n, money, rides, rating, stage }` - итог смены
- `GET /api/top?period=all|week&limit=50` - таблица лидеров

## Проверки
- За смену: «чистыми» от -30 000 до 60 000 ₽, до 70 поездок.
- Смены не чаще раза в 90 секунд реального времени.
- Одна и та же смена (номер `n`) засчитывается один раз.
- Невозможные цифры не засчитываются; после 5 таких смен игрок пропадает из рейтинга.
- Ник: 3-16 знаков (буквы, цифры, _), без мата, без повторов (без учёта регистра).
- Вход через Telegram: проверка подписи initData токеном бота (секрет `TG_BOT_TOKEN`).

## Запуск у себя
```
npm install
npm run db:local
npm run dev
```

## Выгрузка в Cloudflare
```
npx wrangler d1 create taxi-ufa        # id базы вписать в wrangler.toml
npm run db:remote
npm run deploy
npx wrangler secret put TG_BOT_TOKEN   # когда будет бот
```
