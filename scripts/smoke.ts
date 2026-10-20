import { MangaDex } from '../src/sources/mangadex.js';
import { SafeHttp } from '../src/sources/http.js';
import { imageExtension } from '../src/engine/files.js';
// Explicit, read-only network smoke: one search, detail, chapter page, resolution, first image.
const http=new SafeHttp(),source=new MangaDex(http);
const result=await source.search(process.argv[2] ?? 'Yotsuba',0);
if(!result.items.length)throw Error('Search returned no series');
let chosen:import('../src/shared/types.js').Chapter|undefined;
for(const item of result.items.slice(0,5)) { const series=await source.series(item.id); const chapters=await source.chapters(series.id,{language:'en'},0); console.log(`Search/detail OK: ${series.title}; ${chapters.total} matching chapters.`); if(chapters.items.length) {chosen=chapters.items[0];break;} }
if(!chosen)throw Error('No downloadable English chapter in first five results; supply a different search title as an argument.');
const chapter=chosen,pages=await source.resolve(chapter.id);
const bytes=await http.get(pages.urls[0],source.manifest.imageHosts,undefined,true);
console.log(`Chapter ${chapter.id}: ${pages.urls.length} pages; first image ${bytes.length} bytes (${imageExtension(bytes)}). No files downloaded.`);
