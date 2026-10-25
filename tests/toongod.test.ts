import { it, expect } from 'vitest';
import { WordPressSource } from '../src/sources/wordpress.js';
import { encodePath, type WebsiteTransport } from '../src/sources/website.js';
import { SourceError } from '../src/shared/types.js';
// Synthetic public markup; no site content, cookies or challenge tokens.
const http: WebsiteTransport = {
    html: async url => new URL(url).search ? '<div class="c-tabs-item__content"><div class="post-title"><a href="/webtoon/fixture/">Fixture</a></div></div>' : new URL(url).pathname.includes('chapter-') ? '<h1>Fixture Chapter 1</h1><a href="/webtoon/fixture/">Fixture</a><div class="reading-content"><img src="data:placeholder" data-lazy-src="/pages/1.jpg"><img data-original="/pages/2.jpg"></div>' : '<h1>Fixture</h1><div class="summary__content">Synopsis</div><div class="author-content"><a>Author</a></div><ul><li class="wp-manga-chapter"><a href="/webtoon/fixture/chapter-1/">Chapter 1</a></li></ul>',
    get: async () => Buffer.from('unused')
};
it('ToonGod public fixtures cover search, metadata, stable chapters and lazy reader order', async () => {
    const source=new WordPressSource('toongod',http);
    const found=await source.search('Fixture');expect(found.total).toBe(1);
    const detail=await source.series(found.items[0].id);expect(detail.description).toBe('Synopsis');expect(detail.metadata?.authors).toEqual(['Author']);
    const list=await source.chapters(detail.id,{language:'*'});expect(list.total).toBe(1);
    expect((await source.chapter(list.items[0].id)).seriesId).toBe(detail.id);
    expect((await source.resolve(list.items[0].id)).urls).toEqual(['https://www.toongod.org/pages/1.jpg','https://www.toongod.org/pages/2.jpg']);
});
it('ToonGod denied requests have an actionable diagnostic',async()=>{
    const source=new WordPressSource('toongod',{...http,html:async()=>{throw new SourceError('Forbidden','action_required');}});
    await expect(source.series(encodePath('/webtoon/fixture/'))).rejects.toMatchObject({kind:'action_required',message:expect.stringContaining('ToonGod: public access was denied')});
});
