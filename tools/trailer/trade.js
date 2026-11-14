const {open}=require('./lib');
(async()=>{for(let k=0;k<30;k++){const g=await open();const p=g.p;
await p.evaluate(()=>{money=486250;updateTop();$('games').hidden=false;document.querySelector('[data-game="trade"]').click();});
for(let i=0;i<120;i++)await g.tick();
g.setDir('c_E3');await g.rec(24);
await p.evaluate(()=>{const b=[...document.querySelectorAll('#tctl button')].find(x=>/Лонг/.test(x.innerText));b.id='__long';});
await g.rec(3);await p.evaluate(()=>$('__long').click());await g.rec(55);
const t=await p.evaluate(()=>document.querySelector('#tctl').innerText.slice(0,60));console.log(k,t.replace(/\n/g,' '));await g.close();
const m=t.match(/\+(\d+) ₽/);if(m&&+m[1]>=40)break;}})()
