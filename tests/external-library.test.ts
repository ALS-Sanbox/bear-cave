import { it, expect } from 'vitest';
import path from 'node:path';
import { mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { Store } from '../src/core/store.js';
import { existingSeriesFolder, inspectExternalOutput, reconcileExternal } from '../src/engine/external-library.js';
import { verifyOutput, redownload } from '../src/engine/verification.js';
import { workspace, series, chapter } from './helpers.js';
const image=()=>sharp({create:{width:3,height:4,channels:3,background:'#c86412'}}).png().toBuffer();
it('recognizes other-downloader ZIP chapters without creating markers or changing the archive',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
  const s={...series,title:'Hunter × Hunter'},dir=path.join(w.dir,'HunterXHunter');await mkdir(dir);
  const png=await image(),bytes=Buffer.from(zipSync({'1/':new Uint8Array(),'1/001.png':png,'1/002.png':png})),file=path.join(dir,'Manga - 1.zip');await writeFile(file,bytes);
  const c=chapter({seriesId:s.id,volume:''}),result=await reconcileExternal(store,s,[c],w.settings);
  expect(result.imported).toBe(1);const job=store.jobs()[0];expect(job.state).toBe('completed');expect(job.total).toBe(2);expect(job.output).toBe(file);
  expect((await verifyOutput(job)).state).toBe('verified');expect(await readFile(file)).toEqual(bytes);expect(await readdir(dir)).toEqual(['Manga - 1.zip']);
  await writeFile(file,zipSync({'1/001.png':png}));expect((await verifyOutput(job)).state).toBe('damaged');
 }finally{store.close();await w.cleanup();}
});
it('validates external page folders and leaves active queue entries alone',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
  const dir=path.join(w.dir,series.title,'Chapter 1');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'001.png'),await image());
  const c=chapter({volume:'',pages:1});const queued=store.enqueue(series,c,w.settings).job;
  expect((await reconcileExternal(store,series,[c],w.settings)).imported).toBe(0);expect(store.job(queued.id)?.state).toBe('queued');store.remove(queued.id);
  expect((await reconcileExternal(store,series,[c],w.settings)).imported).toBe(1);const job=store.jobs()[0];expect(job.external?.kind).toBe('folder');expect((await verifyOutput(job)).state).toBe('verified');
  await redownload(store,job.id,'copy');expect(store.job(job.id)?.external).toBeUndefined();
 }finally{store.close();await w.cleanup();}
});
it('skips ambiguous translations, volume clashes, duplicate files and contradictory ComicInfo',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
  const dir=path.join(w.dir,series.title);await mkdir(dir);const png=await image(),file=path.join(dir,'Chapter 1.cbz');await writeFile(file,zipSync({'001.png':png}));
  const c=chapter({volume:'',pages:1}),second={...c,id:'other-translation'};
  expect((await reconcileExternal(store,series,[c,second],w.settings)).ambiguous).toBe(1);expect(store.jobs()).toHaveLength(0);
  await writeFile(file,zipSync({'001.png':png,'ComicInfo.xml':Buffer.from('<ComicInfo><Number>2</Number><LanguageISO>fr</LanguageISO></ComicInfo>')}));
  expect((await reconcileExternal(store,series,[c],w.settings)).ambiguous).toBe(1);expect(store.jobs()).toHaveLength(0);
  await writeFile(file,zipSync({'001.png':png}));await writeFile(path.join(dir,'Manga - 1.zip'),zipSync({'001.png':png}));
  expect((await reconcileExternal(store,series,[c],w.settings)).ambiguous).toBe(2);expect(store.jobs()).toHaveLength(0);
 }finally{store.close();await w.cleanup();}
});
it('rejects traversal, forged image bytes, native manifests, CRC damage and linked folders',async()=>{
 const w=await workspace(),other=await workspace();try{
  const png=await image(),file=path.join(w.dir,'chapter.zip');
  const fixtures:Record<string,Uint8Array>[]=[{'../001.png':png},{'001.jpg':Buffer.from([255,216,255,217])},{'001.png':png,'bear-cave.json':Buffer.from('{}')}];
  for(const entries of fixtures){
   await writeFile(file,zipSync(entries));await expect(inspectExternalOutput(w.dir,file)).rejects.toThrow();
  }
  const damaged=Buffer.from(zipSync({'001.png':png},{level:0}));const start=damaged.indexOf(png);expect(start).toBeGreaterThan(0);damaged[start+15]^=1;await writeFile(file,damaged);await expect(inspectExternalOutput(w.dir,file)).rejects.toThrow('CRC');
  await symlink(other.dir,path.join(w.dir,'linked'),'junction');await expect(inspectExternalOutput(w.dir,path.join(w.dir,'linked'))).rejects.toThrow('junction');
 }finally{await w.cleanup();await other.cleanup();}
});
it('never picks between equivalent unmarked folder names',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
  await mkdir(path.join(w.dir,'FixtureSeries'));await mkdir(path.join(w.dir,'Fixture Series'));
  expect((await existingSeriesFolder(store,series,w.dir)).ambiguous).toBe(true);expect(store.folder(w.dir,`${series.source}:${series.id}`)).toBeUndefined();
 }finally{store.close();await w.cleanup();}
});
it('does not mark an external chapter complete when a known page count disagrees',async()=>{
 const w=await workspace(),store=new Store(':memory:');try{
  const dir=path.join(w.dir,series.title);await mkdir(dir);await writeFile(path.join(dir,'Chapter 1.zip'),zipSync({'001.png':await image()}));
  const result=await reconcileExternal(store,series,[chapter({volume:'',pages:2})],w.settings);
  expect(result.skipped).toBe(1);expect(store.jobs()).toHaveLength(0);
 }finally{store.close();await w.cleanup();}
});
