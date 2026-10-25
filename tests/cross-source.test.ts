import { createDashboard } from '../src/server/server.js';
import { hashPassword } from '../src/server/auth.js';
import { Registry } from '../src/sources/registry.js';
import { Queue } from '../src/engine/queue.js';
﻿import { describe,it,expect,vi } from 'vitest';
import path from 'node:path';
import { mkdir,writeFile,readFile,readdir,symlink,unlink } from 'node:fs/promises';
import { Store } from '../src/core/store.js';
import { seriesDirectory,markerHasIdentity } from '../src/engine/folders.js';
import { consolidateLibrary } from '../src/engine/consolidation.js';
import { ChapterOutput } from '../src/engine/files.js';
import { verifyOutput } from '../src/engine/verification.js';
import { syncSeries,libraryStatus,reconcile } from '../src/engine/library.js';
import { selectionSummary,enqueueSelection } from '../src/engine/selection.js';
import { readLibraryCover } from '../src/server/covers.js';
import { workspace,series,chapter,png,adapter } from './helpers.js';
import type { Series,Chapter } from '../src/shared/types.js';
const fault=vi.hoisted(()=>({after:0,calls:0}));
vi.mock('node:fs/promises',async load=>{
    const real=await load<typeof import('node:fs/promises')>();
    return {...real,rename:async(...args:Parameters<typeof real.rename>)=>{if(fault.after&&++fault.calls===fault.after)throw Object.assign(Error('simulated interruption'),{code:'EIO'});return real.rename(...args);}};
});
const a:Series={...series,title:'Overgeared'},b:Series={...series,id:'asura-id',source:'asura',title:'Overgeared'};
function ch(s:Series,n:string,language='en'){return chapter({source:s.source,seriesId:s.id,number:n,language,volume:''});}
async function legacyFolder(store:Store,root:string,s:Series,name:string){const dir=path.join(root,name);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'.bear-cave-series.json'),JSON.stringify({version:1,identity:`${s.source}:${s.id}`,title:s.title}));store.mapFolder(root,`${s.source}:${s.id}`,name);return dir;}
async function complete(store:Store,settings:Awaited<ReturnType<typeof workspace>>['settings'],s:Series,c:Chapter){const j=store.enqueue(s,c,settings,{importOutput:true}).job,o=new ChapterOutput(j,store);await o.open('fixture',1);await o.page(0,png);return store.update(j.id,{state:'completed',output:await o.finish(),done:1,total:1,verification:{state:'verified',checked:new Date().toISOString()}});}
describe('one library folder across sources',()=>{
 it('shares exact normalized titles across sources, while retaining same-source editions and sanitized-name collisions',async()=>{
    const w=await workspace(),store=new Store(':memory:');try{
        const first=await seriesDirectory(w.dir,a,store),second=await seriesDirectory(w.dir,{...b,title:'  OVERGEARED  '},store);expect(second).toBe(first);
        expect(await seriesDirectory(w.dir,{...a,id:'other-edition'},store)).not.toBe(first);
        const x=await seriesDirectory(w.dir,{...a,id:'x',title:'Name?'},store),y=await seriesDirectory(w.dir,{...b,id:'y',title:'Name*'},store);expect(x).not.toBe(y);
        const marker=JSON.parse(await readFile(path.join(first,'.bear-cave-series.json'),'utf8'));expect(markerHasIdentity(marker,`${a.source}:${a.id}`)).toBe(true);expect(markerHasIdentity(marker,`${b.source}:${b.id}`)).toBe(true);
        await writeFile(path.join(first,'coverart.png'),png);expect(await readLibraryCover(store,w.dir,b.source,b.id)).toEqual(png);
    }finally{store.close();await w.cleanup();}
 });
 for(const format of ['folders','cbz'] as const)it(`combines existing ${format} libraries without overwrites and preserves both source records`,async()=>{
    const w=await workspace(),store=new Store(':memory:');w.settings.format=format;
    try{
        const one=await legacyFolder(store,w.dir,a,'Overgeared'),two=await legacyFolder(store,w.dir,b,'Overgeared [asura-487b149f]');
        const jobs=[await complete(store,w.settings,a,ch(a,'1')),await complete(store,w.settings,a,ch(a,'2')),await complete(store,w.settings,b,ch(b,'2')),await complete(store,w.settings,b,ch(b,'3'))];
        await writeFile(path.join(one,'notes.txt'),'primary');await writeFile(path.join(two,'notes.txt'),'secondary');
        await writeFile(path.join(one,'metadata.json'),JSON.stringify({title:a.title,source:{name:'MangaDex',series_id:a.id},chapters:{total_available:2},library:{date_added:'2025-01-01T00:00:00Z'}}));
        await writeFile(path.join(two,'metadata.json'),JSON.stringify({title:b.title,description:'Secondary metadata'}));
        expect((await consolidateLibrary(store,w.dir)).merged).toBe(1);
        expect(await readdir(w.dir)).toEqual(['Overgeared']);
        expect(store.folder(w.dir,`${b.source}:${b.id}`)).toBe('Overgeared');
        for(const j of jobs){const updated=store.job(j.id)!;expect(path.dirname(updated.output!)).toBe(one);expect((await verifyOutput(updated)).state).toBe('verified');expect(updated.source).toBe(j.source);}
        const names=await readdir(one);expect(names.some(n=>n.startsWith('notes [import-'))).toBe(true);expect(await readFile(path.join(one,'notes.txt'),'utf8')).toBe('primary');
        const sourceA=adapter(),sourceB={...adapter(),manifest:{...adapter().manifest,id:'asura',name:'Asura'}};
        await syncSeries(store,sourceA,a,w.dir,undefined,2,{offline:true});await syncSeries(store,sourceB,b,w.dir,undefined,4,{offline:true});
        const metadata=JSON.parse(await readFile(path.join(one,'metadata.json'),'utf8'));expect(metadata.chapters).toEqual({total_available:4,downloaded:3});expect(metadata.sources).toHaveLength(2);expect(metadata.source.series_id).toBe(a.id);expect(metadata.library.date_added).toBe('2025-01-01T00:00:00Z');
        const incoming=[ch(b,'01'),ch(b,'2.0'),ch(b,'3'),ch(b,'4')];const summary=selectionSummary(store,b.source,incoming,w.dir);expect(summary.count).toBe(2); // 1/2 from other source; 3 is a different same-source identity.
        const onlyMissing=enqueueSelection(store,b,[ch(b,'1'),ch(b,'4')],w.settings,true);expect(onlyMissing.added).toBe(1);expect(onlyMissing.duplicates).toBe(1);
        expect(libraryStatus(store,a,2,w.dir).downloaded).toBe(3);
        await reconcile(store,b,[jobs[2].chapter,jobs[3].chapter],w.settings);expect(store.job(jobs[0].id)!.chapter.id).toBe(jobs[0].chapter.id);
    }finally{store.close();await w.cleanup();}
 });
 it('resumes an interrupted journaled merge after restarting the database',async()=>{
    const w=await workspace(),file=path.join(w.dir,'library.sqlite');let store=new Store(file);
    try{
        await legacyFolder(store,w.dir,a,'Overgeared');const two=await legacyFolder(store,w.dir,b,'Overgeared [asura-old]');
        const job=await complete(store,w.settings,b,ch(b,'3'));await writeFile(path.join(two,'notes.txt'),'preserve me');
        fault.after=2;fault.calls=0;await expect(consolidateLibrary(store,w.dir)).rejects.toThrow('simulated interruption');fault.after=0;
        store.close();store=new Store(file);expect((await consolidateLibrary(store,w.dir)).merged).toBe(1);
        expect((await verifyOutput(store.job(job.id)!)).state).toBe('verified');expect(await readFile(path.join(w.dir,'Overgeared','notes.txt'),'utf8')).toBe('preserve me');
        expect((await consolidateLibrary(store,w.dir)).merged).toBe(0);
    }finally{fault.after=0;store.close();await w.cleanup();}
 });
 it('preserves ambiguous same-source series and refuses to move junction contents or active downloads',async()=>{
    const w=await workspace(),outside=await workspace(),store=new Store(':memory:');try{
        await legacyFolder(store,w.dir,a,'Overgeared');const two=await legacyFolder(store,w.dir,b,'Overgeared [asura-old]');await symlink(outside.dir,path.join(two,'linked'),'junction');
        await expect(consolidateLibrary(store,w.dir)).rejects.toThrow('junction');expect(await readdir(w.dir)).toContain('Overgeared [asura-old]');
        const j=store.enqueue(a,ch(a,'5'),w.settings).job;store.update(j.id,{state:'running'});await expect(consolidateLibrary(store,w.dir)).rejects.toThrow('active downloads');
    }finally{store.close();await w.cleanup();await outside.cleanup();}
 });
 it('does not skip another volume, language, a damaged download or an unrelated series',async()=>{
    const w=await workspace(),store=new Store(':memory:');try{
        await seriesDirectory(w.dir,a,store);await seriesDirectory(w.dir,b,store);
        const old=await complete(store,w.settings,a,{...ch(a,'1'),volume:'1'});
        expect(store.enqueue(b,{...ch(b,'1'),volume:'2'},w.settings).duplicate).toBe(false);
        expect(store.enqueue(b,ch(b,'1','fr'),w.settings).duplicate).toBe(false);
        expect(store.enqueue(b,ch(b,'1'),w.settings).duplicate).toBe(true);
        store.update(old.id,{verification:{state:'damaged',checked:new Date().toISOString()}});
        expect(store.enqueue(b,ch(b,'1'),w.settings).duplicate).toBe(false);
    }finally{store.close();await w.cleanup();}
 });
});

it('links an already queued supplementary source at startup and cancels only its overlapping normal jobs',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
    await seriesDirectory(w.dir,a,store);await complete(store,w.settings,a,ch(a,'1'));
    const duplicate=store.enqueue(b,ch(b,'1'),w.settings).job,missing=store.enqueue(b,ch(b,'2'),w.settings).job;
    const result=await consolidateLibrary(store,w.dir);expect(result.linked).toBe(1);
    expect(store.job(duplicate.id)!.state).toBe('cancelled');expect(store.job(missing.id)!.state).toBe('queued');
    expect(await seriesDirectory(w.dir,b,store)).toBe(path.join(w.dir,'Overgeared'));
 }finally{store.close();await w.cleanup();}
});

it('reports shared downloads through HTTP previews, chapter statuses and follow checks',async()=>{
 const w=await workspace(),store=new Store(':memory:'),incoming=[ch(b,'1'),ch(b,'2'),ch(b,'3')];
 const secondary={...adapter(incoming),manifest:{...adapter().manifest,id:'asura',name:'Asura'},series:async()=>b};
 const registry=new Registry([adapter(),secondary]),queue=new Queue(store,registry,()=>w.settings),dashboard=createDashboard(store,queue,registry,()=>w.settings,path.resolve('dist/ui'));
 try{
    await seriesDirectory(w.dir,a,store);await complete(store,w.settings,a,ch(a,'1'));await complete(store,w.settings,a,ch(a,'2'));
    store.set('admin-hash',await hashPassword('cross source fixture password'));const session=await dashboard.auth.login('cross source fixture password');
    const port=await dashboard.listen(0),origin=`http://127.0.0.1:${port}`;
    async function request(route:string,body?:unknown){const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Cookie:`bc_session=${session.id}`,Origin:origin,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();}
    const detail=await request(`series?source=asura&id=${b.id}`);expect(detail.library.downloaded).toBe(2);expect(detail.library.totalKnown).toBe(false);
    const page=await request(`chapters?source=asura&id=${b.id}`);expect(page.library.total).toBe(3);expect(page.library.downloaded).toBe(2);expect(page.items[0].localState).toBe('completed');expect(page.items[0].localSource).toBe(a.source);
    const followed=dashboard.follows.save(b,{language:'en'});expect((await dashboard.follows.check(followed.id)).summary.count).toBe(1);
    const preview=await request('preview',{source:b.source,seriesId:b.id,language:'en',all:true});expect(preview.completed).toBe(2);expect(preview.count).toBe(1);
    store.set('queue-paused',true);expect((await request('enqueue',{token:preview.token,confirmTranslations:true})).added).toBe(1);
    expect(store.seriesJobs(b.source,b.id)).toHaveLength(1);
 }finally{await dashboard.close();await queue.stop();store.close();await w.cleanup();}
});

it('recognizes an unmarked original library from recorded output ownership and combines it with a marked secondary source',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
    await legacyFolder(store,w.dir,a,'Overgeared');await legacyFolder(store,w.dir,b,'Overgeared [asura-old]');
    const first=await complete(store,w.settings,a,ch(a,'1')),second=await complete(store,w.settings,b,ch(b,'2'));
    await unlink(path.join(w.dir,'Overgeared','.bear-cave-series.json'));
    expect((await consolidateLibrary(store,w.dir)).merged).toBe(1);
    expect(await readdir(w.dir)).toEqual(['Overgeared']);
    expect((await verifyOutput(store.job(first.id)!)).state).toBe('verified');expect((await verifyOutput(store.job(second.id)!)).state).toBe('verified');
 }finally{store.close();await w.cleanup();}
});
it('also repairs a legacy folder split where both folders record the same source identity',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
    await legacyFolder(store,w.dir,a,'Overgeared');const job=await complete(store,w.settings,a,ch(a,'1'));
    await unlink(path.join(w.dir,'Overgeared','.bear-cave-series.json'));
    await legacyFolder(store,w.dir,a,'Overgeared [source-old]');
    expect((await consolidateLibrary(store,w.dir)).merged).toBe(1);expect(await readdir(w.dir)).toEqual(['Overgeared']);
    expect(store.folder(w.dir,`${a.source}:${a.id}`)).toBe('Overgeared');expect((await verifyOutput(store.job(job.id)!)).state).toBe('verified');
 }finally{store.close();await w.cleanup();}
});

it('does not import a different source output when chapter IDs happen to be identical',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
    await seriesDirectory(w.dir,a,store);await seriesDirectory(w.dir,b,store);
    const firstChapter=ch(a,'1'),job=await complete(store,w.settings,a,firstChapter);
    const secondChapter={...ch(b,'1'),id:firstChapter.id};
    await reconcile(store,b,[secondChapter],w.settings);
    expect(store.seriesJobs(b.source,b.id)).toHaveLength(0);
    expect((await verifyOutput({...job,source:b.source,chapter:secondChapter,series:b})).state).toBe('damaged');
    expect(store.enqueue(b,secondChapter,w.settings).duplicate).toBe(true);
 }finally{store.close();await w.cleanup();}
});
