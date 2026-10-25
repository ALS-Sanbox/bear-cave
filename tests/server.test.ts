import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { describe,it,expect,vi } from 'vitest';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { Store } from '../src/core/store.js';
import { Queue } from '../src/engine/queue.js';
import { Registry } from '../src/sources/registry.js';
import { createDashboard } from '../src/server/server.js';
import { hashPassword,verifyPassword } from '../src/server/auth.js';
import { SourceError } from '../src/shared/types.js';
import { workspace,chapter,adapter } from './helpers.js';
async function harness(count = 2, adapters?: ReturnType<typeof adapter>[]) {
  const w=await workspace(),store=new Store(':memory:');const ch=chapter();const registry=new Registry(adapters??[adapter(count === 2 ? [ch,{...chapter(),number:ch.number}] : Array.from({length:count},(_,i)=>chapter({number:String(i+1)})))]);
  const queue=new Queue(store,registry,()=>w.settings);store.set('queue-paused',true);store.set('admin-hash',await hashPassword('correct horse battery staple'));
  const dashboard=createDashboard(store,queue,registry,()=>w.settings,path.resolve('dist/ui'));const port=await dashboard.listen(0),origin=`http://127.0.0.1:${port}`;
  let cookie='',csrf='';
  async function request(route:string,body?:unknown,extra:Record<string,string>={}):Promise<Response> {return new Promise((resolve,reject)=>{const req=httpRequest(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin,'X-CSRF-Token':csrf}),Cookie:cookie,...extra}},res=>{const parts:Buffer[]=[];res.on('data',p=>parts.push(p));res.on('end',()=>{const headers=new Headers();for(const [key,value]of Object.entries(res.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers}));});res.on('error',reject);});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}
  async function login(extra:Record<string,string>={}){const r=await request('/api/login',{password:'correct horse battery staple'},extra);cookie=r.headers.get('set-cookie')?.split(';')[0]??'';csrf=(await r.json()).csrf;return r;}
  return {w,store,queue,registry,dashboard,origin,request,login,cleanup:async()=>{await dashboard.close();await queue.stop();store.close();await w.cleanup();}};
}
describe('dashboard security and queue API',()=> {
  it('checks an external ZIP folder and reports completed chapters without rewriting files',async()=>{
    const h=await harness(1);try{
      await h.login();const source=h.registry.get('mangadex'),series=await source.series('11111111-1111-4111-8111-111111111111');
      const page=await source.chapters(series.id,{language:'en'},0),dir=path.join(h.w.dir,series.title);await mkdir(dir);
      const png=await sharp({create:{width:3,height:4,channels:3,background:'#a7470b'}}).png().toBuffer(),bytes=Buffer.from(zipSync({'1/001.png':png,'1/002.png':png})),file=path.join(dir,'Manga - 1.zip');await writeFile(file,bytes);
      const scan=await h.request('/api/library-scan',{source:'mangadex',seriesId:series.id,language:'en'});expect(scan.status).toBe(200);expect(await scan.json()).toMatchObject({folderFound:true,imported:1,completed:1});
      const current=await(await h.request(`/api/chapters?source=mangadex&id=${series.id}`)).json();expect(current.items[0].localState).toBe('completed');expect(current.items[0].localJobId).toBeTruthy();
      expect(await readdir(dir)).toEqual(['Manga - 1.zip']);
      const preview=await(await h.request('/api/preview',{source:'mangadex',seriesId:series.id,language:'en',ids:[page.items[0].id]})).json();expect(preview.count).toBe(0);expect(preview.completed).toBe(1);
      expect(await readFile(file)).toEqual(bytes);
      expect((await h.request('/api/library-scan',{source:'mangadex',seriesId:series.id,language:'en',folder:'../outside'})).status).toBe(400);
    }finally{await h.cleanup();}
  });
  it('uses the configured JPG cover default and permits an explicit PNG override',async()=>{
    const h=await harness(1);try{
      await h.login();h.w.settings.coverFormat='jpg';const source=h.registry.get('mangadex');source.cover=async()=>sharp({create:{width:3,height:4,channels:3,background:'#a7470b'}}).png().toBuffer();
      const series=await source.series('11111111-1111-4111-8111-111111111111');
      expect(await(await h.request('/api/cover',{source:'mangadex',id:series.id})).json()).toMatchObject({filename:'coverart.jpg'});
      expect((await sharp(await readFile(path.join(h.w.dir,series.title,'coverart.jpg'))).metadata()).format).toBe('jpeg');
      expect(await(await h.request('/api/cover',{source:'mangadex',id:series.id,format:'png'})).json()).toMatchObject({filename:'coverart.png'});
      expect((await sharp(await readFile(path.join(h.w.dir,series.title,'coverart.png'))).metadata()).format).toBe('png');
      expect((await h.request('/api/cover',{source:'mangadex',id:series.id,format:'svg'})).status).toBe(400);
    }finally{await h.cleanup();}
  });
  it('streams fast source results and isolated errors before slow sources finish, and cancels on disconnect',async()=>{
    let cancelled=false;
    const fast=adapter(),slow=adapter(),broken=adapter();
    const search=fast.search;
    fast.search=async(...args)=>{const page=await search(...args);return{...page,items:page.items.map(s=>({...s,coverRef:'https://private-fixture.example/cover.jpg'}))};};
    slow.manifest={...slow.manifest,id:'slowfixture',name:'Slow'};
    slow.search=async(_query,_offset,signal)=>new Promise((_resolve,reject)=>{signal!.addEventListener('abort',()=>{cancelled=true;reject(signal!.reason)},{once:true});});
    broken.manifest={...broken.manifest,id:'brokenfixture',name:'Broken'};
    broken.search=async()=>{throw new SourceError('Fixture source unavailable','action_required');};
    const h=await harness(2,[fast,slow,broken]),controller=new AbortController();
    try{
      expect((await h.request('/api/search-all?q=fixture')).status).toBe(401);
      await h.login();
      const session=h.dashboard.auth.sessions.values().next().value!;
      const response=await fetch(h.origin+'/api/search-all?q=fixture',{headers:{Cookie:`bc_session=${session.id}`},signal:controller.signal});
      expect(response.headers.get('content-type')).toContain('application/x-ndjson');
      const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';
      while(text.trim().split('\n').length<2)text+=decoder.decode((await reader.read()).value,{stream:true});
      const events=text.trim().split('\n').map(line=>JSON.parse(line));
      expect(events.find(e=>e.source==='mangadex').page.items[0].coverRef).toBeUndefined();
      expect(events.find(e=>e.source==='brokenfixture').error).toBe('Fixture source unavailable');
      expect(events.some(e=>e.source==='slowfixture')).toBe(false);
      controller.abort();await reader.cancel().catch(()=>{});
      await vi.waitFor(()=>expect(cancelled).toBe(true));
      expect((await h.request('/api/search-all?q=')).status).toBe(400);
    }finally{controller.abort();await h.cleanup();}
  });
  it('returns series metadata without loading chapters or changing saved verification',async()=>{
    const h=await harness();try{
      await h.login();const source=h.registry.get('mangadex');
      const chapters=vi.spyOn(source,'chapters').mockRejectedValue(Error('Catalog is slow or unavailable'));
      const c=chapter(),series=await source.series(c.seriesId);
      const job=h.store.enqueue(series,c,h.w.settings).job;
      h.store.update(job.id,{state:'completed',output:path.join(h.w.dir,'missing.cbz'),verification:{state:'verified',checked:new Date().toISOString()}});
      const result=await h.request(`/api/series?source=mangadex&id=${series.id}`);
      expect(result.status).toBe(200);expect((await result.json()).title).toBe(series.title);
      expect(chapters).not.toHaveBeenCalled();expect(h.store.job(job.id)?.verification?.state).toBe('verified');
      expect(await readdir(h.w.dir)).toEqual([]);
    }finally{await h.cleanup();}
  });
  it('verifies saved history after its source has been removed',async()=>{const h=await harness();try{
    await h.login();const c=chapter({source:'toongod'}),j=h.store.enqueue({id:c.seriesId,source:c.source,title:'Removed source fixture',description:''},c,h.w.settings).job;
    h.store.update(j.id,{state:'completed',output:path.join(h.w.dir,'missing.cbz')});
    const response=await h.request('/api/jobs/verify',{id:j.id});expect(response.status).toBe(200);expect((await response.json()).state).toBe('missing');expect(h.store.job(j.id)?.state).toBe('completed');
  }finally{await h.cleanup();}});

  it('does not create series folders when searching, viewing, previewing, or queueing paused downloads',async()=>{const h=await harness();try{
    await h.login();const id='11111111-1111-4111-8111-111111111111';
    for(const route of ['/api/search?source=mangadex&q=fixture',`/api/series?source=mangadex&id=${id}`,`/api/chapters?source=mangadex&id=${id}`]){expect((await h.request(route)).status).toBe(200);expect(await readdir(h.w.dir)).toEqual([]);}
    const preview=await(await h.request('/api/preview',{source:'mangadex',seriesId:id,language:'en',all:true})).json();expect(preview.count).toBe(2);expect(await readdir(h.w.dir)).toEqual([]);
    expect((await h.request('/api/enqueue',{token:preview.token,confirmTranslations:true})).status).toBe(200);expect(h.store.jobs()).toHaveLength(2);expect(await readdir(h.w.dir)).toEqual([]);
  }finally{await h.cleanup();}});

  it('selects all 187 server-side regardless of filters, excludes stable IDs and deduplicates repeated submissions',async()=>{const h=await harness(187);try{
    await h.login(); const id='11111111-1111-4111-8111-111111111111';
    const page=await(await h.request(`/api/chapters?source=mangadex&id=${id}`)).json();
    const excluded=page.items[0].id;
    const preview=await(await h.request('/api/preview',{source:'mangadex',seriesId:id,language:'fr',group:'ignored',all:true,exclude:[excluded]})).json();
    expect(preview.count).toBe(186);
    expect((await h.request('/api/enqueue',{token:preview.token,confirmTranslations:true})).status).toBe(200);
    expect((await h.request('/api/enqueue',{token:preview.token,confirmTranslations:true})).status).toBe(400);
    expect(h.store.jobs()).toHaveLength(186);expect(h.store.jobs().some(j=>j.chapter.id===excluded)).toBe(false);
  }finally{await h.cleanup();}});

  it('paginates history, reports chapter status, and keeps output paths private',async()=>{const h=await harness();try{await h.login();const a=chapter(),j=h.store.enqueue({id:a.seriesId,source:a.source,title:'History fixture',description:''},a,h.w.settings).job;h.store.update(j.id,{state:'completed',output:path.join(h.w.dir,'private','file.cbz'),seriesFolder:path.join(h.w.dir,'private'),previousOutputs:[path.join(h.w.dir,'older.cbz')],verification:{state:'missing',checked:new Date().toISOString()}});const queue=await(await h.request('/api/jobs')).json();expect(queue.jobs).toHaveLength(0);const history=await(await h.request('/api/jobs?history=true&limit=1&q=History&state=missing')).json();expect(history.total).toBe(1);expect(history.counts.completed).toBe(1);expect(JSON.stringify(history)).not.toContain(h.w.dir);const status=await(await h.request('/api/chapter-status',{source:a.source,ids:[a.id]})).json();expect(status[a.id]).toBe('missing');expect((await h.request('/api/jobs/verify',{id:j.id,path:'C:/private'})).status).toBe(400);}finally{await h.cleanup();}});
  it('persists follow preferences and reuses the guarded confirmation preview',async()=>{const h=await harness();try{await h.login();const record=await(await h.request('/api/follows',{source:'mangadex',seriesId:'11111111-1111-4111-8111-111111111111',language:'en',intervalHours:6,enabled:false,autoDownload:false,outputFormat:'folders'})).json();expect(record.autoDownload).toBe(false);expect(record.outputFormat).toBe('folders');const preview=await(await h.request(`/api/follows/${record.id}/preview`,{})).json();expect(preview.count).toBe(2);expect(preview.multipleTranslations).toBe(1);expect((await h.request('/api/enqueue',{token:preview.token,confirmTranslations:false})).status).toBe(400);expect((await h.request('/api/enqueue',{token:preview.token,confirmTranslations:true})).status).toBe(200);expect(h.store.jobs().every(j=>j.format==='folders')).toBe(true);expect((await h.request('/api/follows',{source:'mangadex',seriesId:record.series.id,language:'en',intervalHours:0})).status).toBe(400);expect((await h.request(`/api/follows/${record.id}/remove`,{})).status).toBe(200);expect(h.store.follows()).toHaveLength(0);}finally{await h.cleanup();}});
  it('replaces cancelled previews without exhausting the session cache',async()=>{const h=await harness();try{await h.login();let previous='',latest='';for(let i=0;i<12;i++){const response=await h.request('/api/preview',{source:'mangadex',seriesId:'11111111-1111-4111-8111-111111111111',language:'en'});expect(response.status).toBe(200);previous=latest;latest=(await response.json()).token;}expect(h.store.jobs()).toHaveLength(0);expect((await h.request('/api/enqueue',{token:previous,confirmTranslations:true})).status).toBe(400);expect((await h.request('/api/enqueue',{token:latest,confirmTranslations:true})).status).toBe(200);}finally{await h.cleanup();}});
  it('stores a salted scrypt hash and verifies it without recoverable passwords',async()=>{const a=await hashPassword('correct horse battery staple'),b=await hashPassword('correct horse battery staple');expect(a).not.toBe(b);expect(a).not.toContain('correct horse');expect(await verifyPassword('correct horse battery staple',a)).toBe(true);expect(await verifyPassword('wrong',a)).toBe(false);await expect(hashPassword('short')).rejects.toThrow();});
  it('protects all API routes and exposes no remote setup/settings/filesystem route',async()=>{const h=await harness();try{expect((await h.request('/api/jobs')).status).toBe(401);expect((await h.request('/api/settings')).status).toBe(401);const session=await (await h.request('/api/session')).json();expect(session.authenticated).toBe(false);expect(JSON.stringify(session)).not.toContain('scrypt');await h.login();for(const route of ['/api/settings','/api/folder','/api/setup','/api/browser'])expect((await h.request(route)).status).toBe(404);const jobs=await (await h.request('/api/jobs')).json();expect(JSON.stringify(jobs)).not.toContain(h.w.dir);expect((await h.request('/../package.json')).status).toBe(404);}finally{await h.cleanup();}});
  it('issues HttpOnly cookies, rejects CSRF and foreign origins, and invalidates logout',async()=>{const h=await harness();try{const login=await h.login();expect(login.headers.get('set-cookie')).toContain('HttpOnly');expect(login.headers.get('set-cookie')).toContain('SameSite=Strict');expect(login.headers.get('set-cookie')).not.toContain('; Secure');expect((await h.request('/api/queue',{action:'resume'},{'X-CSRF-Token':'wrong'})).status).toBe(403);expect((await h.request('/api/queue',{action:'resume'},{Origin:'https://evil.example'})).status).toBe(403);expect((await h.request('/api/queue',{action:'resume'},{Origin:''})).status).toBe(403);expect((await h.request('/api/logout',{})).status).toBe(200);expect((await h.request('/api/jobs')).status).toBe(401);}finally{await h.cleanup();}});
  it('rejects arbitrary hosts/forwarded headers and uses Secure cookies only for configured HTTPS tunnel',async()=>{const h=await harness();try{expect((await h.request('/api/session',undefined,{Host:'evil.example','X-Forwarded-Host':'127.0.0.1'})).status).toBe(403);h.w.settings.publicUrl='https://bearcave.lionhosting.net';expect((await h.request('/api/session',undefined,{Host:'bearcave.lionhosting.net','X-Forwarded-Proto':'https'})).status).toBe(403);h.w.settings.trustTunnel=true;expect((await h.request('/api/session',undefined,{Host:'bearcave.lionhosting.net','X-Forwarded-Proto':'http'})).status).toBe(403);const login=await h.login({Host:'bearcave.lionhosting.net','X-Forwarded-Proto':'https',Origin:'https://bearcave.lionhosting.net'});expect(login.status).toBe(200);expect(login.headers.get('set-cookie')).toContain('; Secure');expect(login.headers.get('strict-transport-security')).toContain('max-age');}finally{await h.cleanup();}});
  it('rate-limits failed logins and has no unauthenticated account claim route',async()=>{const h=await harness();try{for(let i=0;i<5;i++)expect((await h.request('/api/login',{password:'wrong'})).status).toBe(401);expect((await h.request('/api/login',{password:'wrong'})).status).toBe(429);expect((await h.request('/api/setup',{password:'new password'})).status).toBe(401);}finally{await h.cleanup();}});
  it('requires a session-bound count preview and explicit multiple-translation confirmation',async()=>{const h=await harness();try{await h.login();const a=h.dashboard.auth.sessions.values().next().value!;const preview=await (await h.request('/api/preview',{source:'mangadex',seriesId:'11111111-1111-4111-8111-111111111111',language:'en'})).json();expect(preview.count).toBe(2);expect(preview.multipleTranslations).toBe(1);expect(h.store.jobs()).toHaveLength(0);expect((await h.request('/api/enqueue',{token:preview.token,confirmTranslations:false})).status).toBe(400);const queued=await(await h.request('/api/enqueue',{token:preview.token,confirmTranslations:true})).json();expect(queued.added).toBe(2);expect(h.store.jobs()).toHaveLength(2);expect((await h.request('/api/enqueue',{token:preview.token,confirmTranslations:true})).status).toBe(400);const next=await(await h.request('/api/preview',{source:'mangadex',seriesId:'11111111-1111-4111-8111-111111111111',language:'en'})).json();await h.login();expect((await h.request('/api/enqueue',{token:next.token,confirmTranslations:true})).status).toBe(400);expect(h.dashboard.auth.sessions.has(a.id)).toBe(false);}finally{await h.cleanup();}});
});
