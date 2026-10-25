import { WebsiteSource, manifest, encodePath, text } from './website.js';
import { SourceError, type ChapterFilter, type Series } from '../shared/types.js';
export class MangaPill extends WebsiteSource {
    protected identityPattern = /^\/(?:manga\/\d+\/[a-z0-9-]+|chapters\/\d+-\d+\/[a-z0-9-]+)\/?$/i;
    manifest = manifest('mangapill', 'MangaPill', 'https://mangapill.com/', ['cdn.readdetectiveconan.com'], 'English manga. MangaPill currently excludes manhwa.');
    async search(query: string, offset = 0, signal?: AbortSignal) {
        const limit = 50, page = Math.floor(offset / limit) + 1;
        const $ = await this.page(`https://mangapill.com/search?q=${encodeURIComponent(query)}&page=${page}`, signal);
        const found = new Map<string, Series>();
        $('a[href^="/manga/"]').each((_i, el) => {
            const a = $(el), path = this.path(a.attr('href')!), id = encodePath(path);
            if (!/^\/manga\/\d+\/[a-z0-9-]+\/?$/i.test(path))
                return;
            const card = a.parent(), title = a.find('div').first().text().trim() || a.text().trim();
            const cover = this.coverReference(a.find('img').attr('data-src') || card.find('img').attr('data-src') || card.find('img').attr('src'));
            const old = found.get(id);
            if (title)
                found.set(id, {
                    id, source: this.manifest.id, title: text(title), description: '', coverRef: cover || old?.coverRef
                });
            else if (cover && !old)
                found.set(id, {
                    id, source: this.manifest.id, title: '', description: '', coverRef: cover
                });
        });
        const items = [...found.values()].filter(s => s.title);
        const next = $('a[href*="page="]').toArray().some(e => $(e).text().trim() === 'Next');
        return {
            items, totalExact: !next, total: offset + (next ? limit + 1 : items.length), offset, limit
        };
    }
    async series(id: string, signal?: AbortSignal): Promise<Series> {
        const $ = await this.page(this.url(id), signal), title = $('h1').first().text().trim();
        if (!title)
            throw new SourceError('MangaPill series layout changed.');
        return {
            id, source: this.manifest.id, title, description: $('meta[name="description"]').attr('content') || '', url: this.url(id), coverRef: this.coverReference($('meta[property="og:image"]').attr('content') || $('img').first().attr('data-src'))
        };
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal) {
        if (!this.matches(filter))
            return this.slice([], offset);
        const items = await this.cached(`chapters:${id}`, async () => {
            const $ = await this.page(this.url(id), signal);
            return this.sort($('a[href^="/chapters/"]').toArray().map(e => {
                const a = $(e), number = a.text().match(/(?:Chapter|#)\s*(\d+(?:\.\d+)?)/i)?.[1];
                if (!number)
                    throw new SourceError('MangaPill chapter numbering changed.');
                return this.chapterItem(id, a.attr('href')!, number, a.text());
            }));
        });
        return this.slice(items, offset);
    }
    async chapter(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal), link = $('a[href^="/manga/"]').first().attr('href');
        const number = $('title').text().match(/Chapter\s*(\d+(?:\.\d+)?)/i)?.[1];
        if (!link || !number)
            throw new SourceError('MangaPill reader metadata changed.');
        return this.chapterItem(encodePath(this.path(link)), this.url(id), number, $('h1').text());
    }
    async resolve(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal);
        return this.resolved($('img.js-page').toArray().map(e => $(e).attr('data-src') || $(e).attr('src') || ''));
    }
}
