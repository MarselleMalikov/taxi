// Бот играет целую карьеру подряд: смена за сменой с нуля, копит на взнос, покупает машину, платит кредит,
// проходит ТО. Считает смены и реальное время (перемотка поездок x4). Запуск: node tools/sim/career.js [out.json]
// N=3 node ... - сколько карьер на каждый вариант
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const N=+(process.env.N||3);
const BOT=String.raw`
window.__career = function (cfg) {
  frame = function () {}; draw = function () {}; tickAmbient = function () {};
  try { localStorage.clear(); } catch (e) {}
  M = newMeta(); money = 0; rates = Array(150).fill(5); carId = "rio"; owned = {}; ridesDone = 0; day = 1;
  const pick = n => Math.floor(Math.random() * n);
  const target = salonCar(cfg.target), tcls = CARS.find(c => c.id === target.model).t;
  const log = { boughtShift: null, boughtReal: null, paidShift: null, paidReal: null, real: 0, repo: 0, to: 0, broke: 0, earlyPaid: false, shifts: [] };
  const _spend = spend; spend = function (k, a, l) { if (l === "ремонт") log.broke++; if (l === "ТО") log.to++; return _spend(k, a, l); };
  for (let s = 0; s < (cfg.max || 400); s++) {
    // перед сменой: покупка, когда открыт тариф и хватает на взнос с запасом
    if (!M.own && tariffOpen(tcls) && money >= Math.round(target.price * DOWN) + 15000) {
      const down = Math.round(target.price * DOWN); money -= down;
      M.own = { model: target.model, year: target.year, price: target.price, debt: target.price - down, pay: target.pay, km: 0, toKm: TO_KM, since: M.careerShifts, overdueAt: null };
      M.drive = "own"; carId = target.model; log.boughtShift = s; log.boughtReal = log.real;
    }
    if (M.own && M.own.debt > 0 && cfg.early && money - 20000 >= M.own.debt) { money -= M.own.debt; M.own.debt = 0; log.earlyPaid = true; }
    if (M.own && M.own.debt <= 0 && log.paidShift == null) { log.paidShift = s; log.paidReal = log.real; if (cfg.stop) break; }
    if (!M.own && log.boughtShift != null) log.repo++;
    if (!M.own) { carId = tariffOpen(tcls) ? target.model : (tariffOpen("comfort") ? "polo" : "rio"); M.drive = "rent"; }
    ensureCls(); clsOn = { econ: true, comfort: true, cplus: true }; ensureCls();
    // смена
    shiftBtn.click(); ff = cfg.ff; let ticks = 0, hadLunch = false;
    while (!endingShown && ticks < 900000) {
      ticks++;
      if (evt && evt.call) { $("call").querySelector('[data-call="go"]').click(); continue; }
      if (evt) { const c = evt.choices, t = evt.title; $("evtbtns").querySelectorAll("[data-evt]")[/ТО/.test(t) ? 0 : pick(c.length)].click(); continue; }
      if (dialogue) { chooseAnswer(pick(dialogue.scene.nodes[dialogue.nodeId].choices.length)); continue; }
      if (!online && blockLeft() > 0) { const l = blockLeft(); clock += l; onlineT += l; blockUntil = 0; online = true; continue; }
      if (M.pending && state === "idle") { callGo(); continue; }
      if (state === "idle" && !online && !endingShown && !M.pending) { online = true; spawnTimer = 1.5; continue; }   // после поездки к клиенту - снова на линию
      if (state === "idle" && online) {
        if (fuel < 8) { goRefuel(); if (!$("ask").hidden) $("askok").click(); continue; }
        if (mood < 35) { if (!hadLunch) { hadLunch = true; takeBreak("lunch"); } else takeBreak("rest"); continue; }
        if (orders.length) { const o = orders[0]; if (Math.random() < 0.92) acceptOrder(o.id); else declineOrder(o.id); continue; }
      }
      if (current && current.nextOffer && !current.next && state === "toDropoff") { current.next = current.nextOffer; current.nextOffer = null; }
      update(0.05); log.real += 0.05;
    }
    log.shifts.push(Math.round(shiftNet())); if (cfg.verbose) console.log('shift', s, 'ticks', ticks, 'rides', shiftRides, 'net', Math.round(shiftNet()), 'money', Math.round(money), 'state', state, 'online', online, 'end', endingShown);
    const b = endCard.querySelector('[data-end="newshift"]'); b.click();   // новая смена: платежи, ТО
    if (evt && !evt.call) { const c = evt.choices; $("evtbtns").querySelectorAll("[data-evt]")[/ТО/.test(evt.title) ? 0 : pick(c.length)].click(); }
  }
  return Object.assign(log, { target: cfg.target, early: cfg.early, money, careerShifts: M.careerShifts, rating: getRating() });
};`;
const jobs=[];
for (const target of ["rio2021","octavia2021","camry2021"]) for (const early of [true,false]) for(let i=0;i<N;i++) jobs.push({target,early,ff:4,stop:true});
(async()=>{const b=await chromium.launch();const out=[];let k=0;
 await Promise.all([0,1,2,3].map(async()=>{const p=await b.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
  while(k<jobs.length){const j=jobs[k++];await p.goto('file://'+path.resolve(__dirname,'../../index.html'));await p.waitForTimeout(500);await p.addScriptTag({content:BOT});
   const t=Date.now();const r=await p.evaluate(c=>__career(c),j);r.cpu=Math.round((Date.now()-t)/1000);out.push(r);console.log(j.target,j.early,'bought',r.boughtShift,'paid',r.paidShift,'cpu',r.cpu+'s');}}));
 fs.writeFileSync(process.argv[2]||'career.json',JSON.stringify(out));await b.close()})()
