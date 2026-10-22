import path from 'node:path';
import { mkdir, readdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { safeName, contained, digest, noLink } from './files.js';
import type { Store } from '../core/store.js';
import type { Series } from '../shared/types.js';

export async function checkPath(root:string,file:string){
  contained(root,path.relative(root,file));let current=root;await noLink(root);
  for(const part of path.relative(root,file).split(path.sep).filter(Boolean)){current=path.join(current,part);await noLink(current);}
}
export async function seriesDirectory(root:string,series:Series,store?:Store){
  root=await realpath(root);const identity=`${series.source}:${series.id}`,known=store?.folder(root,identity);
  if(known){const dir=contained(root,known);await checkPath(root,dir);await mkdir(dir,{recursive:true});return dir;}
  // Adopt recorded legacy output only when no other identity shares that directory.
  const recorded=store?.seriesJobs(series.source,series.id).find(j=>j.output&&j.root===root);
  if(recorded?.output){const dir=path.dirname(recorded.output);if(!store!.jobs().some(j=>j.output&&path.dirname(j.output).toLowerCase()===dir.toLowerCase()&&(j.source!==series.source||j.series.id!==series.id))){await checkPath(root,dir);await lstat(dir);store!.claimFolder(root,identity,path.relative(root,dir));return dir;}}
  const base=safeName(series.title,65),suffix=digest(Buffer.from(identity)).slice(0,8);
  for(const candidate of [base,`${safeName(series.title,52)} [${series.source}-${suffix}]`]){
    const existing=(await readdir(root)).find(n=>n.toLowerCase()===candidate.toLowerCase()),dir=contained(root,existing??candidate);await checkPath(root,dir);
    const marker=contained(dir,'.bear-cave-series.json');
    if(existing){try{await noLink(marker);if(JSON.parse(await readFile(marker,'utf8')).identity!==identity)continue;}catch{
      // v0.2.x folders had chapter claims but no series marker. Adopt only if every claim is provably this series.
      if(!store)continue;const metadata=contained(dir,'.bear-cave');try{await noLink(metadata);const claims=(await readdir(metadata)).filter(n=>/^[a-f0-9]{32}\.json$/.test(n));if(!claims.length)continue;let owned=true;for(const name of claims){const claim=contained(metadata,name);await noLink(claim);const value=JSON.parse(await readFile(claim,'utf8'));if(typeof value!=='string'){owned=false;break;}const split=value.indexOf(':'),source=value.slice(0,split),chapter=value.slice(split+1),job=store.chapterJobs(source,[chapter])[chapter];if(!job||source!==series.source||job.series.id!==series.id){owned=false;break;}}if(!owned)continue;}catch{continue;}
    }}
    await mkdir(dir,{recursive:true});await noLink(marker);
    try{await writeFile(marker,JSON.stringify({version:1,identity,title:series.title}),{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(JSON.parse(await readFile(marker,'utf8')).identity!==identity)continue;}
    if(store)try{store.claimFolder(root,identity,path.relative(root,dir));}catch{continue;}
    return dir;
  }
  throw Error('Cannot safely assign a series folder. Check local storage.');
}
