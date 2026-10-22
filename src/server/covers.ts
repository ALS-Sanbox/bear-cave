import sharp from 'sharp';
import type { Registry } from '../sources/registry.js';
import type { Series } from '../shared/types.js';

export class CoverCache {
  private references=new Map<string,string>();private cache=new Map<string,{expires:number;bytes?:Buffer}>();private pending=new Map<string,Promise<Buffer>>();private bytes=0;
  constructor(private registry:Registry){}
  remember(series:Series){if(series.coverRef){const key=`${series.source}:${series.id}`;this.references.set(key,series.coverRef);if(this.references.size>1000)this.references.delete(this.references.keys().next().value!);}}
  async get(source:string,id:string){
    const key=`${source}:${id}`,old=this.cache.get(key);if(old&&old.expires>Date.now()){if(!old.bytes)throw Error('Cover unavailable');return old.bytes;}
    if(this.pending.has(key))return this.pending.get(key)!;if(this.pending.size>=2)throw Error('Cover requests are busy');
    const task=(async()=>{try{
      const adapter=this.registry.get(source);if(!adapter.cover)throw Error('Cover unavailable');
      const data=await adapter.cover(id,AbortSignal.timeout(60000),this.references.get(key));if(data.byteLength>32*1024*1024)throw Error('Cover too large');
      const bytes=await sharp(Buffer.from(data),{limitInputPixels:40_000_000}).rotate().resize({width:240,height:360,fit:'inside',withoutEnlargement:true}).png().toBuffer();
      this.put(key,bytes,Date.now()+10*60000);return bytes;
    }catch{this.put(key,undefined,Date.now()+60000);throw Error('Cover unavailable');}finally{this.pending.delete(key);}})();this.pending.set(key,task);return task;
  }
  private put(key:string,bytes:Buffer|undefined,expires:number){const old=this.cache.get(key);this.bytes-=old?.bytes?.length??0;this.cache.delete(key);this.cache.set(key,{bytes,expires});this.bytes+=bytes?.length??0;while(this.cache.size>128||this.bytes>32*1024*1024){const first=this.cache.keys().next().value!;this.bytes-=this.cache.get(first)?.bytes?.length??0;this.cache.delete(first);}}
}
