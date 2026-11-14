const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const args=process.argv.slice(2);const out=args[0];const list=args[1]==='all'?[...Array(+(process.env.NF||796)).keys()].slice(+args[2]||0,+args[3]||+(process.env.NF||796)):args.slice(1).map(Number);
fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({args:['--force-color-profile=srgb','--allow-file-access-from-files']});const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+__dirname+'/'+(process.env.COMP||'comp.html')+'');await p.evaluate(()=>document.fonts.ready);
const cdp=await p.context().newCDPSession(p);
for(const f of list){await p.evaluate(f=>setFrame(f),f);const r=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:95});fs.writeFileSync(out+'/'+String(f).padStart(5,'0')+'.jpg',Buffer.from(r.data,'base64'));}
await b.close()})()
