import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { MangaFreak } from '../src/sources/mangafreak.js';
import { Registry } from '../src/sources/registry.js';
import { Store } from '../src/core/store.js';
import { defaults } from '../src/core/settings.js';
import { Queue } from '../src/engine/queue.js';
import { verifyOutput } from '../src/engine/verification.js';
import { closeHttpConnections } from '../src/sources/http.js';
const root=await mkdtemp(path.join(os.tmpdir(),'bear-cave-live-'));
const store=new Store(':memory:'),source=new MangaFreak(),settings=defaults(root),queue=new Queue(store,new Registry([source]),()=>settings);
try {
    const search=await source.search('One Piece');
    const series=await source.series(search.items[0].id);
    const chapters=await source.chapters(series.id,{language:'en'});
    const job=store.enqueue(series,chapters.items[0],settings).job,start=Date.now();
    queue.start();
    for(;;){const state=store.job(job.id)!;if(state.state==='completed')break;if(['failed','action_required'].includes(state.state))throw Error(state.error!);if(Date.now()-start>180000)throw Error('Live test timeout');await delay(50);}
    const completed=store.job(job.id)!;
    if((await verifyOutput(completed)).state!=='verified')throw Error('Live archive verification failed');
    console.log(JSON.stringify({source:'mangafreak',series:series.title,chapter:completed.chapter.number,pages:completed.done,elapsedMs:Date.now()-start,metrics:queue.metrics(),archive:'verified'}));
} finally {await queue.stop();store.close();closeHttpConnections();if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('bear-cave-live-'))throw Error('Invalid test path');await rm(root,{recursive:true,force:true});}
