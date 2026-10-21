import {Registry}from'../src/sources/registry.js';
import{imageExtension}from'../src/engine/files.js';
const registry=new Registry();
for(const id of process.argv.slice(2).length?process.argv.slice(2):['asura','flame','thunder','webtoon','toongod']){
  const a=registry.get(id);try{const search=await a.search(id==='webtoon'?'Tower':'Solo',0);console.log(id,'search',search.total,search.items.slice(0,2).map(s=>s.title));if(!search.items.length)throw Error('No matching titles');const s=await a.series(search.items[0].id);const chapters=await a.chapters(s.id,{language:'en'},0);console.log(id,'series',s.title,'chapters',chapters.total);if(!chapters.items.length)throw Error('No public chapters');const pages=await a.resolve(chapters.items[0].id);console.log(id,'resolved',pages.urls.length,'host',new URL(pages.urls[0]).hostname);const b=await a.readPage!(pages.urls[0]);console.log(id,'first image',b.length,imageExtension(b));}catch(e){console.error(id,(e as Error).message);process.exitCode=1;}
}
