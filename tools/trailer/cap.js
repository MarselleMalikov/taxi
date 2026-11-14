const {open}=require('./lib');const fs=require('fs');
const which=process.argv.slice(2);const want=k=>!which.length||which.includes(k);
const META={};
const save=()=>{};
function clip(g,name){g.setDir('c_'+name);const m=META[name]={taps:[],marks:{}};
  return {m,
   async tap(sel,doClick=true){const r=await g.p.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}},sel);if(!r)throw new Error('no '+sel);m.taps.push({f:g.n,x:r.x,y:r.y});
     if(doClick){await g.rec(3);await g.p.evaluate(s=>document.querySelector(s).click(),sel);}},
   mark(k){m.marks[k]=g.n;},
   done(){m.n=g.n;fs.writeFileSync('m_'+name+'.json',JSON.stringify(m));console.log(name,g.n,JSON.stringify(m.marks));}};
}
const genOrder=`(function(){for(let k=0;k<4000;k++){const o=buildOrder(car.x,car.y,carNode,300,900);if(o&&!o.airport&&!o.child&&o.tripKm>=6.5&&o.tripKm<=11&&o.surgeAdd>=40&&!o.cash&&+o.rating>=4.8)return o;}return null})()`;
const skipTo=async(p,cond)=>p.evaluate(c=>{const f=new Function('return '+c);for(let i=0;i<200000&&!f();i++){if(dialogue)chooseAnswer(0);if(evt){evt=null;}update(0.05);}updateCamera(0,true);renderPanel&&0;},cond);

async function ride(){
  const g=await open();const p=g.p;
  await p.evaluate(()=>{money=46250;updateTop();dpsDone=true;});
  await p.evaluate(`window.__o=${genOrder};if(!__o)throw new Error('no order');__o.name='Артур';`);
  console.log(await p.evaluate(()=>({km:__o.tripKm,s:__o.surgeAdd,price:__o.price,r:__o.rating})));
  if(want('A')){
  let c=clip(g,'A');
  await g.rec(24);await c.tap('#shift');await p.evaluate(()=>{spawnTimer=1e9;});
  await g.rec(24);c.mark('order');await p.evaluate(()=>{orders.push(__o);renderPanel();});
  await g.rec(48);c.mark('accept');await c.tap('.take');
  await g.rec(60);c.done();
  } else await p.evaluate(()=>{$('shift').click();spawnTimer=1e9;orders.push(__o);acceptOrder(__o.id);});
  await skipTo(p,'state==="toDropoff"');
  await p.evaluate(()=>{current.talkAt=[];current.chainChecked=true;current.sickAt=null;ff=1;updateStatus();for(let i=0;i<12;i++)update(0.05);updateCamera(0,true);});
  let c=clip(g,'B');await g.rec(110);c.done();
  c=clip(g,'C1');await g.rec(8);c.mark('dlg');await p.evaluate(()=>{startDialogue({...current,tut:true});renderPanel();});
  await g.rec(62);c.mark('ans');await c.tap('.choice[data-choice="0"]');await g.rec(34);c.done();
  await p.evaluate(()=>{current.talkAt=[];current.mood=Math.max(current.mood,2);current.stars=5;current.gift=150;});
  await skipTo(p,'state!=="toDropoff"||remainingLen()<1100');
  c=clip(g,'C2');
  for(let i=0;i<200&&(await p.evaluate(()=>state))!=='idle';i++)await g.rec(1);
  await p.evaluate(()=>{spawnTimer=1e9;orders=[];renderPanel();});
  c.mark('done');await g.rec(70);c.done();
  console.log(await p.evaluate(()=>panel.querySelector('.result')?.innerText));
  await g.close();
}
async function night(){
  const g=await open({theme:'dark'});const p=g.p;
  await p.evaluate(()=>{dpsDone=true;$('shift').click();spawnTimer=1e9;clock=12.4*3600;onlineT=0;money=52480;goalRides=17;rain={start:clock-420,end:clock+2.3*3600};rainShown=0;updateTop();renderPanel();updateCamera(0,true);});
  await p.evaluate(`window.__o=${genOrder.replace('o.surgeAdd>=40','o.surgeAdd>=90')};if(!__o)throw new Error('no order');`);
  let c=clip(g,'D');await g.rec(22);c.mark('order');await p.evaluate(()=>{orders.push(__o);renderPanel();});
  await g.rec(42);c.mark('accept');await c.tap('.take');await p.evaluate(()=>{ff=2;updateStatus();});await g.rec(50);c.done();
  await g.close();
}
async function extras(){
  const names=['Айдар','Тимур_02','Ринат','Эльвира','Марсель','Рустам','UfaDriver','Азат','Гульнара','Ильдар','Радмир','Камила'];
  const lb={list:names.map((n,i)=>({id:n==='Ринат'?'x':'p'+i,name:n,stage:i<4?2:i<8?1:0,best:14850-i*610-(i*i*37)%300,bestRides:34-i})),place:{best:3},me:null};
  const g=await open({lb});const p=g.p;
  await p.evaluate(()=>{money=486250;M.careerShifts=8;ridesDone=100;M.open={comfort:true,cplus:true};updateTop();});
  let c=clip(g,'E1');await p.evaluate(()=>$('menubtn').click());await g.tick(3);
  await g.rec(14);await c.tap('#salonbtn');c.mark('open');await g.rec(10);
  await g.rec(45,async i=>p.evaluate(i=>{const e=document.querySelector('#salon .gcard');const k=Math.min(1,i/8);e.scrollTop+=5.2*k;},i));c.done();
  await p.evaluate(()=>{$('salon').hidden=true;showLeaders();});await p.waitForTimeout(300);await g.tick(4);await p.waitForTimeout(200);
  c=clip(g,'E4');await g.rec(55,async i=>p.evaluate(i=>{const e=document.querySelector('#leaders .gcard, #leaders .askcard');if(i>18)e.scrollTop+=3;},i));c.done();
  await p.evaluate(()=>{$('leaders').hidden=true;showCasino();document.querySelector('[data-chip="1000"]').click();if(!betKinds.has('red'))document.querySelector('.bet.red').click();});
  c=clip(g,'E2');await g.rec(8);
  await p.evaluate(()=>{window.__r=Math.random;Math.random=()=>1/37+0.004;});await c.tap('#cspin');await p.evaluate(()=>{Math.random=__r;});
  await g.rec(50);c.mark('skip');
  for(let i=0;i<150;i++)await g.tick();
  await g.rec(90);c.done();
  console.log(await p.evaluate(()=>$('cres').innerText));
  await p.evaluate(()=>{$('casino').hidden=true;$('games').hidden=false;document.querySelector('[data-game="trade"]').click();});
  for(let i=0;i<120;i++)await g.tick();
  console.log(await p.evaluate(()=>$('tctl').innerHTML.slice(0,1500)));
  c=clip(g,'E3');await g.rec(24);
  const sel=await p.evaluate(()=>{const b=[...document.querySelectorAll('#tctl button')].find(x=>/Лонг/.test(x.innerText));b.id='__long';return '#__long'});
  await c.tap(sel);c.mark('long');await g.rec(55);c.done();console.log('PNL',await p.evaluate(()=>document.querySelector('#tctl').innerText.slice(0,80)));
  await g.close();
}
async function hook(){
  const g=await open({w:540,h:960});const p=g.p;
  await p.addStyleTag({content:'#app{max-width:none!important}#app>*:not(#map){display:none!important}#toast,#evt,#call,#ask,#tut{display:none!important}'});
  await p.evaluate(()=>{window.dispatchEvent(new Event('resize'));online=true;spawnTimer=1e9;dpsDone=true;tickEvents=function(){};});
  const c=clip(g,'H');const N=84;
  await g.rec(N,async i=>p.evaluate(([i,N])=>{const u=i/(N-1),e=1-Math.pow(1-u,2.2);const s=0.04*Math.pow(0.27/0.04,e);freeCam=true;freeIdle=-1e9;scale=s;viewW=cw/scale;viewH=ch/scale;const y0=car.y+2500,x0=car.x-1500;camX=x0+(car.x-x0)*e;camY=y0+(car.y-y0)*e;zoomUntil=0;blayer.valid=false;},[i,N]));
  c.done();await g.close();
}
(async()=>{
  if(want('ride')||want('A'))await ride();
  if(want('night'))await night();
  if(want('extras'))await extras();
  if(want('hook'))await hook();
})().catch(e=>{console.error(e);process.exit(1)});
