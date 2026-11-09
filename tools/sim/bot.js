// Бот играет одну смену в настоящей игре: тот же код, без отрисовки. Возвращает статистику смены.
window.__runShift = function (cfg) {
  const log = { fines: [], costs: [], events: {}, scenes: {}, declined: 0, accepted: 0, chainAcc: 0, breaks: 0, lunches: 0, refuels: 0, blocks: 0, cashLost: 0, ratingMin: 5 };
  frame = function () {}; draw = function () {}; tickAmbient = function () {};
  try { localStorage.clear(); } catch (e) {}
  // свежее состояние игрока
  money = 0; rates = Array(150).fill(cfg.rating || 5); carId = cfg.car; carChosen = true; owned = {}; for (const k of cfg.owned || []) owned[k] = true;
  clsOn = { econ: true, comfort: true, cplus: true }; ensureCls();
  workMode = cfg.mode === "flex" ? "flex" : "classic"; districtSel = cfg.mode === "district" ? new Set(cfg.districts) : null;
  ledger = newLedger(); rain = rollRain(); rainShown = 0; goalRides = 0; blockUntil = 0; mood = 100; breaks = 0; onlineT = 0; clock = 0; shiftOver = false; endingShown = false;
  priority = PRIO_MAX; fuel = TANK; shiftRides = 0; ridesDone = 0; state = "idle"; online = false; orders = []; current = null; dialogue = null; evt = null; lastRide = null; ff = 1;
  $("ending").hidden = true; $("ask").hidden = true;
  // перехват событий для статистики
  const _spend = spend; spend = function (kind, amount, label) { if (kind === "fines") log.costs.push(label + ":" + amount); return _spend(kind, amount, label); };
  const _finish = finishRide; finishRide = function (reason) { const r = _finish(reason); if (lastRide) { for (const f of lastRide.fines) log.fines.push(f); if (lastRide.price === 0 && lastRide.note) log.cashLost++; } return r; };
  for (const n of ["evtTire", "evtCrash", "evtCoffee", "evtHail"]) { const f = window[n]; window[n] = function () { log.events[n] = (log.events[n] || 0) + 1; return f.apply(this, arguments); }; }
  const _sd = startDialogue; startDialogue = function (o, later) { _sd(o, later); const d = dialogue || (current && current.epilogue); if (d) { const id = Object.keys(SCENES).find(k => SCENES[k] === d.scene); log.scenes[id] = (log.scenes[id] || 0) + 1; } };
  shiftBtn.click();   // на линию: аренда списывается
  const startNet = shiftNet();
  let ticks = 0, hadLunch = false;
  const pick = n => Math.floor(Math.random() * n);
  while (!endingShown && ticks < 900000) {
    ticks++;
    if (evt) { const c = evt.choices; $("evtbtns").querySelectorAll("[data-evt]")[pick(c.length)].click(); continue; }
    if (dialogue) { const node = dialogue.scene.nodes[dialogue.nodeId]; chooseAnswer(pick(node.choices.length)); continue; }
    if (!online && blockLeft() > 0) { log.blocks++; const left = blockLeft(); clock += left; onlineT += left; blockUntil = 0; online = true; spawnTimer = 1.5; continue; }
    if (state === "idle" && online) {
      if (fuel < 8) { log.refuels++; goRefuel(); continue; }
      if (mood < 35) { if (!hadLunch) { hadLunch = true; log.lunches++; takeBreak("lunch"); } else { log.breaks++; takeBreak("rest"); } continue; }
      if (orders.length) { const o = orders[0]; if (Math.random() < (cfg.acceptRate || 0.92)) { log.accepted++; acceptOrder(o.id); } else { log.declined++; declineOrder(o.id); } continue; }
    }
    if (current && current.nextOffer && !current.next && state === "toDropoff") { log.chainAcc++; current.next = current.nextOffer; current.nextOffer = null; }
    update(0.05);
    log.ratingMin = Math.min(log.ratingMin, getRating());
  }
  const L = ledger;
  return { car: cfg.car, cls: myCar().t, mode: cfg.mode, rides: shiftRides, net: shiftNet(), fares: L.fares, tips: L.tips, bonus: L.bonus || 0, fee: L.fee, rent: L.rent, fuel: L.fuel, fuelL: L.fuelL, other: L.fines, km: L.km,
    fuelLeft: fuel, fuelUsedCost: Math.round((TANK - fuel) * FUEL_PRICE + L.fuel), online: onlineT, why: shiftEndWhy, rating: getRating(), mood, prio: priority, rain: !!rain, casino: L.casino || 0, ticks, ...log };
};
