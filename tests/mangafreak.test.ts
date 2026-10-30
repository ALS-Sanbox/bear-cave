import { describe, it, expect } from 'vitest';
import { MangaFreak } from '../src/sources/mangafreak.js';
import { encodePath, type WebsiteTransport } from '../src/sources/website.js';

const seriesId = encodePath('/Manga/Fixture_Name');
const chapterId = encodePath('/Read1_Fixture_Name_2.5a');
const reader = '<h1><a href="/Manga/Fixture_Name">Fixture</a> Chapter 2.5a</h1><img id="gohere" src="https://images.mangafreak.me/2.jpg"><img id="gohere" data-src="https://images.mangafreak.me/1.jpg"><img src="https://ads.example/banner.jpg">';
const transport = (html: (url: URL) => string): WebsiteTransport => ({ html: async u => html(new URL(u)), get: async () => Buffer.from('fixture') });

describe('MangaFreak', () => {
    it('counts paginated search results before slicing and keeps covers', async () => {
        const calls: string[] = [];
        const source = new MangaFreak(transport(u => {
            calls.push(u.href);
            const n = u.searchParams.get('page') === '2' ? 2 : 1;
            return `<div class="manga_search_item"><h3><a href="/Manga/Fixture_${n}">Fixture ${n}</a></h3><img src="https://images.mangafreak.me/cover.jpg"></div><div class="pagination"><a href="/Find/one_piece?page=1">1</a><a href="/Find/one_piece?page=2">2</a></div>`;
        }));
        const result = await source.search('one piece', 1);
        expect(result.total).toBe(2);
        expect(result.items.map(s => s.title)).toEqual(['Fixture 2']);
        expect(result.items[0].coverRef).toContain('cover.jpg');
        expect(calls.every(u => u.includes('/Find/one_piece'))).toBe(true);
        await expect(source.search('one piece', -1)).rejects.toThrow('offset');
    });
    it('loads metadata, filters chapters, preserves suffixes and page order', async () => {
        const source = new MangaFreak(transport(u => u.pathname.startsWith('/Manga/') ? '<div class="manga_series_data"><h1>Fixture</h1></div><div class="manga_series_description"><p>Synopsis</p></div><div class="manga_series_list"><a class="chapter-link" href="/Read1_Fixture_Name_2.5a">Chapter 2.5a</a><a class="chapter-link" href="/Read1_Fixture_Name_1">Chapter 1</a></div>' : reader));
        expect((await source.series(seriesId)).description).toBe('Synopsis');
        expect((await source.chapters(seriesId, { language: 'en' })).items.map(c => c.number)).toEqual(['1', '2.5a']);
        expect((await source.chapters(seriesId, { language: 'fr' })).total).toBe(0);
        expect((await source.chapters(seriesId, { language: 'en', group: 'other' })).total).toBe(0);
        expect(await source.chapter(chapterId)).toMatchObject({ seriesId, number: '2.5a', pages: 2 });
        const pages = await source.resolve(chapterId);
        expect(pages.urls).toEqual(['https://images.mangafreak.me/2.jpg', 'https://images.mangafreak.me/1.jpg']);
        expect((await new MangaFreak(transport(() => reader.replace('/2.jpg', '/3.jpg'))).resolve(chapterId)).revision).not.toBe(pages.revision);
    });
    it('rejects invalid identities, foreign images, mismatched chapters and empty readers', async () => {
        const source = new MangaFreak(transport(() => ''));
        await expect(source.series(encodePath('/account'))).rejects.toThrow('identity');
        await expect(source.resolve(seriesId)).rejects.toThrow('chapter identity');
        await expect(source.resolve(chapterId)).rejects.toMatchObject({ kind: 'action_required' });
        await expect(new MangaFreak(transport(() => reader.replace('images.mangafreak.me/2', 'evil.example/2'))).resolve(chapterId)).rejects.toThrow('not allowed');
        await expect(new MangaFreak(transport(() => reader.replace('/Manga/Fixture_Name', '/Manga/Other'))).chapter(chapterId)).rejects.toThrow('metadata');
        await expect(new MangaFreak(transport(() => '<div class="manga_series_list"><a class="chapter-link" href="/Read1_Other_1">Chapter 1</a></div>')).chapters(seriesId, { language: 'en' })).rejects.toThrow('match');
    });
});
