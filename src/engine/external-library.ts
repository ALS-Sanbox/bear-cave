import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import type { Chapter, Job, Series, Settings } from '../shared/types.js';
import type { Store } from '../core/store.js';
import { contained, digest, noLink } from './files.js';
import { validateExternalImage } from './image-types.js';
import { findSeriesDirectory, checkPath } from './folders.js';
import { inspectExternalArchive, MAX_PAGE_BYTES, MAX_PAGES, parseComicInfo } from './archive.js';
const titleKey=(title:string)=>title.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[×✕✖]/gu,'x').replace(/[^\p{L}\p{N}]/gu,'');
export async function existingSeriesFolder(store: Store, series: Series, root: string) {
    const native = await findSeriesDirectory(root,series,store);
    if (native) return { folder:native, ambiguous:false };
    try { root=await realpath(root); } catch { return {ambiguous:false}; }
    const candidates:string[]=[];
    for (const entry of await readdir(root,{withFileTypes:true})) {
        if (!entry.isDirectory()||entry.name.startsWith('.')||titleKey(entry.name)!==titleKey(series.title))continue;
        const dir=contained(root,entry.name);await checkPath(root,dir);
        try { await lstat(contained(dir,'.bear-cave-series.json'));continue; } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')continue;}
        candidates.push(dir);
    }
    if(candidates.length===1){store.mapFolder(root,`${series.source}:${series.id}`,path.relative(root,candidates[0]));return{folder:candidates[0],ambiguous:false};}
    return{ambiguous:candidates.length>1};
}
export async function inspectExternalOutput(root:string,file:string,signal?:AbortSignal):Promise<NonNullable<Job['external']>> {
    signal?.throwIfAborted();await checkPath(root,file);
    const info=await lstat(file);
    if(info.isFile()) {
        const result=await inspectExternalArchive(file,signal),after=await lstat(file);
        if(info.size!==after.size||info.mtimeMs!==after.mtimeMs)throw Error('External archive changed during verification');
        return result;
    }
    if(!info.isDirectory())throw Error('Unsupported chapter output');
    const hash=createHash('sha256');let pages=0,comicInfo:NonNullable<Job['external']>['comicInfo'];
    async function visit(dir:string,depth:number){
        if(depth>6)throw Error('External chapter has too many nested folders');
        for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
            signal?.throwIfAborted();const item=contained(dir,entry.name);await checkPath(root,item);
            if(entry.isDirectory()){await visit(item,depth+1);continue;}
            if(!entry.isFile()||(!/\.(png|jpe?g|webp)$/i.test(entry.name)&&entry.name.toLowerCase()!=='comicinfo.xml'))throw Error('Unrecognized external chapter contents');
            const before=await lstat(item),metadata=entry.name.toLowerCase()==='comicinfo.xml';
            if(before.size>(metadata?65536:MAX_PAGE_BYTES))throw Error('External page exceeds size limit');
            const bytes=await readFile(item,{signal}),after=await lstat(item);
            if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('External page changed during verification');
            if(metadata)comicInfo=parseComicInfo(bytes.toString('utf8'));else{await validateExternalImage(bytes,signal);if(++pages>MAX_PAGES)throw Error('Too many external pages');}
            hash.update(JSON.stringify([path.relative(file,item),bytes.length,digest(bytes)]));
        }
    }
    await visit(file,0);if(!pages)throw Error('No complete external chapter images');
    return{kind:'folder',signature:hash.digest('hex'),pages,comicInfo};
}
function chapterNumber(name:string){
    const stem=name.replace(/\.(cbz|zip)$/i,'');
    if(/\d\s*[-–]\s*\d/.test(stem))return;
    const explicit=stem.match(/(?:ch(?:apter)?[\s._-]*)(\d+(?:\.\d+)?)(?:\s*\[[^\]]*\])?$/i)?.[1];
    if(/\bvol(?:ume)?[\s._-]*\d+/i.test(stem)&&!explicit)return;
    const number=explicit??stem.match(/(?:^|[\s_-])(\d+(?:\.\d+)?)$/)?.[1];
    if(!number)return;
    return{number:Number(number),volume:stem.match(/\bvol(?:ume)?[\s._-]*(\d+)/i)?.[1]};
}
export async function reconcileExternal(store:Store,series:Series,chapters:Chapter[],settings:Settings,signal?:AbortSignal,verified=new Set<string>()){
    const resolved=await existingSeriesFolder(store,series,settings.downloadRoot);
    const summary={folderFound:!!resolved.folder, imported:0, ambiguous:resolved.ambiguous?1:0, skipped:0};
    if(!resolved.folder)return summary;
    const entries=await readdir(resolved.folder,{withFileTypes:true});
    const candidates=entries.filter(e=>!e.name.startsWith('.')&&!e.name.includes('.backup-')&&(e.isDirectory()||/\.(cbz|zip)$/i.test(e.name))).map(entry=>({entry,number:chapterNumber(entry.name)})).filter(e=>e.number);
    for(const {entry,number}of candidates){
        signal?.throwIfAborted();
        if(candidates.filter(c=>c.number!.number===number!.number&&c.number!.volume===number!.volume).length>1){summary.ambiguous++;continue;}
        const matches=chapters.filter(c=>/^\d+(?:\.\d+)?$/.test(c.number)&&Number(c.number)===number!.number&&(!number!.volume||Number(c.volume)===Number(number!.volume))&&!c.external&&c.pages!==0);
        if(matches.length!==1){if(matches.length>1)summary.ambiguous++;continue;}
        const chapter=matches[0],existing=store.chapterJobs(series.source,[chapter.id])[chapter.id];
        if(store.equivalentChapter(chapter,settings.downloadRoot))continue;
        let file:string;try{file=contained(resolved.folder,entry.name);}catch{summary.skipped++;continue;}
        if(existing&&(existing.state!=='completed'||existing.verification?.state==='verified'&&existing.output!==file))continue;
        if(existing?.verification?.state==='verified'&&!existing.external)continue;
        if(existing&&verified.has(existing.id))continue;
        try{
            const external=await inspectExternalOutput(settings.downloadRoot,file,signal),meta=external.comicInfo;
            if(chapter.pages!==null&&chapter.pages>0&&external.pages!==chapter.pages){summary.skipped++;continue;}
            if(meta?.series&&titleKey(meta.series)!==titleKey(series.title)||meta?.number&&Number(meta.number)!==Number(chapter.number)||meta?.volume&&chapter.volume&&Number(meta.volume)!==Number(chapter.volume)||meta?.language&&meta.language.toLowerCase()!==chapter.language.toLowerCase()){summary.ambiguous++;continue;}
            signal?.throwIfAborted();await noLink(file);
            const current=store.chapterJobs(series.source,[chapter.id])[chapter.id];if(current&&current.state!=='completed')continue;
            const job=current??store.enqueue(series,chapter,settings,{importOutput:true}).job;
            store.update(job.id,{state:'completed',root:settings.downloadRoot,output:file,format:external.kind==='folder'?'folders':'cbz',done:external.pages,total:external.pages,external,verification:{state:'verified',checked:new Date().toISOString()},error:null,completedAt:job.completedAt??new Date().toISOString()});
            summary.imported++;
        }catch(e){if(signal?.aborted)throw e;summary.skipped++;}
    }
    return summary;
}
