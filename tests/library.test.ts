import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFile, writeFile, rm, readdir, cp } from 'node:fs/promises';
import sharp from 'sharp';
import { Store } from '../src/core/store.js';
import { matching, enqueueSelection, selectionSummary } from '../src/engine/selection.js';
import { reconcile, libraryStatus, syncSeries } from '../src/engine/library.js';
import { ChapterOutput } from '../src/engine/files.js';
import { redownload, verifyOutput } from '../src/engine/verification.js';
import { Queue } from '../src/engine/queue.js';
import { Registry } from '../src/sources/registry.js';
import { workspace, series, chapter, adapter, png, eventually } from './helpers.js';

async function completed(store: Store, settings: Awaited<ReturnType<typeof workspace>>['settings'], c = chapter()) {
    const job = store.enqueue(series, c, settings).job;
    const output = new ChapterOutput(job, store);
    await output.open('old', 1); await output.page(0, png);
    const file = await output.finish();
    return store.update(job.id, { state: 'completed', output: file, total: 1, done: 1, verification: { state: 'verified', checked: new Date().toISOString() } });
}
describe('series selections and persistent library', () => {
    for (const count of [49,50,51,100,187,1000]) it(`resolves all ${count} stable identities across 50-item pages and deduplicates submissions`, async () => {
        const w = await workspace(), store = new Store(':memory:');
        try {
            const chapters = Array.from({length: count}, (_,i) => chapter({number: String(i+1)}));
            const source = adapter(chapters);
            source.chapters = async (_id,_filter,offset) => ({items:chapters.slice(offset,offset+50),total:count,limit:50,offset});
            const all = await matching(source, series.id, {language:'*'});
            expect(all).toHaveLength(count);
            const selected = all.filter(c => c.id !== chapters[0].id);
            expect(enqueueSelection(store,series,selected,w.settings,true).added).toBe(count-1);
            expect(enqueueSelection(store,series,selected,w.settings,true).added).toBe(0);
            expect(store.jobs()).toHaveLength(count-1);
        } finally {store.close();await w.cleanup();}
    });
    for (const format of ['folders','cbz'] as const) it(`reconciles ${format} output after losing job history, verifies integrity and respects root changes`, async () => {
        const w=await workspace(), other=await workspace(); let store=new Store(':memory:');
        try {
            w.settings.format=format;
            const job=await completed(store,w.settings);
            store.close();store=new Store(':memory:');
            await reconcile(store,series,[job.chapter],w.settings);
            expect(libraryStatus(store,series,1).state).toBe('Fully Downloaded');
            expect(selectionSummary(store,series.source,[job.chapter]).count).toBe(0);
            await reconcile(store,series,[job.chapter],{...w.settings,downloadRoot:other.dir});
            expect(libraryStatus(store,series,1).downloaded).toBe(0);
            await cp(path.join(w.dir,series.title),path.join(other.dir,series.title),{recursive:true});
            await reconcile(store,series,[job.chapter],{...w.settings,downloadRoot:other.dir});
            expect(libraryStatus(store,series,1).downloaded).toBe(1);
            await reconcile(store,series,[job.chapter],w.settings);
            expect(libraryStatus(store,series,1).downloaded).toBe(1);
            await rm(job.output!,{recursive:true});
            await reconcile(store,series,[job.chapter],w.settings);
            expect(selectionSummary(store,series.source,[job.chapter]).count).toBe(1);
            expect(enqueueSelection(store,series,[job.chapter],w.settings,true).added).toBe(1);
        }finally{store.close();await w.cleanup();await other.cleanup();}
    });
    it('queues precisely 101 missing chapters out of 187 and zero for a complete selection',async()=>{
        const w=await workspace(),store=new Store(':memory:');try{
            const chapters=Array.from({length:187},(_,i)=>chapter({number:String(i+1)}));
            for(const c of chapters.slice(0,86)) {const j=store.enqueue(series,c,w.settings).job;store.update(j.id,{state:'completed',verification:{state:'verified',checked:new Date().toISOString()}});}
            expect(enqueueSelection(store,series,chapters,w.settings,true).added).toBe(101);
            for(const j of store.jobs())store.update(j.id,{state:'completed'});
            expect(enqueueSelection(store,series,chapters,w.settings,true).added).toBe(0);
        }finally{store.close();await w.cleanup();}
    });
    it('writes portable metadata, preserves good fields/date, converts covers, and updates removed counts',async()=>{
        const w=await workspace(),store=new Store(':memory:');try{
            const job=await completed(store,w.settings),source=adapter([job.chapter]);let covers=0;
            source.cover=async()=>{covers++;return sharp({create:{width:2,height:3,channels:3,background:'#a7470b'}}).jpeg().toBuffer();};
            const detailed={...series,metadata:{authors:['Author'],status:'ongoing'}};
            await syncSeries(store,source,detailed,w.dir,undefined,187);
            const file=path.join(w.dir,series.title,'metadata.json'),first=JSON.parse(await readFile(file,'utf8'));
            expect(first.chapters).toEqual({total_available:187,downloaded:1});
            expect((await sharp(await readFile(path.join(w.dir,series.title,'coverart.png'))).metadata()).format).toBe('png');
            await rm(job.output!,{recursive:true});await reconcile(store,series,[job.chapter],w.settings);
            await syncSeries(store,source,{...series,description:'',metadata:{authors:[]}},w.dir);
            const second=JSON.parse(await readFile(file,'utf8'));
            expect(second.library.date_added).toBe(first.library.date_added);expect(second.authors).toEqual(['Author']);expect(second.description).toBe('Test');expect(second.chapters.downloaded).toBe(0);expect(covers).toBe(1);
        }finally{store.close();await w.cleanup();}
    });
    it('rejects invalid covers, throttles failures and repairs corrupt existing covers after a successful fetch',async()=>{
        const w=await workspace(),store=new Store(':memory:');const source=adapter([]);let attempts=0;
        try{
            source.cover=async()=>{attempts++;return Buffer.from('<html>challenge</html>');};
            await syncSeries(store,source,series,w.dir,undefined,0);await syncSeries(store,source,series,w.dir,undefined,0);
            expect(attempts).toBe(1);await expect(readFile(path.join(w.dir,series.title,'coverart.png'))).rejects.toThrow();
            store.set(`cover-attempt:${w.dir}:${series.source}:${series.id}`,0);
            source.cover=async()=>{attempts++;return sharp({create:{width:2,height:3,channels:3,background:'#a7470b'}}).png().toBuffer();};
            await syncSeries(store,source,series,w.dir,undefined,0);
            const file=path.join(w.dir,series.title,'coverart.png');await writeFile(file,'broken');
            await syncSeries(store,source,series,w.dir,undefined,0);
            expect((await sharp(await readFile(file)).metadata()).format).toBe('png');expect(attempts).toBe(3);
        }finally{store.close();await w.cleanup();}
    });
    it('continues chapter downloads when cover and metadata requests fail',async()=>{
        const w=await workspace(),store=new Store(':memory:');const c=chapter(),source=adapter([c]);
        source.cover=async()=>{throw Error('offline');};source.chapters=async()=>{throw Error('metadata offline');};source.readPage=async()=>png;
        const q=new Queue(store,new Registry([source]),()=>w.settings);
        try{const j=store.enqueue(series,c,w.settings).job;q.start();await eventually(()=>store.job(j.id)?.state==='completed');expect((await verifyOutput(store.job(j.id)!)).state).toBe('verified');}
        finally{await q.stop();store.close();await w.cleanup();}
    });
});
describe('verified replacement',()=>{
    for(const format of ['folders','cbz'] as const) for(const fail of [false,true]) it(`${format}: ${fail?'failed replacement preserves original':'verified replacement retains recovery backup'}`,async()=>{
        const w=await workspace(),store=new Store(':memory:');w.settings.format=format;
        const c=chapter(),source=adapter([c]);source.readPage=async()=>{if(fail)throw Error('network failed');return png;};source.cover=async()=>{throw Error('unavailable');};
        const q=new Queue(store,new Registry([source]),()=>w.settings);
        try{
            const j=await completed(store,w.settings,c),before=await readFile(format==='cbz'?j.output!:path.join(j.output!,'00001.png'));
            await redownload(store,j.id,'replace');await expect(redownload(store,j.id,'replace')).rejects.toThrow('completed');
            expect(store.enqueue(series,c,w.settings).duplicate).toBe(true);
            q.start();await eventually(()=>['failed','completed'].includes(store.job(j.id)!.state));
            if(fail) expect(await readFile(format==='cbz'?j.output!:path.join(j.output!,'00001.png'))).toEqual(before);
            if(!fail){await reconcile(store,series,[c],w.settings);expect(store.job(j.id)!.output).toBe(j.output);expect((await verifyOutput(store.job(j.id)!)).state).toBe('verified');const backup=(await readdir(path.dirname(j.output!))).find(n=>n.includes('.backup-'))!;expect(backup).toBeTruthy();expect(await readFile(format==='cbz'?path.join(path.dirname(j.output!),backup):path.join(path.dirname(j.output!),backup,'00001.png'))).toEqual(before);}
            else expect(store.job(j.id)!.state).toBe('failed');
        }finally{await q.stop();store.close();await w.cleanup();}
    });
});
