import { describe,it,expect } from 'vitest';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/core/store.js';
import { Queue,PagePool } from '../src/engine/queue.js';
import { Registry } from '../src/sources/registry.js';
import { SourceError } from '../src/shared/types.js';
import { workspace,series,chapter,eventually } from './helpers.js';

describe('persistent queue',()=> {
  it('recovers running work, preserves explicit pauses/global pause and completed identity',async()=> {
    const w=await workspace(); const file=path.join(w.dir,'queue.sqlite'); let s=new Store(file);
    try { const c=chapter(); const j=s.enqueue(series,c,w.settings).job; s.update(j.id,{state:'running',done:1}); const p=s.enqueue(series,chapter(),w.settings).job; s.update(p.id,{state:'paused'}); const complete=s.enqueue(series,chapter(),w.settings).job; s.update(complete.id,{state:'completed',output:'test.cbz'}); s.set('queue-paused',true); s.close(); s=new Store(file);
      expect(s.job(j.id)).toMatchObject({state:'queued',done:1}); expect(s.job(p.id)?.state).toBe('paused'); expect(s.get('queue-paused')).toBe(true); expect(s.enqueue(series,complete.chapter,w.settings).duplicate).toBe(true); expect(s.enqueue(series,c,w.settings).duplicate).toBe(true); expect(s.jobs()).toHaveLength(3);
    } finally {s.close();await w.cleanup();}
  });
  it('enforces global and per-source chapter limits without head-of-line blocking',async()=> {
    const w=await workspace(),s=new Store(':memory:'); w.settings.globalChapters=3; w.settings.sourceChapters={mangadex:1,other:2};
    const held:((value:string)=>void)[]=[]; const q=new Queue(s,new Registry([]),()=>w.settings,undefined,async(_j,signal)=>new Promise((resolve,reject)=>{held.push(resolve);signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}));
    try {for(let i=0;i<3;i++)s.enqueue(series,chapter(),w.settings);for(let i=0;i<3;i++)s.enqueue({...series,source:'other'},chapter({source:'other'}),w.settings);q.tick(); expect(s.states('running')).toHaveLength(3);expect(s.states('running').filter(j=>j.source==='mangadex')).toHaveLength(1);expect(s.states('running').filter(j=>j.source==='other')).toHaveLength(2);
      held.splice(0).forEach(r=>r('done')); await eventually(()=>s.states('completed').length===3);q.tick();expect(s.states('running')).toHaveLength(2);held.splice(0).forEach(r=>r('done'));await eventually(()=>s.states('completed').length===5);q.tick();expect(s.states('running')).toHaveLength(1);held.splice(0).forEach(r=>r('done'));await eventually(()=>s.states('completed').length===6);
    }finally{await q.stop();s.close();await w.cleanup();}
  });
  it('cancels active work, retries only explicitly, and pauses action-required jobs',async()=> {
    const w=await workspace(),s=new Store(':memory:');let behavior:'wait'|'error'|'success'='wait';
    const q=new Queue(s,new Registry([]),()=>w.settings,undefined,async(_j,signal)=> {if(behavior==='wait')await delay(30000,undefined,{signal});if(behavior==='error')throw new SourceError('Login required','action_required');return 'done';});
    try{const j=s.enqueue(series,chapter(),w.settings).job;q.tick();q.control(j.id,'cancel');await delay(30);expect(s.job(j.id)?.state).toBe('cancelled');behavior='error';q.control(j.id,'retry');await eventually(()=>s.job(j.id)?.state==='action_required');q.tick();expect(s.job(j.id)?.attempts).toBe(2);behavior='success';q.control(j.id,'retry');await eventually(()=>s.job(j.id)?.state==='completed');expect(s.job(j.id)?.attempts).toBe(3);}finally{await q.stop();s.close();await w.cleanup();}
  });
  it('persists queued jobs before workers observe them and resumes a global pause',async()=> {
    const w=await workspace(),s=new Store(':memory:');const q=new Queue(s,new Registry([]),()=>w.settings,undefined,async j=>{expect(s.job(j.id)?.state).toBe('running');return 'done';});
    try{const j=s.enqueue(series,chapter(),w.settings).job;q.pauseAll();q.tick();expect(s.job(j.id)?.state).toBe('paused');q.resumeAll();await eventually(()=>s.job(j.id)?.state==='completed');}finally{await q.stop();s.close();await w.cleanup();}
  });
  it('enforces a separate page request semaphore',async()=> {const pool=new PagePool(()=>2),controller=new AbortController();let high=0;await Promise.all(Array.from({length:8},()=>pool.run(async()=>{high=Math.max(high,pool.active);await delay(30);},controller.signal)));expect(high).toBe(2);expect(pool.active).toBe(0);});
  it('holds all affected source jobs on a human challenge until explicit retry',async()=>{const w=await workspace(),s=new Store(':memory:');w.settings.globalChapters=3;w.settings.sourceChapters.mangadex=3;let challenge=true;const q=new Queue(s,new Registry([]),()=>w.settings,undefined,async()=>{if(challenge)throw new SourceError('Human action needed','action_required');return 'done';});try{const jobs=Array.from({length:3},()=>s.enqueue(series,chapter(),w.settings).job);q.tick();await eventually(()=>s.states('action_required').length===3);await delay(20);const added=s.enqueue(series,chapter(),w.settings).job;q.tick();expect(s.job(added.id)?.state).toBe('action_required');challenge=false;q.control(jobs[0].id,'retry');await eventually(()=>s.job(jobs[0].id)?.state==='completed');expect(s.states('action_required')).toHaveLength(3);}finally{await q.stop();s.close();await w.cleanup();}});
});
