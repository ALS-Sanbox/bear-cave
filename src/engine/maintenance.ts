import { readdir, lstat, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Store } from '../core/store.js';
import type { Queue } from './queue.js';
import { contained, noLink } from './files.js';

export class StagingMaintenance {
  private scans=new Map<string,{expires:number;paths:string[]}>();
  constructor(private store:Store,private queue:Queue){}
  private needed(chapter:string){return this.store.jobs().some(j=>j.chapter.id===chapter&&['queued','running','paused'].includes(j.state))||this.store.follows().some(f=>this.store.jobs().some(j=>j.chapter.id===chapter&&j.source===f.series.source&&j.series.id===f.series.id));}
  async scan(){
    const folders=this.store.db.prepare('SELECT root,folder FROM folders').all(),entries:{path:string;title:string;bytes:number;chapter:string}[]=[];
    for(const folder of folders){
      const root=await realpath(String(folder.root)).catch(()=>undefined);if(!root)continue;
      const dir=contained(root,String(folder.folder),'.bear-cave');try{await noLink(path.dirname(dir));await noLink(dir);
        for(const name of await readdir(dir)){
          if(!/^[a-f0-9-]{32,36}\.incomplete$/.test(name))continue;const stage=contained(dir,name);await noLink(stage);const manifest=contained(stage,'manifest.json');await noLink(manifest);if((await lstat(manifest)).size>1024*1024)continue;
          const m=JSON.parse(await readFile(manifest,'utf8'));if(![1,2].includes(m.version)||typeof m.chapter!=='string'||!Array.isArray(m.pages)||this.needed(m.chapter))continue;
          // Only recognizable staging files in a database-owned folder are eligible.
          let bytes=0,valid=true;for(const child of await readdir(stage)){if(!/^(manifest\.json(?:\.part)?|\d{5}\.(png|jpg|webp)(?:\.part)?)$/.test(child)){valid=false;break;}const info=await lstat(contained(stage,child));if(!info.isFile()||info.isSymbolicLink()){valid=false;break;}bytes+=info.size;}
          if(valid)entries.push({path:stage,title:String(folder.folder),bytes,chapter:m.chapter});
        }
      }catch{/* Inaccessible or unrecognized storage is never a cleanup candidate. */}
    }
    const token=randomBytes(24).toString('hex');this.scans.clear();this.scans.set(token,{expires:Date.now()+300000,paths:entries.map(e=>e.path)});return{token,bytes:entries.reduce((n,e)=>n+e.bytes,0),entries:entries.map(({path,...e})=>e)};
  }
  async clean(token:string){
    const scan=this.scans.get(token);if(!scan||scan.expires<Date.now())throw Error('Cleanup scan expired. Scan again.');
    return this.queue.maintenance(async()=>{const current=await this.scan();const allowed=this.scans.get(current.token)!.paths;let removed=0;for(const file of scan.paths){if(!allowed.includes(file))continue;await noLink(file);const m=JSON.parse(await readFile(contained(file,'manifest.json'),'utf8'));if(this.needed(m.chapter))continue;await rm(file,{recursive:true,force:false});removed++;}this.scans.clear();return{removed};});
  }
}
