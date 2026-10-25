import { describe, it, expect } from 'vitest';
import { MangaPill } from '../src/sources/mangapill.js';
import { WeebCentral } from '../src/sources/weebcentral.js';
import { Comix } from '../src/sources/comix.js';
import { encodePath, type WebsiteTransport } from '../src/sources/website.js';
const http = (html: (url: URL) => string): WebsiteTransport => ({ html: async input => html(new URL(input)), get: async () => Buffer.from('fixture') });
describe('additional sources', () => {
 it('MangaPill keeps covers, pages search, and preserves reader order', async () => {
  const source = new MangaPill(http(u => u.pathname === '/search' ? '<div><a href="/manga/2/one-piece"><img data-src="https://cdn.readdetectiveconan.com/cover.jpg"></a><div><a href="/manga/2/one-piece"><div>One Piece</div></a></div></div><a href="?page=2">Next</a>' : u.pathname.startsWith('/manga/') ? '<h1>One Piece</h1><a href="/chapters/2-2/one-piece-chapter-2">Chapter 2</a><a href="/chapters/2-1/one-piece-chapter-1">Chapter 1</a>' : '<img class="js-page" data-src="https://cdn.readdetectiveconan.com/2.jpg"><img class="js-page" data-src="https://cdn.readdetectiveconan.com/1.jpg">'));
  const search = await source.search('one', 0); expect(search.items).toHaveLength(1); expect(search.items[0].coverRef).toContain('cover.jpg'); expect(search.total).toBe(51);
  const chapters = await source.chapters(search.items[0].id, {language:'en'}, 0); expect(chapters.items.map(c=>c.number)).toEqual(['1','2']);
  expect((await source.resolve(chapters.items[0].id)).urls.map(u=>new URL(u).pathname)).toEqual(['/2.jpg','/1.jpg']);
 });
 it('Weeb Central uses complete chapter and long-strip endpoints',async()=>{
  const key='01J76XYDMR2777KEM5BKTBBK83', chapter='01M5NYE04MB0P3BEM23N0C2KGB';const calls: string[]=[];
  const source = new WeebCentral(http(u=>{calls.push(u.href);if(u.pathname==='/search/data')return `<a href="/series/${key}/Fixture"><img src="https://temp.compsci88.com/cover.jpg"></a><a class="line-clamp-1" href="/series/${key}/Fixture">Fixture</a>`;if(u.pathname.endsWith('full-chapter-list'))return `<a href="/chapters/${chapter}"><span class="grow"><span>Chapter 2.5</span></span></a>`;if(u.pathname.endsWith('/images'))return '<section id="chapter-images"><img src="https://scans.lastation.us/manga/2.png"><img src="https://scans.lastation.us/manga/1.png"></section>';return '<h1>Fixture</h1>';}));
  const search=await source.search('fixture');expect(search.items[0].title).toBe('Fixture');expect(search.items[0].coverRef).toContain('cover.jpg');const chapters=await source.chapters(search.items[0].id,{language:'en'},0);expect(chapters.items[0].number).toBe('2.5');expect((await source.resolve(chapters.items[0].id)).urls).toHaveLength(2);expect(calls.some(u=>u.includes('reading_style=long_strip'))).toBe(true);
 });
 it('Comix uses rendered data and keeps distinct translations',async()=>{
  const modes:string[]=[];const source=new Comix({hosts:['comix.to','static.comix.to','pages.example'],render:async(_u,mode)=>{modes.push(mode);if(mode==='browse')return '<a href="/title/abcd-fixture"><img src="https://static.comix.to/cover.jpg" alt="Fixture"></a>';if(mode==='series')return '<script id="initial-data" type="application/json">'+JSON.stringify({queries:{'["manga","detail","abcd"]':{title:'Fixture',synopsis:'Test',poster:{large:'https://static.comix.to/cover.jpg'}}}})+'</script>';if(mode==='chapters')return ['1','2'].map((g,i)=>`<li class="mchap-item"><a href="/title/abcd-fixture/${i+1}-chapter-1">Ch.1</a><a href="/groups/${g}">Group ${g}</a></li>`).join('');return '<img data-bear-cave-page="2" src="https://pages.example/2.jpg"><img data-bear-cave-page="1" src="https://pages.example/1.jpg">';}});
  const result=await source.search('fixture');const series=await source.series(result.items[0].id);expect(series.title).toBe('Fixture');const chapters=await source.chapters(series.id,{language:'en'},0);expect(chapters.items).toHaveLength(2);expect((await source.chapters(series.id,{language:'en',group:'groups_2'},0)).items).toHaveLength(1);expect((await source.resolve(chapters.items[0].id)).urls).toEqual(['https://pages.example/1.jpg','https://pages.example/2.jpg']);expect(modes).toEqual(['browse','series','chapters','reader']);
 });
 it('rejects foreign identity paths and unapproved image destinations',async()=>{
  for(const source of [new MangaPill(),new WeebCentral(),new Comix()])await expect(source.series(encodePath('/account/settings'))).rejects.toThrow('identity');
  await expect(new Comix().search('fixture')).rejects.toMatchObject({kind:'action_required'});
  const source=new MangaPill(http(()=>'<img class="js-page" data-src="https://127.0.0.1/private">'));await expect(source.resolve(encodePath('/chapters/2-1/fixture-chapter-1'))).rejects.toThrow('not allowed');
 });
});
