// Explicit live cover check; the runner supplies and cleans up an isolated profile.
const {app}=require('electron');const path=require('node:path');const {pathToFileURL}=require('node:url');const assert=require('node:assert/strict');
const temp=process.env.BEAR_CAVE_SMOKE_DATA;assert(temp);app.setPath('userData',temp);app.on('window-all-closed',()=>{});let sessions,covers;
const imported=file=>import(pathToFileURL(path.resolve(file)).href);
const timer=setTimeout(()=>{console.error('Cover check timed out');sessions?.close();app.exit(1)},150000);
app.whenReady().then(async()=>{
 const {BrowserSessions}=await imported('dist/main/desktop/sessions.js');const {Comix}=await imported('dist/main/sources/comix.js');const {imageExtension}=await imported('dist/main/engine/files.js');const {Registry}=await imported('dist/main/sources/registry.js');const {CoverCache}=await imported('dist/main/server/covers.js');const {encodePath}=await imported('dist/main/sources/website.js');
 sessions=new BrowserSessions();const hosts=['comix.to','static.comix.to'];const source=new Comix({hosts,transport:sessions.transport('comix',hosts),render:(url,mode,signal)=>sessions.render('comix',hosts,url,mode,signal)});
 const started=performance.now(),results=await source.search('',0,AbortSignal.timeout(40000));assert(results.items.length,'Live Comix results');const browseMs=performance.now()-started;
 const detailStart=performance.now(),detail=await source.series(encodePath('/title/6e5k8-from-the-dust'),AbortSignal.timeout(40000));const detailMs=performance.now()-detailStart;
 const repeat=performance.now();await source.search('');await source.series(detail.id);console.log('Comix timing (ms):',JSON.stringify({firstSearch:Math.round(browseMs),firstDetails:Math.round(detailMs),cachedSearchAndDetails:Math.round(performance.now()-repeat)}));
 covers=new CoverCache(new Registry([source]));
 for(const series of [...results.items.slice(0,2),detail]){covers.remember(series);const bytes=await covers.get('comix',series.id);assert.equal(imageExtension(bytes),'png');console.log('Live Comix thumbnail:',series.title,bytes.length,'PNG');}
 await covers.stop();sessions.close();clearTimeout(timer);app.exit(0);
}).catch(async e=>{console.error(e);await covers?.stop();sessions?.close();clearTimeout(timer);app.exit(1)});
