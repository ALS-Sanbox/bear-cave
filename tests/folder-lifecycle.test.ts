import { readLibraryCover } from '../src/server/covers.js';
﻿import { it,expect } from 'vitest';
import { readdir,readFile,rm,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { findSeriesDirectory,seriesDirectory } from '../src/engine/folders.js';
import { reconcile,syncSeries } from '../src/engine/library.js';
import { Queue } from '../src/engine/queue.js';
import { Registry } from '../src/sources/registry.js';
import { ChapterOutput } from '../src/engine/files.js';
import { workspace,series,chapter,adapter,png,eventually } from './helpers.js';
it('creates the series folder when an actual chapter download starts',async()=>{
 const w=await workspace(),store=new Store(':memory:'),c=chapter(),source=adapter([c]);source.readPage=async()=>png;
 const queue=new Queue(store,new Registry([source]),()=>w.settings);
 try{await reconcile(store,series,[c],w.settings);await syncSeries(store,source,series,w.dir,undefined,1,{create:false});expect(await readdir(w.dir)).toEqual([]);
    const job=store.enqueue(series,c,w.settings).job;expect(await readdir(w.dir)).toEqual([]);
    queue.start();await eventually(()=>store.job(job.id)?.state==='completed');expect(await readdir(w.dir)).toContain(series.title);expect(store.job(job.id)?.output).toContain(series.title);
 }finally{await queue.stop();store.close();await w.cleanup();}
});
it('does not recreate a removed folder while viewing a previously downloaded series',async()=>{
 const w=await workspace(),store=new Store(':memory:'),c=chapter(),source=adapter([c]);
 try{const job=store.enqueue(series,c,w.settings).job,o=new ChapterOutput(job,store);await o.open('fixture',1);await o.page(0,png);store.update(job.id,{state:'completed',output:await o.finish()});
    await rm(path.join(w.dir,series.title),{recursive:true});await reconcile(store,series,[c],w.settings);await syncSeries(store,source,series,w.dir,undefined,1,{create:false});
    expect(await readdir(w.dir)).toEqual([]);expect(store.job(job.id)?.verification?.state).toBe('missing');
 }finally{store.close();await w.cleanup();}
});
it('finds existing shared downloads without creating or modifying folder markers',async()=>{
 const w=await workspace(),store=new Store(':memory:'),secondary={...series,source:'asura',id:'secondary'},c=chapter();
 try{const dir=await seriesDirectory(w.dir,series,store),marker=path.join(dir,'.bear-cave-series.json'),before=await readFile(marker,'utf8');
    await writeFile(path.join(dir,'coverart.png'),png);
    expect(await findSeriesDirectory(w.dir,secondary,store)).toBe(dir);expect(await readLibraryCover(store,w.dir,secondary.source,secondary.id)).toEqual(png);expect(await readFile(marker,'utf8')).toBe(before);expect(await readdir(w.dir)).toEqual([series.title]);
    // A later explicit download can add the source to this same folder.
    const ch={...c,source:secondary.source,seriesId:secondary.id,number:'2'},job=store.enqueue(secondary,ch,w.settings).job,o=new ChapterOutput(job,store);await o.open('fixture',1);await o.page(0,png);await o.finish();
    expect(JSON.parse(await readFile(marker,'utf8')).identities).toContain('asura:secondary');expect(await readdir(w.dir)).toEqual([series.title]);
 }finally{store.close();await w.cleanup();}
});
