import { WebsiteSource, manifest, encodePath, text } from './website.js';
import { SourceError, type ChapterFilter, type Series } from '../shared/types.js';
const seriesPath = /^\/Manga\/[a-z0-9_-]+$/i;
const readerPath = /^\/Read1_([a-z0-9_-]+)_(\d+(?:\.\d+)?[a-z]?)$/i;
export class MangaFreak extends WebsiteSource {
    protected identityPattern = /^\/(?:Manga\/[a-z0-9_-]+|Read1_[a-z0-9_-]+_\d+(?:\.\d+)?[a-z]?)$/i;
    manifest = manifest('mangafreak', 'MangaFreak', 'https://ww3.mangafreak.me/', ['images.mangafreak.me'], 'English public manga chapters.');
    async search(query: string, offset = 0, signal?: AbortSignal) {
        // Crawl advertised result pages so arbitrary dashboard offsets remain accurate.
        const items = await this.cached(`search:${query}`, async () => {
            const found = new Map<string, Series>();
            const start = new URL(`/Find/${encodeURIComponent(query.trim().replace(/\s+/g, '_'))}`, this.manifest.website).href;
            await this.crawl(start, $ => {
                $('.manga_search_item').each((_i, el) => {
                    const card = $(el), a = card.find('h3 a').first();
                    const path = this.path(a.attr('href') || '/');
                    if (!seriesPath.test(path))
                        return;
                    const id = encodePath(path), title = text(a.text());
                    if (title)
                        found.set(id, {
                            id, source: this.manifest.id, title, description: '', coverRef: this.coverReference(card.find('img').attr('src'))
                        });
                });
            }, $ => $('.pagination a[href]').toArray().map(e => $(e).attr('href')!).filter(href => {
                const u = new URL(href, start);
                return u.pathname === new URL(start).pathname && /^\d+$/.test(u.searchParams.get('page') || '');
            }), signal);
            return [...found.values()];
        });
        return this.slice(items, offset);
    }
    async series(id: string, signal?: AbortSignal): Promise<Series> {
        const url = this.url(id);
        if (!seriesPath.test(new URL(url).pathname))
            throw new SourceError('Invalid series identity.');
        const $ = await this.page(url, signal), title = $('.manga_series_data h1').first().text().trim();
        if (!title)
            throw new SourceError('MangaFreak series layout changed.');
        return {
            id, source: this.manifest.id, title, description: text($('.manga_series_description p').text()), url, coverRef: this.coverReference($('meta[property="og:image"]').attr('content'))
        };
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal) {
        const url = this.url(id), slug = new URL(url).pathname.replace('/Manga/', '');
        if (!seriesPath.test(new URL(url).pathname))
            throw new SourceError('Invalid series identity.');
        if (!this.matches(filter))
            return this.slice([], offset);
        const items = await this.cached(`chapters:${id}`, async () => {
            const $ = await this.page(url, signal);
            if (!$('.manga_series_list').length)
                throw new SourceError('MangaFreak chapter list layout changed.');
            return this.sort($('.manga_series_list a.chapter-link').toArray().map(el => {
                const a = $(el), path = this.path(a.attr('href') || '/'), match = readerPath.exec(path);
                if (!match || match[1] !== slug)
                    throw new SourceError('MangaFreak chapter identity does not match series.');
                return this.chapterItem(id, path, match[2], a.text());
            }));
        });
        return this.slice(items, offset);
    }
    async chapter(id: string, signal?: AbortSignal) {
        const url = this.url(id), match = readerPath.exec(new URL(url).pathname);
        if (!match)
            throw new SourceError('Invalid chapter identity.');
        const $ = await this.page(url, signal), link = $('h1 a[href^="/Manga/"]').first().attr('href');
        if (!link || this.path(link) !== `/Manga/${match[1]}`)
            throw new SourceError('MangaFreak reader metadata changed.');
        return this.chapterItem(encodePath(this.path(link)), url, match[2], $('h1').text(), $('img[id="gohere"]').length || null);
    }
    async resolve(id: string, signal?: AbortSignal) {
        const url = this.url(id);
        if (!readerPath.test(new URL(url).pathname))
            throw new SourceError('Invalid chapter identity.');
        const $ = await this.page(url, signal);
        return this.resolved($('img[id="gohere"]').toArray().map(el => new URL($(el).attr('data-src') || $(el).attr('src') || '', this.manifest.website).href));
    }
}
