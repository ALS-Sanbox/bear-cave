const {app}=require('electron');const path=require('node:path');const {pathToFileURL}=require('node:url');const {mkdir,writeFile}=require('node:fs/promises');const assert=require('node:assert/strict');
const temp=process.env.BEAR_CAVE_SMOKE_DATA;assert(temp);app.setPath('userData',temp);app.on('window-all-closed',()=>{});const imported=f=>import(pathToFileURL(path.resolve(f)).href);
let sessions,queue,store;const deadline=setTimeout(()=>{console.error('Browser download benchmark timed out');app.exit(1)},240000);
app.whenReady().then(async()=>{
 const {BrowserSessions}=await imported('dist/main/desktop/sessions.js'),{Comix}=await imported('dist/main/sources/comix.js'),{Registry}=await imported('dist/main/sources/registry.js'),{Store}=await imported('dist/main/core/store.js'),{Queue}=await imported('dist/main/engine/queue.js'),{defaults}=await imported('dist/main/core/settings.js'),{encodePath}=await imported('dist/main/sources/website.js'),{verifyOutput}=await imported('dist/main/engine/verification.js'),{ChapterOutput}=await imported('dist/main/engine/files.js');
 sessions=new BrowserSessions();const hosts=['comix.to','static.comix.to'];const source=new Comix({fastPath:true,hosts,transport:sessions.assistedTransport('comix',hosts),render:(url,mode,signal)=>sessions.render('comix',hosts,url,mode,signal)});
 const settings={...defaults(temp),pageRequests:10,globalPageRequests:10,sourceChapters:{comix:1},sourcePageRequests:{comix:6}};source.configureDownloads(settings);
 const series=await source.series(encodePath('/title/eqr1e-overgeared')),chapter=await source.chapter(encodePath('/title/eqr1e-overgeared/11547641-chapter-345'));
 store=new Store(':memory:');queue=new Queue(store,new Registry([source]),()=>settings);const job=store.enqueue(series,chapter,settings).job;
 let peak=process.memoryUsage().rss,high=0,diskMs=0;const finish=ChapterOutput.prototype.finish;
 ChapterOutput.prototype.finish=async function(...args){const start=Date.now();try{return await finish.apply(this,args);}finally{diskMs+=Date.now()-start;}};
 const sample=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);high=Math.max(high,queue.metrics().activeImages);},20);
 const cpu=process.cpuUsage(),start=Date.now();queue.start();
 try {
  for(;;){const current=store.job(job.id);if(current.state==='completed')break;if(['failed','action_required'].includes(current.state))throw Error(current.error);await new Promise(r=>setTimeout(r,50));}
  const elapsedMs=Date.now()-start,usage=process.cpuUsage(cpu),completed=store.job(job.id),metrics=queue.metrics();assert.equal((await verifyOutput(completed)).state,'verified');
  const report={source:'comix',series:series.title,chapter:chapter.number,pages:completed.done,elapsedMs,imagesPerSecond:completed.done/(elapsedMs/1000),MiBPerSecond:metrics.bytes/1048576/(elapsedMs/1000),retryCount:metrics.retries,failedImages:metrics.failedImages,maxActiveImages:high,mainProcessCpuMs:(usage.user+usage.system)/1000,mainProcessPeakRssMiB:peak/1048576,archiveFinalizationMs:diskMs,archive:'verified',date:new Date().toISOString(),note:'Actual rendered reader plus complete chapter download. CPU/RSS cover Electron main only; browser subprocesses excluded. No before/after browser speedup claimed.'};
  await mkdir('release/verification',{recursive:true});await writeFile('release/verification/browser-download-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 } finally {clearInterval(sample);ChapterOutput.prototype.finish=finish;}
 await queue.stop();await sessions.close();store.close();clearTimeout(deadline);app.exit(0);
}).catch(async e=>{console.error(e.kind||e.name,e.message);await queue?.stop();await sessions?.close();store?.close();clearTimeout(deadline);app.exit(1)});
