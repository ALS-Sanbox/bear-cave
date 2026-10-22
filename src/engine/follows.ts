import { randomUUID } from 'node:crypto';
import type { Store } from '../core/store.js';
import type { Registry } from '../sources/registry.js';
import type { Queue } from './queue.js';
import type { Settings, FollowedSeries, Series } from '../shared/types.js';
import { matching,selectionSummary,enqueueSelection } from './selection.js';

export class FollowScheduler {
  private timer?:ReturnType<typeof setInterval>;private active=new Map<string,AbortController>();private stopping=false;private scheduled=false;
  constructor(private store:Store,private registry:Registry,private queue:Queue,private settings:()=>Settings,private now:()=>number=Date.now){}
  start(){this.timer=setInterval(()=>{void this.tick();},10000);}
  save(series:Series,input:Partial<FollowedSeries>&{language:string}){
    const old=this.store.follows().find(f=>f.series.source===series.source&&f.series.id===series.id),intervalHours=input.intervalHours??old?.intervalHours??6;
    return this.store.saveFollow({...old,id:old?.id??randomUUID(),series,language:input.language,group:input.group,autoDownload:input.autoDownload??old?.autoDownload??false,intervalHours,enabled:input.enabled??old?.enabled??false,missing:old?.missing??0,translations:old?.translations??0,nextCheck:new Date(this.now()+intervalHours*3600000).toISOString()});
  }
  async check(id:string,automatic=false){
    const follow=this.store.follow(id);if(!follow)throw Error('Followed series no longer exists.');if(this.active.has(id))throw Error('This series is already being checked.');
    const controller=new AbortController();this.active.set(id,controller);const lastCheck=new Date(this.now()).toISOString();
    try{
      const hold=this.store.get<string>(`source-action:${follow.series.source}`);if(hold)throw Error(hold);
      const chapters=await matching(this.registry.get(follow.series.source),follow.series.id,{language:follow.language,group:follow.group},undefined,controller.signal);
      const summary=selectionSummary(this.store,follow.series.source,chapters);
      const next:FollowedSeries={...follow,lastCheck,lastSuccess:lastCheck,nextCheck:new Date(this.now()+follow.intervalHours*3600000).toISOString(),missing:summary.count,translations:summary.multipleTranslations,error:undefined};
      if(automatic&&follow.autoDownload&&summary.count){if(summary.multipleTranslations)next.error='Choose a translation group or explicitly confirm extra translations before downloading.';else if(!this.store.get('queue-paused')){enqueueSelection(this.store,follow.series,chapters,this.settings(),false);next.missing=0;this.queue.tick();}}
      if(this.store.follow(id))this.store.saveFollow(next);return{follow:next,chapters,summary};
    }catch(e){if(!controller.signal.aborted&&this.store.follow(id))this.store.saveFollow({...follow,lastCheck,nextCheck:new Date(this.now()+Math.max(1,follow.intervalHours)*3600000).toISOString(),error:e instanceof Error?e.message:'Check failed.'});throw e;}
    finally{this.active.delete(id);}
  }
  async tick(){
    if(this.stopping||this.scheduled||this.store.get('queue-paused'))return;
    const due=this.store.follows().find(f=>f.enabled&&Date.parse(f.nextCheck)<=this.now()&&!this.active.has(f.id));if(!due)return;
    this.scheduled=true;try{await this.check(due.id,true);}catch{/* Error and next attempt are persisted; no tight retry loop. */}finally{this.scheduled=false;}
  }
  remove(id:string){this.active.get(id)?.abort();this.store.unfollow(id);}
  async stop(){this.stopping=true;if(this.timer)clearInterval(this.timer);for(const c of this.active.values())c.abort();while(this.active.size)await new Promise(r=>setTimeout(r,20));}
}
