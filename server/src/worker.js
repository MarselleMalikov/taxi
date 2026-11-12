// Сервер рейтинга игроков «Такси Уфа» (Cloudflare Worker + база D1).
// Игра присылает итог каждой законченной смены, сервер проверяет его на правдоподобие и складывает в общий рейтинг.
//
//   GET  /api/name?n=Ник          свободен ли ник
//   POST /api/register            { name, platform, initData? } -> { id, token, name }
//   POST /api/rename              { name } -> { name, left } - сменить ник (3 раза в сутки)
//   GET  /api/me                  мои цифры и места (нужен ключ)
//   POST /api/shift               итог смены (нужен ключ)
//   GET  /api/top?limit=50        таблица лидеров по лучшей смене (+ моё место, если передан ключ)
//
// Ключ игрока передаётся заголовком Authorization: Bearer <token>.

const LIMITS = {
  shiftMoney: 60000,     // больше этого «чистыми» за одну смену заработать нельзя
  shiftMoneyMin: -30000, // и потерять больше - тоже
  shiftRides: 70,        // поездок за смену
  shiftGross: 80000,     // выручка минус комиссия за смену (рекорд)
  minGapSec: 90,         // смены не могут приходить чаще, чем раз в полторы минуты реального времени
  maxStrikes: 5          // после стольких невозможных смен игрок пропадает из рейтинга
};
const STAGES = ["novice", "driver", "pro"];
const PLATFORMS = ["web", "tg", "vk", "ya"];
const NAME_MIN = 3, NAME_MAX = 20, RENAME_GAP = 24 * 3600 * 1000, RENAME_MAX = 3;   // ник: длина; менять можно 3 раза за сутки (сутки - от первой смены)
const BAD = ["хуй", "хуе", "хуё", "хуи", "пизд", "ебат", "ебан", "ёбан", "ебал", "ебло", "еблан", "уебок", "уебан", "долбоеб", "гандон", "сучар", "бляд", "блят", "сука", "мудак", "пидор", "пидар", "залуп", "шлюх", "fuck", "shit", "bitch", "nigg", "admin", "админ", "модер"];

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
      if (path === "/api/name" && req.method === "GET") return nameCheck(env, req, url.searchParams.get("n") || "");
      if (path === "/api/rename" && req.method === "POST") return rename(env, await auth(env, req), await body(req));
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
// Можно: буквы любых языков, цифры 0-9, пробел, _ - . (не в начале, не в конце, не два подряд), хотя бы одна буква.
const cleanName = n => String(n || "").normalize("NFC").trim().replace(/\s+/g, " ");
function nameProblem(name) {
  const len = [...name].length;
  if (len < NAME_MIN) return "Минимум " + NAME_MIN + " знака";
  if (len > NAME_MAX) return "Максимум " + NAME_MAX + " знаков";
  if (!/^[\p{L}0-9 _.\-]+$/u.test(name)) return "Только буквы, цифры, пробел и знаки _ - .";
  if (!/\p{L}/u.test(name)) return "Нужна хотя бы одна буква";
  if (!/^[\p{L}0-9].*[\p{L}0-9]$/u.test(name)) return "В начале и в конце - буква или цифра";
  if (/[ _.\-]{2}/.test(name)) return "Знаки не могут идти подряд";
  const plain = name.toLowerCase().replace(/ё/g, "е").replace(/[ _.\-]/g, ""), key = nameKey(name), sound = translit(plain);
  if (BAD.some(w => { w = w.replace(/ё/g, "е"); return plain.includes(w) || key.includes(nameKey(w)) || sound.includes(w); })) return "Такой ник нельзя";
  return "";
}
// Латиница по звучанию - чтобы мат транслитом («ebal», «suka», «blyad») тоже ловился
const TR = [["shch", "щ"], ["sch", "щ"], ["yo", "е"], ["jo", "е"], ["zh", "ж"], ["kh", "х"], ["ts", "ц"], ["ch", "ч"], ["sh", "ш"], ["yu", "ю"], ["ju", "ю"], ["ya", "я"], ["ja", "я"], ["ye", "е"], ["uy", "уй"], ["uj", "уй"],
  ["a", "а"], ["b", "б"], ["v", "в"], ["w", "в"], ["g", "г"], ["d", "д"], ["e", "е"], ["z", "з"], ["i", "и"], ["j", "й"], ["y", "у"], ["k", "к"], ["q", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"],
  ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["f", "ф"], ["h", "х"], ["x", "х"], ["c", "с"], ["0", "о"], ["3", "з"], ["6", "б"], ["4", "ч"]];
function translit(s) { let out = ""; for (let i = 0; i < s.length;) { const m = TR.find(([l]) => s.startsWith(l, i)); if (m) { out += m[1]; i += m[0].length; } else out += s[i++]; } return out.replace(/и/g, "и"); }
// Ключ ника: одинаковые на вид ники - один ник. Регистр, ё/е, пробелы и знаки не важны, похожие латинские буквы = русские
const LOOK = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у", "0": "о", "3": "з" };
const nameKey = n => n.toLowerCase().replace(/ё/g, "е").replace(/[ _.\-]/g, "").replace(/[abcehkmoptxy03]/g, c => LOOK[c]);
async function nameCheck(env, req, raw) {
  const n = cleanName(raw), bad = nameProblem(n); if (bad) return json({ free: false, text: bad });
  const p = await auth(env, req, true), row = await env.DB.prepare("SELECT id FROM players WHERE name_key = ?").bind(nameKey(n)).first();
  if (row && p && row.id === p.id) return json({ free: true, own: true, text: "Это ваш ник" });
  return json({ free: !row, text: row ? "Ник занят" : "" });
}
async function rename(env, p, b) {
  const name = cleanName(b.name), bad = nameProblem(name), now = Date.now();
  if (bad) return fail(400, "name", bad);
  const fresh = !p.name_changed || now - p.name_changed >= RENAME_GAP;   // новые сутки - счётчик с нуля
  const start = fresh ? now : p.name_changed, used = fresh ? 0 : p.name_count || 0;
  if (name === p.name) return json({ name, left: RENAME_MAX - used });
  const sameKey = nameKey(name) === p.name_key;   // поменять только регистр или знаки - тоже смена
  if (used >= RENAME_MAX) {
    const h = Math.ceil((start + RENAME_GAP - now) / 3600000);
    return json({ error: "too_soon", text: "Ник можно менять " + RENAME_MAX + " раза в сутки. Следующий раз через " + h + " ч", left: 0 }, 429);
  }
  try {
    await env.DB.prepare("UPDATE players SET name = ?, name_key = ?, name_changed = ?, name_count = ? WHERE id = ?").bind(name, nameKey(name), start, used + 1, p.id).run();
  } catch (e) {
    if (!sameKey && String(e).includes("UNIQUE")) return fail(409, "name_taken", "Ник занят");
    throw e;
  }
  return json({ name, left: RENAME_MAX - used - 1 });
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
  const name = cleanName(b.name), bad = nameProblem(name);
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
// { n: сквозной номер смены, money: чистыми за смену, gross: выручка минус комиссия (без топлива и аренды) - по ней рекорд,
//   rides: поездок за смену, rating, stage }
async function shift(env, p, b) {
  const gross = b.gross === undefined ? null : int(b.gross), n = int(b.n), money = int(b.money), rides = int(b.rides), rating = Number(b.rating), stage = STAGES.includes(b.stage) ? b.stage : p.stage, now = Date.now();
  if (n === null || money === null || rides === null || !(rating >= 1 && rating <= 5)) return fail(400, "bad_shift", "Неверные данные смены");
  if (n <= p.shifts) return json({ ok: true, skipped: true, shifts: p.shifts });   // эта смена уже учтена (повторная отправка)
  const problems = [];
  if (money > LIMITS.shiftMoney || money < LIMITS.shiftMoneyMin) problems.push("money");
  if (rides < 0 || rides > LIMITS.shiftRides) problems.push("rides");
  if (gross !== null && (gross < 0 || gross > LIMITS.shiftGross)) problems.push("gross");
  if (p.last_at && now - p.last_at < LIMITS.minGapSec * 1000) problems.push("fast");
  if (problems.length) {
    await env.DB.prepare("UPDATE players SET strikes = strikes + 1, shifts = ? WHERE id = ?").bind(n, p.id).run();
    return json({ ok: false, error: "rejected", text: "Смена не засчитана", why: problems }, 422);
  }
  const wk = weekKey(now), sameWeek = p.week === wk;
  if (gross !== null && gross > (p.best_gross || 0))   // новый рекорд смены
    await env.DB.prepare("UPDATE players SET best_gross = ?, best_rides = ?, best_at = ? WHERE id = ?").bind(gross, rides, now, p.id).run();
  await env.DB.prepare(`UPDATE players SET shifts = ?, earned = earned + ?, rides = rides + ?, best_shift = MAX(best_shift, ?), rating = ?, stage = ?,
      week = ?, week_earned = ?, week_rides = ?, updated = ?, last_at = ? WHERE id = ?`)
    .bind(n, money, rides, money, Math.round(rating * 100) / 100, stage, wk, (sameWeek ? p.week_earned : 0) + money, (sameWeek ? p.week_rides : 0) + rides, now, now, p.id).run();
  return json({ ok: true });
}

// ---------- рейтинг ----------
// Рейтинг игроков - по лучшей смене: выручка минус комиссия, без топлива и аренды
const PUBLIC = "id, name, platform, best_gross AS best, best_rides AS bestRides, rating, stage";
async function me(env, p) {
  return json({ me: pub(p), place: await places(env, p), renameLeft: !p.name_changed || Date.now() - p.name_changed >= RENAME_GAP ? RENAME_MAX : RENAME_MAX - (p.name_count || 0) });
}
async function top(env, url, p) {
  const limit = Math.min(100, Math.max(1, int(url.searchParams.get("limit")) || 50));
  const { results } = await env.DB.prepare(`SELECT ${PUBLIC} FROM players WHERE strikes < ? AND best_gross > 0 ORDER BY best_gross DESC, best_at ASC LIMIT ?`).bind(LIMITS.maxStrikes, limit).all();
  const out = { list: results };
  if (p) { out.me = pub(p); out.place = await places(env, p); }
  return json(out);
}
async function places(env, p) {   // место игрока по лучшей смене: сколько игроков впереди + 1
  if (!p.best_gross || p.strikes >= LIMITS.maxStrikes) return { best: null };
  const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM players WHERE strikes < ? AND best_gross > ?").bind(LIMITS.maxStrikes, p.best_gross).first();
  return { best: r.c + 1 };
}
const pub = p => ({ id: p.id, name: p.name, platform: p.platform, best: p.best_gross || 0, bestRides: p.best_rides || 0, rating: p.rating, stage: p.stage });

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
