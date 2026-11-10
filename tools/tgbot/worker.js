// Telegram-бот для правки файлов репозитория через GitHub API.
// Работает на Cloudflare Workers (бесплатный тариф). Установка: tools/tgbot/README.md
//
// Переменные (Settings → Variables and Secrets воркера):
//   TG_TOKEN        — токен бота от @BotFather (секрет)
//   GH_TOKEN        — fine-grained токен GitHub с Contents: Read and write только на этот репозиторий (секрет)
//   WEBHOOK_SECRET  — любая длинная строка из латиницы и цифр (секрет)
//   ALLOWED_IDS     — твой Telegram id (несколько через запятую)
//   REPO            — MarselleMalikov/taxi
//   BRANCH          — main

const MAX_MSG = 3800;      // лимит Telegram 4096, оставляем запас под разметку
const LINE_CUT = 300;      // длинные строки в /show обрезаются
const DEFAULT_FILE = "index.html";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/setup") return setup(url, env);
    if (req.method !== "POST") return new Response("ok");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    const update = await req.json();
    // Telegram сразу получает 200, иначе при долгой работе он повторит запрос и коммит сделается дважды
    ctx.waitUntil(handle(update, env).catch(e => console.log("handle error", e && e.stack)));
    return new Response("ok");
  },
};

// Открыть в браузере: https://<воркер>.workers.dev/setup?secret=<WEBHOOK_SECRET>
async function setup(url, env) {
  if (url.searchParams.get("secret") !== env.WEBHOOK_SECRET) return new Response("wrong secret", { status: 403 });
  const hook = await tg(env, "setWebhook", {
    url: `${url.origin}/`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  const cmds = await tg(env, "setMyCommands", { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
  return new Response(JSON.stringify({ hook, cmds }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
}

const COMMANDS = [
  ["help", "Список команд"],
  ["ai", "Задача для Claude (можно и без /ai)"],
  ["ls", "Файлы в папке: /ls [папка]"],
  ["get", "Скачать файл: /get [путь]"],
  ["find", "Найти текст: /find [путь] текст"],
  ["show", "Показать строки: /show [путь] с [по]"],
  ["replace", "Заменить фрагмент (см. /help)"],
  ["line", "Заменить строку: /line [путь] N текст"],
  ["ins", "Вставить перед строкой N"],
  ["del", "Удалить строки: /del [путь] с [по]"],
  ["rm", "Удалить файл: /rm путь"],
  ["log", "Последние коммиты"],
  ["undo", "Откатить последний коммит"],
];

const HELP = `<b>🤖 С ИИ</b>
Просто напиши задачу обычным сообщением, например «сделай прокол в 2 раза реже» или «почему не работает кнопка Гараж?». Claude прочитает проект, внесёт правки, закоммитит в main и пришлёт ответ сюда. Каждая задача — новый разговор, поэтому пиши её целиком.

<b>✍️ Вручную, без ИИ</b>
Каждая правка сразу коммитится, сайт обновится примерно через минуту.

Если путь не указан, берётся ${DEFAULT_FILE}.

<b>Смотреть</b>
/ls [папка] — список файлов
/get [путь] — прислать файл документом
/find [путь] текст — где встречается текст (номера строк)
/show [путь] 120 [140] — показать строки с номерами
/log — последние 5 коммитов

<b>Менять</b>
Прислать файл документом — он заменит файл в репозитории. Подпись = путь (например <code>tools/sim/bot.js</code>), без подписи — имя файла в корне.

/replace [путь]
старый текст
===
новый текст
— заменить фрагмент. Он должен встречаться ровно один раз (иначе бот скажет сколько раз). /replaceall — заменить все вхождения.

/line [путь] N текст — заменить строку N целиком
/ins [путь] N
текст (можно несколько строк) — вставить перед строкой N (N = число строк + 1 — в конец)
/del [путь] 10 [12] — удалить строки
/rm путь — удалить файл

/undo — откатить последний коммит (любой, не только сделанный ботом)

Можно дописать в конце первой строки команды <code>| текст</code> — это будет сообщением коммита. Пример: <code>/line index.html 5 abc | поправил заголовок</code>`;

// ---------- обработка сообщений ----------

async function handle(update, env) {
  const msg = update.message;
  if (!msg) return;
  const chat = msg.chat.id;
  const allowed = String(env.ALLOWED_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(String(msg.from && msg.from.id))) {
    return send(env, chat, `Нет доступа. Твой id: <code>${msg.from && msg.from.id}</code> — добавь его в ALLOWED_IDS.`);
  }
  try {
    if (msg.document) return await onDocument(env, msg);
    const text = msg.text || "";
    if (!text.trim()) return send(env, chat, "Пришли текст задачи или команду. /help — список команд.");
    if (!text.startsWith("/")) return await askClaude(env, chat, text);
    await onCommand(env, chat, text);
  } catch (e) {
    await send(env, chat, "Ошибка: " + esc(e.message || String(e)));
  }
}

async function onCommand(env, chat, text) {
  // первая строка — команда и аргументы, остальное — тело
  const nl = text.indexOf("\n");
  let head = nl < 0 ? text : text.slice(0, nl);
  const body = nl < 0 ? "" : text.slice(nl + 1);
  let commitMsg = "";
  const bar = head.indexOf(" | ");
  if (bar >= 0) { commitMsg = head.slice(bar + 3).trim(); head = head.slice(0, bar); }
  const parts = head.trim().split(/\s+/);
  const cmd = parts.shift().slice(1).replace(/@.*$/, "").toLowerCase();
  const say = t => send(env, chat, t);

  // путь необязателен: если первый аргумент похож на путь к файлу — берём его
  let explicitPath = false;
  const takePath = () => {
    if (parts.length && /[./]/.test(parts[0]) && !/^\d+$/.test(parts[0])) { explicitPath = true; return parts.shift(); }
    return DEFAULT_FILE;
  };

  switch (cmd) {
    case "ai": {
      const task = text.replace(/^\/ai(@\S+)?\s*/i, "");
      if (!task.trim()) return say("Напиши задачу после /ai или просто обычным сообщением.");
      return askClaude(env, chat, task);
    }

    case "start":
    case "help":
      return say(HELP);

    case "ls": {
      const dir = (parts[0] || "").replace(/^\/+|\/+$/g, "");
      const list = await gh(env, `contents/${encPath(dir)}?ref=${env.BRANCH}`);
      if (!Array.isArray(list)) return say(`${esc(dir)} — это файл, а не папка.`);
      const rows = list
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))
        .map(f => f.type === "dir" ? `📁 ${esc(f.name)}/` : `📄 ${esc(f.name)}  <i>${kb(f.size)}</i>`);
      return say(`<b>/${esc(dir)}</b>\n` + rows.join("\n"));
    }

    case "get": {
      const path = takePath();
      const { text } = await readFile(env, path);
      return sendDocument(env, chat, path.split("/").pop(), text, `${path} (${kb(new TextEncoder().encode(text).length)})`);
    }

    case "find": {
      const path = takePath();
      const q = parts.join(" ");
      if (!q) return say("Что искать? /find [путь] текст");
      const { text } = await readFile(env, path);
      const lines = text.split("\n");
      const hits = [];
      let total = 0;
      lines.forEach((l, i) => {
        let from = 0, p;
        while ((p = l.indexOf(q, from)) >= 0) {
          total++;
          if (hits.length < 25) hits.push(`<b>${i + 1}</b>: ${esc(snippet(l, p, q.length))}`);
          from = p + q.length;
        }
      });
      if (!total) return say(`«${esc(q)}» в ${esc(path)} не найдено.`);
      return say(`«${esc(q)}» в ${esc(path)}: ${total} шт.${total > hits.length ? ` (показаны первые ${hits.length})` : ""}\n\n` + hits.join("\n"));
    }

    case "show": {
      const path = takePath();
      const a = int(parts[0], "номер строки");
      const b = parts[1] ? int(parts[1], "номер строки") : a + 20;
      const { text } = await readFile(env, path);
      const lines = text.split("\n");
      const out = [];
      let size = 0;
      for (let i = Math.max(1, a); i <= Math.min(b, lines.length); i++) {
        let l = lines[i - 1].replace(/\r$/, "");
        if (l.length > LINE_CUT) l = l.slice(0, LINE_CUT) + ` … [ещё ${l.length - LINE_CUT} симв.]`;
        const row = `${i}: ${l}`;
        if (size + row.length > MAX_MSG - 200) { out.push("… (не влезло, сузь диапазон)"); break; }
        out.push(row); size += row.length + 1;
      }
      if (!out.length) return say(`В файле ${lines.length} строк.`);
      return say(`<b>${esc(path)}</b> (всего строк: ${lines.length})\n<pre>${esc(out.join("\n"))}</pre>`);
    }

    case "replace":
    case "replaceall": {
      const path = takePath();
      const sep = body.split(/\n===\n|\n===$/);
      if (sep.length < 2) return say("Формат:\n/replace [путь]\nстарый текст\n===\nновый текст");
      const oldT = sep[0], newT = sep.slice(1).join("\n===\n");
      if (!oldT) return say("Старый текст пустой.");
      const f = await readFile(env, path);
      const eolOld = toEol(oldT, f.eol), eolNew = toEol(newT, f.eol);
      const count = f.text.split(eolOld).length - 1;
      if (!count) return say(`Старый текст в ${esc(path)} не найден. Проверь пробелы и переносы — удобно скопировать кусок из /show.`);
      if (count > 1 && cmd === "replace") return say(`Текст встречается ${count} раз. Добавь соседние строки, чтобы он стал уникальным, или используй /replaceall.`);
      const res = f.text.split(eolOld).join(eolNew);
      await writeFile(env, path, res, f.sha, commitMsg || `${path}: замена через Telegram`);
      return say(`✅ ${esc(path)}: заменено ${count} шт.`);
    }

    case "line": {
      const path = takePath();
      const n = int(parts.shift(), "номер строки");
      // сам текст может содержать пробелы, поэтому берём его из исходной строки: после команды, пути и N
      const newLine = afterArgs(head, 2 + (explicitPath ? 1 : 0)) + (body ? "\n" + body : "");
      const f = await readFile(env, path);
      const lines = f.text.split("\n");
      if (n < 1 || n > lines.length) return say(`В файле ${lines.length} строк.`);
      const cr = lines[n - 1].endsWith("\r") ? "\r" : "";
      const was = lines[n - 1];
      lines[n - 1] = toEol(newLine, f.eol) + cr;
      await writeFile(env, path, lines.join("\n"), f.sha, commitMsg || `${path}: строка ${n} через Telegram`);
      return say(`✅ ${esc(path)}, строка ${n}\nбыло: <code>${esc(cut(was))}</code>\nстало: <code>${esc(cut(newLine))}</code>`);
    }

    case "ins": {
      const path = takePath();
      const n = int(parts.shift(), "номер строки");
      if (!body) return say("Текст для вставки пиши со следующей строки после команды.");
      const f = await readFile(env, path);
      const lines = f.text.split("\n");
      if (n < 1 || n > lines.length + 1) return say(`В файле ${lines.length} строк, N от 1 до ${lines.length + 1}.`);
      const cr = f.eol === "\r\n" ? "\r" : "";
      const add = body.split("\n").map(l => l + cr);
      lines.splice(n - 1, 0, ...add);
      await writeFile(env, path, lines.join("\n"), f.sha, commitMsg || `${path}: вставка перед строкой ${n} через Telegram`);
      return say(`✅ ${esc(path)}: вставлено ${add.length} стр. перед строкой ${n}.`);
    }

    case "del": {
      const path = takePath();
      const a = int(parts[0], "номер строки");
      const b = parts[1] ? int(parts[1], "номер строки") : a;
      const f = await readFile(env, path);
      const lines = f.text.split("\n");
      if (a < 1 || b < a || b > lines.length) return say(`В файле ${lines.length} строк.`);
      const removed = lines.splice(a - 1, b - a + 1);
      await writeFile(env, path, lines.join("\n"), f.sha, commitMsg || `${path}: удалены строки ${a}-${b} через Telegram`);
      return say(`✅ ${esc(path)}: удалено строк: ${removed.length}\n<pre>${esc(cut(removed.join("\n"), 1500))}</pre>`);
    }

    case "rm": {
      const path = parts[0];
      if (!path) return say("/rm путь — путь обязателен.");
      const meta = await gh(env, `contents/${encPath(path)}?ref=${env.BRANCH}`);
      await gh(env, `contents/${encPath(path)}`, "DELETE", { message: commitMsg || `Удалён ${path} через Telegram`, sha: meta.sha, branch: env.BRANCH });
      return say(`🗑 ${esc(path)} удалён. Вернуть: /undo`);
    }

    case "log": {
      const list = await gh(env, `commits?sha=${env.BRANCH}&per_page=5`);
      return say(list.map(c => `<code>${c.sha.slice(0, 7)}</code> ${esc(c.commit.author.date.slice(0, 16).replace("T", " "))}\n${esc(cut(c.commit.message.split("\n")[0], 200))}`).join("\n\n"));
    }

    case "undo": {
      const ref = await gh(env, `git/ref/heads/${env.BRANCH}`);
      const head = await gh(env, `git/commits/${ref.object.sha}`);
      if (!head.parents.length) return say("Это первый коммит, откатывать некуда.");
      const parent = await gh(env, `git/commits/${head.parents[0].sha}`);
      const title = head.message.split("\n")[0];
      const commit = await gh(env, "git/commits", "POST", {
        message: commitMsg || `Откат: ${title}`,
        tree: parent.tree.sha,
        parents: [head.sha],
      });
      await gh(env, `git/refs/heads/${env.BRANCH}`, "PATCH", { sha: commit.sha });
      return say(`↩️ Откатил «${esc(cut(title, 200))}». Повторный /undo откатит сам откат.`);
    }

    default:
      return say("Нет такой команды. /help");
  }
}

async function onDocument(env, msg) {
  const doc = msg.document;
  const path = (msg.caption || doc.file_name || "").trim().replace(/^\/+/, "");
  if (!path) return send(env, msg.chat.id, "Укажи путь в подписи к файлу.");
  if (doc.file_size > 20 * 1024 * 1024) return send(env, msg.chat.id, "Telegram отдаёт ботам файлы до 20 МБ.");
  const info = await tg(env, "getFile", { file_id: doc.file_id });
  if (!info.ok) throw new Error("getFile: " + info.description);
  const r = await fetch(`https://api.telegram.org/file/bot${env.TG_TOKEN}/${info.result.file_path}`);
  if (!r.ok) throw new Error("скачивание файла: " + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let sha;
  try { sha = (await gh(env, `contents/${encPath(path)}?ref=${env.BRANCH}`)).sha; } catch (e) { if (!/404/.test(e.message)) throw e; }
  await gh(env, `contents/${encPath(path)}`, "PUT", {
    message: `${sha ? "Обновлён" : "Добавлен"} ${path} через Telegram`,
    content: b64(bytes),
    branch: env.BRANCH,
    ...(sha ? { sha } : {}),
  });
  return send(env, msg.chat.id, `✅ ${esc(path)} ${sha ? "обновлён" : "добавлен"} (${kb(bytes.length)}). Откатить: /undo`);
}

// Обычный текст — задача для Claude: запускаем workflow .github/workflows/tg-claude.yml
async function askClaude(env, chat, task) {
  if (task.length > 8000) return send(env, chat, "Слишком длинно, сократи до 8000 символов.");
  await gh(env, "dispatches", "POST", { event_type: "tg", client_payload: { text: task, chat_id: String(chat) } });
  return send(env, chat, `🤖 Claude взял задачу. Обычно это занимает 1–5 минут, ответ придёт сюда.\nХод работы: https://github.com/${env.REPO}/actions`);
}

// ---------- GitHub ----------

async function gh(env, path, method = "GET", body, accept = "application/vnd.github+json") {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: accept,
      "User-Agent": "taxi-tg-bot",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (accept.endsWith(".raw") && r.ok) return r;
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 409 || (r.status === 422 && /sha/i.test(data && data.message))) throw new Error("файл успели изменить с другого места, повтори команду");
    throw new Error(`GitHub ${r.status}: ${(data && data.message) || ""}`);
  }
  return data;
}

async function readFile(env, path) {
  // JSON-ответ даёт sha; содержимое берём «сырым» — так работают и файлы больше 1 МБ
  const meta = await gh(env, `contents/${encPath(path)}?ref=${env.BRANCH}`);
  if (Array.isArray(meta)) throw new Error(`${path} — это папка`);
  const raw = await gh(env, `contents/${encPath(path)}?ref=${env.BRANCH}`, "GET", null, "application/vnd.github.raw");
  const text = await raw.text();
  return { text, sha: meta.sha, eol: text.includes("\r\n") ? "\r\n" : "\n" };
}

async function writeFile(env, path, text, sha, message) {
  await gh(env, `contents/${encPath(path)}`, "PUT", {
    message, sha, branch: env.BRANCH,
    content: b64(new TextEncoder().encode(text)),
  });
}

// ---------- Telegram ----------

async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function send(env, chat, html) {
  if (html.length > MAX_MSG) html = html.slice(0, MAX_MSG).replace(/<[^>]*$/, "") + "\n…";
  let r = await tg(env, "sendMessage", { chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: true });
  // если обрезка сломала HTML-разметку — шлём простым текстом
  if (!r.ok) r = await tg(env, "sendMessage", { chat_id: chat, text: html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") });
  return r;
}

async function sendDocument(env, chat, name, text, caption) {
  const fd = new FormData();
  fd.append("chat_id", String(chat));
  fd.append("caption", caption);
  fd.append("document", new Blob([text], { type: "text/plain" }), name);
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendDocument`, { method: "POST", body: fd });
  const j = await r.json();
  if (!j.ok) throw new Error("sendDocument: " + j.description);
}

// ---------- мелочи ----------

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function cut(s, n = 300) { s = String(s).replace(/\r/g, ""); return s.length > n ? s.slice(0, n) + "…" : s; }
function kb(n) { return n > 1024 * 1024 ? (n / 1048576).toFixed(1) + " МБ" : Math.max(1, Math.round(n / 1024)) + " КБ"; }
function encPath(p) { return p.split("/").filter(Boolean).map(encodeURIComponent).join("/"); }
function toEol(s, eol) { return eol === "\r\n" ? s.replace(/\r?\n/g, "\r\n") : s; }
function int(v, what) { const n = parseInt(v, 10); if (!Number.isFinite(n)) throw new Error(`нужен ${what}`); return n; }
function snippet(line, pos, len) {
  const a = Math.max(0, pos - 60), b = Math.min(line.length, pos + len + 60);
  return (a > 0 ? "…" : "") + line.slice(a, b).replace(/\r/g, "") + (b < line.length ? "…" : "");
}
// текст первой строки команды после n слов (для /line, где сам текст содержит пробелы)
function afterArgs(head, n) {
  const re = /\S+/g;
  let m, i = 0, end = 0;
  while (i < n && (m = re.exec(head))) { i++; end = m.index + m[0].length; }
  return head.slice(end).replace(/^\s/, "");
}
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
