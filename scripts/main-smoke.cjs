// Exercise the actual desktop entry point with temporary SQLite/app data and hidden windows.
const {app,BrowserWindow,dialog}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const net=require('node:net');
const temp=process.env.BEAR_CAVE_SMOKE_DATA;assert(temp);
const conflict=process.argv.includes('--port-conflict');let heldPort;
app.setPath('userData',temp);app.setName('Bear Cave Desktop Smoke');
app.on('browser-window-created',(_event,w)=>w.hide());
let dialogError='';dialog.showErrorBox=(_title,message)=>{dialogError=message;};
const imported=relative=>import(pathToFileURL(path.resolve(relative)).href);
app.whenReady().then(async()=>{
  const {Store}=await imported('dist/main/core/store.js');
  const {defaults}=await imported('dist/main/core/settings.js');
  const {hashPassword}=await imported('dist/main/server/auth.js');
  const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.on('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;if(conflict){heldPort=probe;resolve(port);}else probe.close(()=>resolve(port));});});
  const settings=defaults(temp);settings.port=port;
  const store=new Store(path.join(temp,'bear-cave.sqlite'));store.set('settings',settings);store.set('admin-hash',await hashPassword('temporary desktop password'));store.close();
  await imported('dist/main/desktop/main.js');
  const until=async fn=>{const start=Date.now();while(!await fn()){if(Date.now()-start>10000)throw Error('Desktop startup timed out: '+dialogError);await new Promise(r=>setTimeout(r,30));}};
  if(!conflict){await until(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/api/session`)).ok;}catch{return false;}});app.emit('second-instance',{},[],process.cwd());}
  await until(()=>BrowserWindow.getAllWindows().length===1);
  const w=BrowserWindow.getAllWindows()[0];await until(async()=>!w.webContents.isLoading() && await w.webContents.executeJavaScript('typeof window.bearCaveLocal === "object"'));
  const data=await w.webContents.executeJavaScript('window.bearCaveLocal.read()');assert.equal(data.adminConfigured,true);assert.equal(data.settings.downloadRoot,temp);assert.equal(data.sources.filter(s=>s.status==='operational').length,9);assert.equal(data.mangaAccount.connected,false);
  const rejected=await w.webContents.executeJavaScript('window.bearCaveLocal.mangaConnect({clientId:"invalid",clientSecret:"fixture-secret",username:"fixture",password:"fixture-password"})');assert.equal(rejected.ok,false);assert(!JSON.stringify(rejected).includes('fixture-password'));assert(!JSON.stringify(rejected).includes('fixture-secret'));
  assert((await w.webContents.executeJavaScript('document.body.innerText')).includes('MangaDex account'));
  const scan=await w.webContents.executeJavaScript('window.bearCaveLocal.stagingScan()');assert.equal(scan.entries.length,0);assert.equal(typeof scan.token,'string');dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});const kept=await w.webContents.executeJavaScript(`window.bearCaveLocal.stagingClean(${JSON.stringify(scan.token)})`);assert.equal(kept.removed,0);
  w.close();assert.equal(w.isDestroyed(),false);assert.equal(w.isVisible(),false);if(!conflict)assert((await fetch(`http://127.0.0.1:${port}/api/session`)).ok);
  app.emit('second-instance',{},[],process.cwd());assert.equal(BrowserWindow.getAllWindows().length,1);w.hide();if(conflict){assert(dialogError.includes(String(port)));assert(dialogError.includes('Settings'));heldPort.close();}else assert.equal(dialogError,'');
  app.once('will-quit',()=>{const persisted=new Store(path.join(temp,'bear-cave.sqlite'));assert.equal(persisted.get('settings').port,port);persisted.close();console.log(conflict?'Desktop conflict smoke passed: useful error, local Settings remains accessible, clean Quit.':'Desktop smoke passed: actual main startup/tray creation, trusted settings IPC, second-instance reuse, close-to-tray and clean Quit.');});
  app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
