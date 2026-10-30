import sharp from 'sharp';
import { describe, it, expect } from 'vitest';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { unzipSync } from 'fflate';
import { Queue } from '../src/engine/queue.js';
import { Store } from '../src/core/store.js';
import { Registry } from '../src/sources/registry.js';
import { SourceError } from '../src/shared/types.js';
import { workspace, adapter, chapter, series, png, eventually } from './helpers.js';

async function fixture(pages = 12, chapters = 1) {
    const w = await workspace(), store = new Store(':memory:');
    Object.assign(w.settings,{pageRequests:10,globalPageRequests:10,globalChapters:3,sourceChapters:{fixture:3},sourcePageRequests:{fixture:10}});
    const s = {...series,source:'fixture'}, cs = Array.from({length:chapters},(_,i)=>chapter({source:'fixture',number:String(i+1),pages}));
    const a=adapter(cs);
    a.manifest={...a.manifest,id:'fixture',limits:{chapters:3,pageRequests:20,minIntervalMs:0}};
    a.resolve=async id=>({revision:'stable',identities:Array.from({length:pages},(_,i)=>String(i)),urls:Array.from({length:pages},(_,i)=>`https://fixture.example/${id}/${i}?generation=0`)});
    // Exercise the bounded-memory streaming path without a live network.
    a.downloadPage=async(_url,file,signal)=>{await delay(10,undefined,{signal});await writeFile(file,png);};
    const q=new Queue(store,new Registry([a]),()=>w.settings);
    const jobs=cs.map(c=>store.enqueue(s,c,w.settings).job);
    return {w,store,a,q,jobs,cleanup:async()=>{await q.stop();store.close();await w.cleanup();}};
}

describe('bounded concurrent chapter downloads',()=>{
    it('starts the next chapter while slow metadata is still pending',async()=>{
        const f=await fixture(2,2);f.w.settings.globalChapters=1;let release!:()=>void,waiting=false;
        const chapters=f.a.chapters;
        f.a.chapters=async(...args)=>{waiting=true;await new Promise<void>((resolve,reject)=>{release=resolve;args[3]?.addEventListener('abort',()=>reject(args[3]!.reason),{once:true});});return chapters(...args);};
        try{f.q.start();await eventually(()=>f.store.states('completed').length===2);expect(waiting).toBe(true);release();await f.q.stop();}finally{release?.();await f.cleanup();}
    });
    it('runs ten pages concurrently, never duplicates requests, and archives by index',async()=>{
        const f=await fixture(); let active=0,high=0; const calls=new Map<string,number>();
        f.a.downloadPage=async(url,file,signal)=>{calls.set(url,(calls.get(url)??0)+1);active++;high=Math.max(high,active);try{await delay(50-Number(new URL(url).pathname.split('/').at(-1))*2,undefined,{signal});await writeFile(file,png);}finally{active--;}};
        try{f.q.tick();await eventually(()=>f.store.job(f.jobs[0].id)?.state==='completed');expect(high).toBe(10);expect([...calls.values()]).toEqual(Array(12).fill(1));const zip=unzipSync(await readFile(f.store.job(f.jobs[0].id)!.output!));expect(Object.keys(zip).filter(k=>k.endsWith('.png'))).toEqual(Array.from({length:12},(_,i)=>`${String(i+1).padStart(5,'0')}.png`));expect(f.q.metrics()).toMatchObject({completedImages:12,activeImages:0});}finally{await f.cleanup();}
    });
    it('coalesces simultaneous expired URLs into one refresh and retries each stale page once',async()=>{
        const f=await fixture(10);let resolves=0;const calls=new Map<string,number>();
        f.a.resolve=async id=>{const generation=resolves++;if(generation)await delay(30);return{revision:'stable',identities:Array.from({length:10},(_,i)=>String(i)),urls:Array.from({length:10},(_,i)=>`https://fixture.example/${id}/${i}?generation=${generation}`)}};
        f.a.downloadPage=async(url,file)=>{calls.set(url,(calls.get(url)??0)+1);if(new URL(url).searchParams.get('generation')==='0')throw new SourceError('Expired','expired');await writeFile(file,png);};
        try{f.q.tick();await eventually(()=>f.store.job(f.jobs[0].id)?.state==='completed');expect(resolves).toBe(2);expect(calls.size).toBe(20);expect([...calls.values()].every(n=>n===1)).toBe(true);}finally{await f.cleanup();}
    });
    it('keeps successful pages after a failure and cleans incomplete streamed files',async()=>{
        const f=await fixture(10);let fail=true;const calls=new Map<string,number>();
        f.a.downloadPage=async(url,file)=>{const i=new URL(url).pathname.split('/').at(-1)!;calls.set(i,(calls.get(i)??0)+1);await writeFile(file,i==='3'&&fail?png.subarray(0,12):png);if(i==='3'&&fail)throw new SourceError('Temporary failure','transient');};
        try{f.q.tick();await eventually(()=>f.store.job(f.jobs[0].id)?.state==='failed');const successful=[...calls.keys()].filter(k=>k!=='3');expect(successful.length).toBe(9);fail=false;await f.q.control(f.jobs[0].id,'retry');await eventually(()=>f.store.job(f.jobs[0].id)?.state==='completed');for(const i of successful)expect(calls.get(i)).toBe(1);expect(calls.get('3')).toBe(2);expect(f.store.job(f.jobs[0].id)?.done).toBe(10);}finally{await f.cleanup();}
    });
    it('pauses and cancels in-flight work, then resumes only missing pages',async()=>{
        const f=await fixture(10);const seen=new Map<string,number>();let slow=true;
        f.a.downloadPage=async(url,file,signal)=>{const i=new URL(url).pathname.split('/').at(-1)!;seen.set(i,(seen.get(i)??0)+1);if(slow&&Number(i)>1)await delay(30000,undefined,{signal});await writeFile(file,png);};
        try{f.q.tick();await eventually(()=>f.store.job(f.jobs[0].id)?.done===2);f.q.control(f.jobs[0].id,'pause');await f.q.control(f.jobs[0].id,'resume');await eventually(()=>f.q.metrics().activeImages>0);f.q.control(f.jobs[0].id,'cancel');slow=false;await f.q.control(f.jobs[0].id,'retry');await eventually(()=>f.store.job(f.jobs[0].id)?.state==='completed');expect(seen.get('0')).toBe(1);expect(seen.get('1')).toBe(1);}finally{await f.cleanup();}
    });
    it('enforces shared source and global limits across concurrent chapters',async()=>{
        const f=await fixture(10,3);f.w.settings.globalPageRequests=4;f.w.settings.sourcePageRequests={fixture:3};let active=0,high=0;
        f.a.downloadPage=async(_url,file,signal)=>{active++;high=Math.max(high,active);try{await delay(20,undefined,{signal});await writeFile(file,png);}finally{active--;}};
        try{f.q.start();await eventually(()=>f.store.states('completed').length===3);expect(high).toBe(3);expect(f.q.metrics().completedImages).toBe(30);}finally{await f.cleanup();}
    });
    it('coordinates metadata and preserves covers and final counts without blocking images',async()=>{
        const f=await fixture(6,3);let covers=0,counts=0;const chapters=f.a.chapters;
        const cover=await sharp({create:{width:2,height:3,channels:3,background:'#cc8844'}}).png().toBuffer();
        f.a.cover=async()=>{covers++;await delay(100);return cover;};
        f.a.chapters=async(...args)=>{counts++;return chapters(...args);};
        try{f.q.start();await eventually(()=>f.store.states('completed').length===3);await f.q.stop();const dir=path.dirname(f.store.states('completed')[0].output!);expect(await readdir(dir)).toContain('coverart.png');const metadata=JSON.parse(await readFile(path.join(dir,'metadata.json'),'utf8'));expect(metadata.chapters.downloaded).toBe(3);expect(covers).toBe(1);expect(counts).toBe(1);}finally{await f.cleanup();}
    });
    it('rejects changed revision on refresh while preserving already staged pages',async()=>{
        const f=await fixture(3);let resolves=0;
        f.a.resolve=async()=>({revision:resolves++?'changed':'initial',urls:['https://fixture.example/0','https://fixture.example/1','https://fixture.example/2']});
        f.a.downloadPage=async(url,file)=>{if(url.endsWith('/1'))throw new SourceError('Expired','expired');await writeFile(file,png);};
        try{f.q.tick();await eventually(()=>f.store.job(f.jobs[0].id)?.state==='failed');expect(f.store.job(f.jobs[0].id)?.error).toContain('changed during download');expect(f.store.job(f.jobs[0].id)?.done).toBeGreaterThan(0);}finally{await f.cleanup();}
    });
});
