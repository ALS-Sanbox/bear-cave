import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../dist/main/core/store.js';
import { defaults } from '../dist/main/core/settings.js';
import { hashPassword } from '../dist/main/server/auth.js';
import { CdpPipe } from '../dist/main/desktop/cdp-pipe.js';

const executable=path.resolve(process.argv[2] || 'release/0.4.0/win-unpacked/Bear Cave.exe');
const portable=path.basename(executable).includes('Portable');
const root=await mkdtemp(path.join(os.tmpdir(),'bear-cave-packaged-'));
const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p));});});
const settings={...defaults(path.join(root,'downloads')),port};
const store=new Store(path.join(root,'bear-cave.sqlite'));
store.set('settings',settings);store.set('queue-paused',true);store.set('admin-hash',await hashPassword('isolated packaged fixture password'));store.close();
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[`--user-data-dir=${root}`,...(portable?['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']:['--remote-debugging-pipe'])],{windowsHide:true,stdio:portable?['ignore','pipe','pipe']:['ignore','pipe','pipe','pipe','pipe'],env});
let errors='';child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-4000);});
child.stdout.resume();
let exit;const exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{exit={code,signal};resolve(exit);});child.once('error',error=>{exit={error:error.message};resolve(exit);});});
let client=portable?undefined:new CdpPipe(child.stdio[3],child.stdio[4],15000);
async function portableDebugger(){
    const end=Date.now()+15000;let lines;
    while(!lines){try{lines=(await readFile(path.join(root,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);}catch{if(Date.now()>end)throw Error('Portable debugger did not start');await delay(100);}}
    const socket=new WebSocket(`ws://127.0.0.1:${Number(lines[0])}${lines[1]}`);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let id=0;const pending=new Map();
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data),entry=pending.get(message.id);if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(message.error.message)):entry.resolve(message.result);}});
    socket.addEventListener('close',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Debugger closed'));}pending.clear();});
    return {send(method){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Debugger request timed out'));},15000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method}));});},close(){socket.close();}};
}
const origin=`http://127.0.0.1:${port}`;
try {
    const end=Date.now()+60000;
    for(;;){if(exit)throw Error('Packaged process exited before startup: '+JSON.stringify(exit)+' '+errors);try{const r=await fetch(origin+'/api/session');if(r.ok)break;}catch{}if(Date.now()>end)throw Error('Packaged dashboard startup timed out: '+errors);await delay(100);}
    const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'isolated packaged fixture password'})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const sources=await(await fetch(origin+'/api/sources',{headers:{Cookie:cookie}})).json();
    assert.equal(sources.filter(s=>s.status==='operational').length,9);assert(sources.some(s=>s.id==='mangafreak'));assert(sources.some(s=>s.id==='toongod'&&s.status!=='operational'));
    const performance=await(await fetch(origin+'/api/performance',{headers:{Cookie:cookie}})).json();assert.equal(performance.performanceProfile,'balanced');
    const summary=await(await fetch(origin+'/api/summary',{headers:{Cookie:cookie}})).json();assert.equal(summary.performance.activeImages,0);
    const page=await(await fetch(origin)).text();assert(page.includes('/assets/'));
    if(portable)client=await portableDebugger();
    await client.send('Browser.getVersion');
    await client.send('Browser.close').catch(()=>{});
    await Promise.race([exited,delay(20000)]);
    assert(exit,'Packaged app did not shut down');assert.equal(exit.code,0);
    const log=await readFile(path.join(root,'bear-cave.log'),'utf8');assert(log.includes('Clean shutdown'));
    await mkdir('release/verification',{recursive:true});
    const report={executable,date:new Date().toISOString(),platform:process.platform,arch:process.arch,checks:['packaged startup','bundled Node/SQLite/native modules','isolated existing settings/database','authenticated dashboard','nine operational adapters','ToonGod unavailable','performance settings','queue telemetry','frontend assets','clean shutdown'],passed:true};
    await writeFile(portable?'release/verification/packaged-portable-smoke.json':'release/verification/packaged-smoke.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
} finally {
    client?.close();if(!exit){if(portable&&child.pid){const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(resolve=>kill.once('exit',resolve));}else child.kill();await Promise.race([exited,delay(5000)]);}
    if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('bear-cave-packaged-'))throw Error('Invalid test cleanup path');
    await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
