// Offline regression: click real Vue controls through HTTP/SQLite/queue to validated CBZ output.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {setTimeout:delay}=require('node:timers/promises');
const temp=process.env.BEAR_CAVE_SMOKE_DATA;assert(temp);app.setPath('userData',temp);
let store,queue,dashboard,window;
const imported=file=>import(pathToFileURL(path.resolve(file)).href);
async function until(fn,label){const start=Date.now();while(!await fn()){if(Date.now()-start>12000)throw Error('Timed out: '+label);await delay(25);}}
app.whenReady().then(async()=>{
  const [{Store},{Queue},{Registry},{createDashboard},{hashPassword},{defaults},{SourceError}]=await Promise.all([
    imported('dist/main/core/store.js'),imported('dist/main/engine/queue.js'),imported('dist/main/sources/registry.js'),imported('dist/main/server/server.js'),imported('dist/main/server/auth.js'),imported('dist/main/core/settings.js'),imported('dist/main/shared/types.js')
  ]);
  const settings=defaults(temp);store=new Store(path.join(temp,'download.sqlite'));store.set('admin-hash',await hashPassword('download test password'));
  const series={id:'fixture-series',source:'mangadex',title:'Download fixture',description:'A long deterministic chapter list.'};
  const chapters=Array.from({length:1000},(_,i)=>({id:`fixture-chapter-${i+1}`,source:'mangadex',seriesId:series.id,title:`Fixture ${i+1}`,number:String(i+1),volume:'',language:'en',groups:[],pages:2,external:false}));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4RkAAAAASUVORK5CYII=','base64');
  let failPreview=false,allowAll=false,activeListings=0;
  const source={manifest:{id:'mangadex',name:'Fixture source',website:'https://fixture.example/',status:'operational',interfaceVersion:1,capabilities:['search','series','chapters','public-download'],apiHosts:['fixture.example'],imageHosts:['fixture.example'],recommended:{chapters:1,pageRequests:1,requestIntervalMs:1000}},search:async()=>({items:[series],total:1,offset:0,limit:20}),series:async()=>series,chapters:async(_id,_filter,offset,signal)=>{activeListings++;try{await delay(150,undefined,{signal});if(failPreview)throw new SourceError('Fixture source unavailable. Try again.');if(offset>0&&!allowAll)throw new SourceError('Single selection scanned unrelated chapter pages.');return{items:chapters.slice(offset,offset+100),total:chapters.length,offset,limit:100};}finally{activeListings--;}},chapter:async id=>chapters.find(c=>c.id===id),resolve:async()=>({revision:'fixture',urls:['https://fixture.example/1.png','https://fixture.example/2.png']}),readPage:async()=>png};
  const registry=new Registry([source]);queue=new Queue(store,registry,()=>settings);dashboard=createDashboard(store,queue,registry,()=>settings,path.resolve('dist/ui'));const port=await dashboard.listen(0);
  window=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const js=script=>window.webContents.executeJavaScript(script,true).catch(error=>{throw new Error(`${error.message}\nRenderer script: ${script}`);});
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const dialogText=()=>js('document.querySelector(".download-dialog").innerText');
  const close=()=>click('.dialog-actions button');
  await window.loadURL(`http://127.0.0.1:${port}`);
  await until(()=>js('!!document.querySelector(".login button:not(:disabled)")'),'login ready');
  await js(`(()=>{const input=document.querySelector('input[type=password]');input.value='download test password';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.login form').requestSubmit();})()`);
  await until(()=>js('!!document.querySelector(".searchbar")'),'signed in');
  await js(`(()=>{const input=document.querySelector('.searchbar input');input.value='fixture';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.searchbar').requestSubmit();})()`);
  await until(()=>js('!!document.querySelector(".result")'),'search results');await click('.result');
  await until(()=>js('document.querySelectorAll(".chapters tbody tr").length===100'),'long chapter list');
  assert.equal(await js('getComputedStyle(document.querySelector("button.primary")).backgroundColor'),'rgb(167, 71, 11)');
  // Click deep in a long table. The old inline confirmation was below the entire list.
  await js('const row=document.querySelectorAll(".chapters tbody tr")[50];row.scrollIntoView({block:"center"});row.querySelector("button").click()');
  assert(await js('document.querySelector(".download-dialog").open'));
  assert((await dialogText()).includes('Checking chapter availability'));
  await until(async()=>(await dialogText()).includes('Confirm 1 downloads'),'visible count confirmation');
  assert(await js('const r=document.querySelector(".download-dialog").getBoundingClientRect();r.top>=0&&r.bottom<=innerHeight'));
  assert.equal(store.jobs().length,0);await close();assert.equal(store.jobs().length,0);
  // Cancelling a pending request restores controls and never queues work.
  await click('.chapters tbody tr button');await close();await until(()=>activeListings===0,'cancelled listing stopped');
  assert.equal(await js('document.querySelector(".download-dialog").open'),false);assert.equal(store.jobs().length,0);
  failPreview=true;await click('.chapters tbody tr button');await until(async()=>(await dialogText()).includes('Fixture source unavailable'),'visible source error');await close();failPreview=false;
  // Selected and all matching use the same visible modal; neither enqueues before confirmation.
  await click('tbody tr:nth-child(1) input[type=checkbox]');
  await click('tbody tr:nth-child(2) input[type=checkbox]');
  await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.startsWith("Download selected")).click()');
  await until(async()=>(await dialogText()).includes('Confirm 2 downloads'),'selected confirmation');await close();
  allowAll=true;await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Preview all matching")).click()');
  await until(async()=>(await dialogText()).includes('Confirm 1000 downloads'),'all matching count');await close();assert.equal(store.jobs().length,0);allowAll=false;
  await click('.chapters tbody tr button');await until(async()=>(await dialogText()).includes('Confirm 1 downloads'),'single download ready');await click('.dialog-actions .primary');
  await until(()=>store.states('completed').length===1,'real queue writes and validates CBZ');
  await until(()=>js('!document.querySelector(".download-dialog").open && document.querySelector("nav .current").textContent.includes("Download queue")'),'automatic queue navigation');
  assert.equal(store.jobs().length,1);assert(fs.existsSync(store.jobs()[0].output));
  console.log('Download UI smoke passed: dark-orange theme, visible modal/loading/errors, cancellation, selected/all counts, actual click-to-CBZ and queue navigation.');
  window.destroy();await dashboard.close();await queue.stop();store.close();app.exit(0);
}).catch(async e=>{console.error(e);try{window?.destroy();await dashboard?.close();await queue?.stop();store?.close();}catch{}app.exit(1);});
