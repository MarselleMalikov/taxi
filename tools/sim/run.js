// Прогон смен ботом в настоящей игре (Playwright, без отрисовки). Запуск: node tools/sim/run.js [results.json]
// В каждой смене бот принимает ~92% заказов и цепочки, отвечает пассажирам и на события случайно, обедает и отдыхает при настроении ниже 35%.
const {chromium}=require('playwright');const fs=require('fs');
const N=+(process.env.N||15), bot=fs.readFileSync(__dirname+'/bot.js','utf8');
const ALL=["kit","cam","charge","water","covers","thermos"];
const jobs=[];
for (const car of ["granta","rio","polo","octavia","tiggo4","optima","camry"]) for(let i=0;i<N;i++) jobs.push({car,mode:"classic",tag:"base"});
for (const car of ["rio","octavia","camry"]) for (const mode of ["flex","district"]) for(let i=0;i<N;i++) jobs.push({car,mode,districts:["center"],tag:"mode"});
for(let i=0;i<N;i++) jobs.push({car:"rio",mode:"classic",owned:ALL,tag:"shop"});
(async()=>{const b=await chromium.launch();const out=[];let k=0;
 await Promise.all([0,1,2,3].map(async w=>{const p=await b.newPage({viewport:{width:390,height:844}});p.on('pageerror',e=>console.log('ERR',e.message));
  while(k<jobs.length){const j=jobs[k++];await p.goto('file://'+require('path').resolve(__dirname,'../../index.html'));await p.waitForTimeout(600);await p.addScriptTag({content:bot});
   const r=await p.evaluate(c=>__runShift(c),j);r.tag=j.tag;out.push(r);}
 }));
 fs.writeFileSync(process.argv[2]||'results.json',JSON.stringify(out));console.log('done',out.length);await b.close()})()
