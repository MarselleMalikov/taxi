const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const FPS=30, DT=1000/FPS;
async function open({w=390,h=844,dsf=2,theme='light',lb=null}={}){
  const b=await chromium.launch({args:['--force-color-profile=srgb']});
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:dsf,isMobile:true,hasTouch:true});
  await ctx.addInitScript(th=>{try{localStorage.setItem('taxi-tut','done');localStorage.setItem('taxi-theme',th);localStorage.setItem('taxi-player',JSON.stringify({id:'x',token:'x',name:'Ринат'}));localStorage.setItem('taxi-sound',JSON.stringify({on:false,vol:0}));}catch(e){}},theme);
  await ctx.route(/workers\.dev/,r=>{ if(lb&&/lead|top|board/.test(r.request().url())) return r.fulfill({contentType:'application/json',body:JSON.stringify(lb)}); console.log('API',r.request().method(),r.request().url()); return lb? r.fulfill({contentType:'application/json',body:JSON.stringify(lb)}) : r.abort();});
  const p=await ctx.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
  await p.clock.install({time:new Date('2026-11-14T12:00:00')});
  await p.goto('file://'+path.resolve(__dirname,'../../index.html'));
  await p.clock.runFor(1500);
  await p.waitForFunction(()=>typeof tutStop==='function'&&typeof frame==='function');
  await p.evaluate(()=>{tutStop();SND.on=false;
    window.__anim=(dt)=>{for(const a of document.getAnimations()){try{ if(!a.__t){a.pause();a.__t=1;} const end=a.effect.getComputedTiming().endTime; const ct=(a.currentTime||0)+dt; if(isFinite(end)&&ct>=end){a.finish();} else a.currentTime=ct; }catch(e){}}};
  });
  await p.clock.runFor(300);
  const cdp=await ctx.newCDPSession(p);const clipR={x:0,y:0,width:w,height:h,scale:dsf};
  let n=0,dir=null;
  const api={b,p,cdp,
    setDir(d){dir=d;fs.rmSync(d,{recursive:true,force:true});fs.mkdirSync(d,{recursive:true});n=0;},
    async tick(k=1){for(let i=0;i<k;i++){await p.clock.runFor(DT);await p.evaluate(dt=>__anim(dt),DT);}},
    async shot(){const r=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:94,clip:clipR});fs.writeFileSync(path.join(dir,String(n++).padStart(5,'0')+'.jpg'),Buffer.from(r.data,'base64'));},
    async rec(frames,each){for(let i=0;i<frames;i++){ if(each) await each(i); await api.tick();await api.shot();} return n;},
    get n(){return n;},
    async close(){await b.close();}
  };
  return api;
}
module.exports={open,FPS,DT};
