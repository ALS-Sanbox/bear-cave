import { it, expect } from 'vitest';
import path from 'node:path';
import { writeFile, readFile, symlink } from 'node:fs/promises';
import sharp from 'sharp';
import { CoverCache, readLibraryCover } from '../src/server/covers.js';
import { saveCover } from '../src/engine/files.js';
import { Store } from '../src/core/store.js';
import { Registry } from '../src/sources/registry.js';
import { workspace, series, adapter } from './helpers.js';
async function image(color: string) { return sharp({create:{width:20,height:30,channels:3,background:color}}).png().toBuffer(); }
it('serves a saved cover offline, including after a cached source failure, and sees refreshed covers',async()=>{
    const w=await workspace(),store=new Store(':memory:'),source=adapter();let calls=0;
    source.cover=async()=>{calls++;throw Error('source offline');};
    const cache=new CoverCache(new Registry([source]),(s,id)=>readLibraryCover(store,w.dir,s,id));
    try {
        await expect(cache.get(series.source,series.id)).rejects.toThrow('Cover unavailable');
        const first=await image('red');await saveCover(w.dir,series.title,first,undefined,series,store);
        expect((await sharp(await cache.get(series.source,series.id)).metadata()).width).toBe(20);
        expect(calls).toBe(1);
        const old=await cache.get(series.source,series.id);
        await saveCover(w.dir,series.title,await image('blue'),undefined,series,store);
        expect(await cache.get(series.source,series.id)).not.toEqual(old);expect(calls).toBe(1);
    }finally{await cache.stop();store.close();await w.cleanup();}
});
it('falls back to the source for a corrupt saved cover and isolates changed download roots',async()=>{
    const w=await workspace(),other=await workspace(),store=new Store(':memory:'),source=adapter();let root=w.dir,calls=0;
    const valid=await image('red');source.cover=async()=>{calls++;return valid;};
    const cache=new CoverCache(new Registry([source]),(s,id)=>readLibraryCover(store,root,s,id));
    try{
        const file=await saveCover(w.dir,series.title,valid,undefined,series,store);await writeFile(file,'corrupt');
        expect(await cache.get(series.source,series.id)).toEqual(valid);expect(calls).toBe(1);
        await saveCover(other.dir,series.title,await image('blue'),undefined,series,store);root=other.dir;
        expect(await cache.get(series.source,series.id)).not.toEqual(valid);expect(calls).toBe(1);
    }finally{await cache.stop();store.close();await w.cleanup();await other.cleanup();}
});
it('never reads a local cover through a junction or a mismatched identity marker',async()=>{
    const w=await workspace(),other=await workspace(),store=new Store(':memory:');
    try{
        const file=await saveCover(w.dir,series.title,await image('red'),undefined,series,store);
        await writeFile(path.join(path.dirname(file),'.bear-cave-series.json'),JSON.stringify({identity:'other:series'}));
        expect(await readLibraryCover(store,w.dir,series.source,series.id)).toBeUndefined();
        await symlink(other.dir,path.join(w.dir,'linked'),'junction');store.claimFolder(w.dir,'mangadex:linked','linked');
        expect(await readLibraryCover(store,w.dir,'mangadex','linked')).toBeUndefined();
        expect(await readFile(file)).toBeTruthy();
    }finally{store.close();await w.cleanup();await other.cleanup();}
});
it('refreshes expired or invalid search cover references through the canonical lookup used by download cover',async()=>{
    const source=adapter(),valid=await image('green'),references:(string|undefined)[]=[];
    source.cover=async(_id,_signal,reference)=>{references.push(reference);if(reference==='expired')throw Error('expired image');if(reference==='placeholder')return Buffer.from('<svg>placeholder</svg>');return valid;};
    for(const ref of ['expired','placeholder']){
        const cache=new CoverCache(new Registry([source]));
        try{cache.remember({...series,coverRef:ref});expect(await cache.get(series.source,series.id)).toEqual(valid);expect(references.slice(-2)).toEqual([ref,undefined]);}
        finally{await cache.stop();}
    }
});
it('retries previously unavailable thumbnails when a new search remembers the series again',async()=>{
    const source=adapter(),valid=await image('green');let available=false,calls=0;
    source.cover=async()=>{calls++;if(!available)throw Error('offline');return valid;};
    const cache=new CoverCache(new Registry([source]));
    try{cache.remember({...series,coverRef:'cover'});await expect(cache.get(series.source,series.id)).rejects.toThrow();available=true;cache.remember({...series,coverRef:'cover'});expect(await cache.get(series.source,series.id)).toEqual(valid);expect(calls).toBe(3);}
    finally{await cache.stop();}
});
