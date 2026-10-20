import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults } from '../src/core/settings.js';
import type { Chapter, Series, SourceAdapter } from '../src/shared/types.js';
import { mangadexManifest } from '../src/sources/mangadex.js';
export const series:Series={id:'11111111-1111-4111-8111-111111111111',source:'mangadex',title:'Fixture Series',description:'Test'};
export function chapter(overrides:Partial<Chapter>={}):Chapter { return {id:randomUUID(),source:'mangadex',seriesId:series.id,title:'Beginning',number:'1',volume:'1',language:'en',groups:[],pages:2,external:false,...overrides}; }
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4RkAAAAASUVORK5CYII=','base64');
export async function workspace() { const dir=await mkdtemp(path.join(os.tmpdir(),'bear-cave-test-')); return {dir,settings:defaults(dir),cleanup:()=>rm(dir,{recursive:true,force:true})}; }
export function adapter(chapters:Chapter[]=[]):SourceAdapter { return {manifest:mangadexManifest,search:async()=>({items:[series],total:1,offset:0,limit:20}),series:async()=>series,chapter:async id=>chapters.find(c=>c.id===id)!,chapters:async(_id,_filter,offset)=>({items:chapters.slice(offset,offset+100),offset,total:chapters.length,limit:100}),resolve:async()=>({revision:'abc123',urls:['https://uploads.mangadex.org/2.png','https://uploads.mangadex.org/1.png']})}; }
export async function eventually(fn:()=>boolean,timeout=4000) { const start=Date.now(); while(!fn()) { if(Date.now()-start>timeout) throw Error('Condition timed out'); await new Promise(r=>setTimeout(r,15)); } }
