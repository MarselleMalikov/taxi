// Сервер рейтинга игроков «Такси Уфа» (Cloudflare Worker + база D1).
// Игра присылает итог каждой законченной смены, сервер проверяет его на правдоподобие и складывает в общий рейтинг.
//
//   GET  /api/name?n=Ник          свободен ли ник
//   POST /api/register            { name, platform, initData? } -> { id, token, name }
//   GET  /api/me                  мои цифры и места (нужен ключ)
//   POST /api/shift               итог смены (нужен ключ)
//   GET  /api/top?period=all|week&limit=50   таблица лидеров (+ моё место, если передан ключ)
//
// Ключ игрока передаётся заголовком Authorization: Bearer <token>.

const LIMITS = {
  shiftMoney: 60000,     // больше этого «чистыми» за одну смену заработать нельзя
  shiftMoneyMin: -30000, // и потерять больше - тоже
  shiftRides: 70,        // поездок за смену
  minGapSec: 90,         // смены не могут приходить чаще, чем раз в полторы минуты реального времени
  maxStrikes: 5          // после стольких невозможных смен игрок пропадает из рейтинга
};
const STAGES = ["novice", "driver", "pro"];
const PLATFORMS = ["web", "tg", "vk", "ya"];
const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_]{3,16}$/;
const BAD = ["хуй", "хуе", "хуё", "пизд", "ебат", "ебан", "ёбан", "бляд", "блят", "сука", "мудак", "пидор", "пидар", "залуп", "шлюх", "fuck", "shit", "bitch", "nigg", "admin", "админ", "модер"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });
const fail = (status, error, text) => json({ error, text }, status);

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "");
    try {
      if (path === "/api/name" && req.method === "GET") return nameCheck(env, url.searchParams.get("n") || "");
      if (path === "/api/register" && req.method === "POST") return register(env, await body(req));
      if (path === "/api/me" && req.method === "GET") return me(env, await auth(env, req));
      if (path === "/api/shift" && req.method === "POST") return shift(env, await auth(env, req), await body(req));
      if (path === "/api/top" && req.method === "GET") return top(env, url, await auth(env, req, true));
      if (path === "" || path === "/api") return json({ ok: true, service: "taxi-ufa" });
      return fail(404, "not_found", "Нет такого адреса");
    } catch (e) {
      if (e instanceof Response) return e;
      return fail(500, "server", "Ошибка сервера");
    }
  }
};

async function body(req) {
  try { return await req.json(); } catch { throw fail(400, "bad_json", "Неверный запрос"); }
}

// ---------- ник ----------
function nameProblem(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) return "От 3 до 16 знаков: буквы, цифры и _";
  const k = name.toLowerCase().replace(/ё/g, "е");
  if (BAD.some(w => k.includes(w.replace(/ё/g, "е")))) return "Такой ник нельзя";
  return "";
}
const nameKey = n => n.toLowerCase().replace(/ё/g, "е");
async function nameCheck(env, n) {
  const bad = nameProblem(n); if (bad) return json({ free: false, text: bad });
  const row = await env.DB.prepare("SELECT 1 FROM players WHERE name_key = ?").bind(nameKey(n)).first();
  return json({ free: !row, text: row ? "Ник занят" : "" });
}

// ---------- вход ----------
async function register(env, b) {
  const platform = PLATFORMS.includes(b.platform) ? b.platform : "web";
  let extId = null;
  if (platform === "tg") {   // Telegram подписывает данные пользователя токеном бота - проверяем подпись
    const u = await tgUser(env, b.initData); if (!u) return fail(403, "tg_auth", "Не удалось проверить вход через Telegram");
    extId = String(u.id);
  } else if (platform !== "web") return fail(400, "platform", "Эта площадка пока не подключена");
  const token = randomHex(32), now = Date.now();
  if (extId) {   // уже играл с этого аккаунта - выдаём новый ключ, ник прежний
    const old = await env.DB.prepare("SELECT id, name FROM players WHERE platform = ? AND ext_id = ?").bind(platform, extId).first();
    if (old) {
      await env.DB.prepare("UPDATE players SET token_hash = ?, updated = ? WHERE id = ?").bind(await sha(token), now, old.id).run();
      return json({ id: old.id, token, name: old.name, existing: true });
    }
  }
  const name = String(b.name || "").trim(), bad = nameProblem(name);
  if (bad) return fail(400, "name", bad);
  const id = randomHex(8);
  try {
    await env.DB.prepare("INSERT INTO players (id, name, name_key, platform, ext_id, token_hash, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, nameKey(name), platform, extId, await sha(token), now, now).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return fail(409, "name_taken", "Ник занят");
    throw e;
  }
  return json({ id, token, name });
}
async function auth(env, req, optional) {
  const h = req.headers.get("Authorization") || "", m = h.match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) { if (optional) return null; throw fail(401, "auth", "Нужен вход"); }
  const p = await env.DB.prepare("SELECT * FROM players WHERE token_hash = ?").bind(await sha(m[1])).first();
  if (!p && !optional) throw fail(401, "auth", "Ключ не подходит");
  return p || null;
}

// ---------- итог смены ----------
// { n: номер смены (сколько смен отработано всего), money: чистыми за смену, rides: поездок за смену,
//   rating, stage, totalRides: поездок всего }
async function shift(env, p, b) {
  const n = int(b.n), money = int(b.money), rides = int(b.rides), rating = Number(b.rating), stage = STAGES.includes(b.stage) ? b.stage : p.stage, now = Date.now();
  if (n === null || money === null || rides === null || !(rating >= 1 && rating <= 5)) return fail(400, "bad_shift", "Неверные данные смены");
  if (n <= p.shifts) return json({ ok: true, skipped: true, shifts: p.shifts });   // эта смена уже учтена (повторная отправка)
  const problems = [];
  if (money > LIMITS.shiftMoney || money < LIMITS.shiftMoneyMin) problems.push("money");
  if (rides < 0 || rides > LIMITS.shiftRides) problems.push("rides");
  if (p.last_at && now - p.last_at < LIMITS.minGapSec * 1000) problems.push("fast");
  if (problems.includes("money") || problems.includes("rides") || problems.includes("fast")) {
    await env.DB.prepare("UPDATE players SET strikes = strikes + 1, shifts = ? WHERE id = ?").bind(n, p.id).run();
    return json({ ok: false, error: "rejected", text: "Смена не засчитана", why: problems }, 422);
  }
  const wk = weekKey(now), sameWeek = p.week === wk;
  await env.DB.prepare(`UPDATE players SET shifts = ?, earned = earned + ?, rides = rides + ?, best_shift = MAX(best_shift, ?), rating = ?, stage = ?,
      week = ?, week_earned = ?, week_rides = ?, updated = ?, last_at = ? WHERE id = ?`)
    .bind(n, money, rides, money, Math.round(rating * 100) / 100, stage, wk, (sameWeek ? p.week_earned : 0) + money, (sameWeek ? p.week_rides : 0) + rides, now, now, p.id).run();
  return json({ ok: true });
}

// ---------- рейтинг ----------
const PUBLIC = "id, name, platform, earned, rides, best_shift AS best, rating, stage, week_earned AS weekEarned, week_rides AS weekRides";
async function me(env, p) {
  return json({ me: pub(p), place: await places(env, p) });
}
async function top(env, url, p) {
  const week = url.searchParams.get("period") === "week", limit = Math.min(100, Math.max(1, int(url.searchParams.get("limit")) || 50));
  const wk = weekKey(Date.now());
  const q = week
    ? env.DB.prepare(`SELECT ${PUBLIC} FROM players WHERE week = ? AND strikes < ? AND last_at > 0 ORDER BY week_earned DESC, updated ASC LIMIT ?`).bind(wk, LIMITS.maxStrikes, limit)
    : env.DB.prepare(`SELECT ${PUBLIC} FROM players WHERE strikes < ? AND last_at > 0 ORDER BY earned DESC, updated ASC LIMIT ?`).bind(LIMITS.maxStrikes, limit);
  const { results } = await q.all();
  const out = { period: week ? "week" : "all", week: wk, list: results };
  if (p) { out.me = pub(p); out.place = await places(env, p); }
  return json(out);
}
async function places(env, p) {   // место игрока: сколько игроков впереди + 1
  if (!p.last_at || p.strikes >= LIMITS.maxStrikes) return { all: null, week: null };
  const wk = weekKey(Date.now());
  const all = await env.DB.prepare("SELECT COUNT(*) AS c FROM players WHERE strikes < ? AND last_at > 0 AND earned > ?").bind(LIMITS.maxStrikes, p.earned).first();
  const week = p.week === wk ? await env.DB.prepare("SELECT COUNT(*) AS c FROM players WHERE strikes < ? AND week = ? AND week_earned > ?").bind(LIMITS.maxStrikes, wk, p.week_earned).first() : null;
  return { all: all.c + 1, week: week ? week.c + 1 : null };
}
const pub = p => ({ id: p.id, name: p.name, platform: p.platform, earned: p.earned, rides: p.rides, best: p.best_shift, rating: p.rating, stage: p.stage,
  weekEarned: p.week === weekKey(Date.now()) ? p.week_earned : 0, weekRides: p.week === weekKey(Date.now()) ? p.week_rides : 0 });

// ---------- Telegram: проверка подписи initData ----------
async function tgUser(env, initData) {
  if (!env.TG_BOT_TOKEN || typeof initData !== "string" || initData.length > 4096) return null;
  const params = new URLSearchParams(initData), hash = params.get("hash"); if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => k + "=" + v).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), env.TG_BOT_TOKEN);
  const sign = toHex(await hmac(secret, check));
  if (sign !== hash) return null;
  if (Date.now() / 1000 - Number(params.get("auth_date") || 0) > 86400) return null;   // подпись старше суток
  try { return JSON.parse(params.get("user")); } catch { return null; }
}
async function hmac(keyBytes, text) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

// ---------- мелочи ----------
function int(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }
function randomHex(bytes) { return toHex(crypto.getRandomValues(new Uint8Array(bytes))); }
function toHex(a) { return [...a].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function sha(s) { return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))); }
function weekKey(ms) {   // неделя по московскому времени, с понедельника: 2026-W46
  const d = new Date(ms + 3 * 3600 * 1000), day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear(), first = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return y + "-W" + String(w).padStart(2, "0");
}
