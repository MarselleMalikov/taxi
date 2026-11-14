const {open}=require('./lib');const fs=require('fs');
(async()=>{const g=await open();const p=g.p;const M_={};
const tap=async(name,sel)=>{const r=await p.evaluate(s=>{const e=document.querySelector(s);const b=e.getBoundingClientRect();return [Math.round(b.left+b.width/2),Math.round(b.top+b.height/2)]},sel);(M_[name]=M_[name]||[]).push([g.n,...r]);await g.rec(3);await p.evaluate(s=>document.querySelector(s).click(),sel);};
await p.evaluate(()=>{money=86250;M.careerShifts=8;ridesDone=100;M.open={comfort:true,cplus:true};updateTop();$('menubtn').click();$('garagebtn').click();});await g.tick(6);
g.setDir('c_G');await g.rec(16);await tap('G','.gcar[data-car="camry"]');await g.rec(24);await tap('G','#askok');await g.rec(36);
console.log('after G',await p.evaluate(()=>({carId,gh:$('garage').hidden,cls:JSON.stringify(clsOn)})));
await p.evaluate(()=>{$('garage').hidden=true;$('menu').hidden=true;clsOn.comfort=false;clsOn.cplus=false;renderPanel();updateTop();$('ratingpill').click();});await g.tick(6);
g.setDir('c_T');await g.rec(12);await tap('T','.clsbtn[data-cls="comfort"]');await g.rec(11);await tap('T','.clsbtn[data-cls="cplus"]');await g.rec(45);
console.log('after T',await p.evaluate(()=>JSON.stringify(clsOn)));
await p.evaluate(()=>{$('modes').hidden=true;ridesDone=220;$('menubtn').click();$('skillsbtn').click();});await g.tick(6);
g.setDir('c_S');await g.rec(12);await tap('S','.skup[data-skill="city"]');await g.rec(13);await tap('S','.skup[data-skill="tips"]');await g.rec(40);
console.log('after S',await p.evaluate(()=>JSON.stringify(M.skills)));
fs.writeFileSync('m_GTS.json',JSON.stringify(M_));console.log(JSON.stringify(M_));
await g.close()})()
