import { performance } from 'node:perf_hooks';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/core/store.js';
import { Queue } from '../src/engine/queue.js';
import { ChapterOutput } from '../src/engine/files.js';
import { Registry } from '../src/sources/registry.js';
import { defaults } from '../src/core/settings.js';
import { manifest } from '../src/sources/website.js';
import type { SourceAdapter, Chapter } from '../src/shared/types.js';
import sharp from 'sharp';

// Deterministic transport: 40ms latency, 128KiB signature-valid fixture pages.
// Exercises the real SQLite queue, staging, checksums, CBZ and verification; no live traffic.
const label = process.argv[2] || 'optimized';
const results = [];
for (const [pages, chapters] of [[10,1],[50,1],[100,1],[50,3]]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bear-bench-'));
    const store = new Store(':memory:');
    const settings = { ...defaults(root), globalChapters: 3, sourceChapters: { fixture: 3 }, pageRequests: 10, globalPageRequests: 30, sourcePageRequests: { fixture: 30 } };
    const series = { id: 'fixture', source: 'fixture', title: 'Benchmark', description: '' };
    const raw = Buffer.alloc(256 * 170 * 3); let seed=12345;
    for(let i=0;i<raw.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;raw[i]=seed&255;}
    const bytes = await sharp(raw,{raw:{width:256,height:170,channels:3}}).png().toBuffer();
    const source: SourceAdapter = {
        manifest: { ...manifest('fixture','Fixture','https://fixture.example/',['fixture.example']), limits:{chapters:3,pageRequests:30,minIntervalMs:0}, recommended: { chapters:3,pageRequests:30,requestIntervalMs:0 } },
        search: async()=>({items:[],total:0,offset:0,limit:50}), series:async()=>series,
        chapters:async()=>({items:[],total:0,offset:0,limit:50}), chapter:async()=>{throw Error('Unused');},
        resolve:async()=>({ revision:'fixture', urls:Array.from({length:pages},(_,i)=>`https://fixture.example/${i}.png`) }),
        readPage:async(_url,signal)=>{ await delay(40,undefined,{signal}); return bytes; }
    };
    let diskMs = 0, peak = process.memoryUsage().rss, high = 0, requests = 0, active = 0;
    const read = source.readPage!;
    source.readPage = async(...args)=>{ requests++; active++; high=Math.max(high,active); try{return await read(...args);}finally{active--;} };
    source.downloadPage=async(url,file,signal)=>{await writeFile(file,await source.readPage!(url,signal));};
    const page = ChapterOutput.prototype.page, finish = ChapterOutput.prototype.finish, stream = ChapterOutput.prototype.stream;
    ChapterOutput.prototype.stream = async function(index,download,signal){let network=0;const t=performance.now();try{return await stream.call(this,index,async file=>{const n=performance.now();try{await download(file);}finally{network+=performance.now()-n;}},signal);}finally{diskMs+=performance.now()-t-network;}};
    ChapterOutput.prototype.page = async function(...args){const t=performance.now();try{return await page.apply(this,args);}finally{diskMs+=performance.now()-t;}};
    ChapterOutput.prototype.finish = async function(...args){const t=performance.now();try{return await finish.apply(this,args);}finally{diskMs+=performance.now()-t;}};
    const queue = new Queue(store,new Registry([source]),()=>settings);
    const sample = setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},10);
    const cpu = process.cpuUsage(), start = performance.now();
    try {
        for(let i=0;i<chapters;i++)store.enqueue(series,{id:`c${i}`,source:'fixture',seriesId:series.id,title:'',number:String(i+1),volume:'',language:'en',groups:[],pages,external:false} satisfies Chapter,settings);
        queue.start();
        while(store.states('completed').length<chapters){if(store.states('failed').length)throw Error(store.states('failed')[0].error!);if(performance.now()-start>120000)throw Error('Benchmark timeout');await delay(10);}
        const ms=performance.now()-start, usage=process.cpuUsage(cpu);
        results.push({pages,chapters,ms,imagesPerSecond:pages*chapters/(ms/1000),MiBPerSecond:pages*chapters*bytes.length/1048576/(ms/1000),requests,retries:requests-pages*chapters,maxActiveImages:high,cpuMs:(usage.user+usage.system)/1000,peakRssMiB:peak/1048576,diskAndVerificationMs:diskMs});
    } finally {clearInterval(sample);await queue.stop();store.close();ChapterOutput.prototype.page=page;ChapterOutput.prototype.finish=finish;ChapterOutput.prototype.stream=stream;await rm(root,{recursive:true,force:true});}
}
await writeFile(`docs/benchmark-${label}.json`,JSON.stringify({label,date:new Date().toISOString(),environment:{platform:process.platform,arch:process.arch,node:process.version},results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
