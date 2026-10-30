const {app,session}=require('electron');const path=require('node:path');const {pathToFileURL}=require('node:url');const assert=require('node:assert/strict');
const temp=process.env.BEAR_CAVE_SMOKE_DATA;assert(temp);app.setPath('userData',temp);app.on('window-all-closed',()=>{});let sessions;
const imported=f=>import(pathToFileURL(path.resolve(f)).href);
app.whenReady().then(async()=>{
 const {BrowserSessions}=await imported('dist/main/desktop/sessions.js'),{Comix}=await imported('dist/main/sources/comix.js'),{SafeHttp}=await imported('dist/main/sources/http.js'),{encodePath}=await imported('dist/main/sources/website.js'),{defaults}=await imported('dist/main/core/settings.js');
 sessions=new BrowserSessions();const hosts=['comix.to','static.comix.to'];const partition=session.fromPartition('persist:source-comix'),original=partition.fetch.bind(partition);
 partition.fetch=async(...args)=>{try{return await original(...args);}catch(e){console.log('Chromium fetch error:',(e.message.match(/(?:net::)?ERR_[A-Z_]+/)||[e.name])[0]);throw e;}};
 const source=new Comix({hosts,transport:sessions.transport('comix',hosts),render:(url,mode,signal)=>sessions.render('comix',hosts,url,mode,signal)});
 const id=encodePath('/title/eqr1e-overgeared/11547641-chapter-345'),pages=await source.resolve(id,AbortSignal.timeout(180000));
 console.log('Reader resolved:',pages.urls.length,'image host:',new URL(pages.urls[0]).hostname);
 const normal=new SafeHttp(0),browser=sessions.transport('comix',hosts),settings={...defaults(temp),retryAttempts:0,requestTimeoutMs:15000};
 normal.configureDownloads(settings,'comix',0,0);browser.configureDownloads(settings,'comix',0,0);
 for(const [name,options] of [['none',{}],['website',{referer:'https://comix.to/browse'}],['reader',{referer:'https://comix.to/title/eqr1e-overgeared/11547641-chapter-345',origin:'https://comix.to'}]]){
  for(const [transport,http] of [['http',normal],['session',browser]])try{const b=await http.get(pages.urls[0],hosts,AbortSignal.timeout(20000),true,options);console.log(name,transport,'success',b.length);}catch(e){console.log(name,transport,e.kind||e.name,e.message);}
 }
 await sessions.close();app.exit(0);
}).catch(async e=>{console.error(e.kind||e.name,e.message);await sessions?.close();app.exit(1)});
