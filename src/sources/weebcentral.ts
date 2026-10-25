import { WebsiteSource, manifest, encodePath, text } from './website.js';
import { SourceError, type ChapterFilter, type Series } from '../shared/types.js';
export class WeebCentral extends WebsiteSource {
    protected identityPattern = /^\/(?:series\/[A-Z0-9]{26}(?:\/[a-z0-9-]+)?|chapters\/[A-Z0-9]{26})\/?$/i;
    manifest = manifest('weebcentral', 'Weeb Central', 'https://weebcentral.com/', ['weebcentral.com', 'temp.compsci88.com', 'scans.lastation.us', 'official.lowee.us', '*.lowee.us', '*.compsci88.com', '*.lastation.us']);
    async search(query: string, offset = 0, signal?: AbortSignal) {
        const limit = 32, $ = await this.page(`https://weebcentral.com/search/data?text=${encodeURIComponent(query)}&display_mode=Full+Display&limit=${limit}&offset=${offset}`, signal);
        const found = new Map<string, Series>();
        $('a[href*="/series/"]').each((_i, el) => {
            const a = $(el), path = this.path(a.attr('href')!);
            if (!/^\/series\/[A-Z0-9]{26}(?:\/[a-z0-9-]+)?\/?$/i.test(path))
                return;
            const id = encodePath(path), old = found.get(id), title = a.hasClass('line-clamp-1') ? a.text().trim() : old?.title || '';
            const coverRef = this.coverReference(a.find('img').attr('src')) || old?.coverRef;
            found.set(id, {
                id, source: this.manifest.id, title, description: '', coverRef
            });
        });
        const items = [...found.values()].filter(s => s.title);
        if ($('link[rel="canonical"]').attr('href')?.endsWith('/400'))
            throw new SourceError('Weeb Central search request was rejected.');
        return {
            items, totalExact: items.length < limit, offset, limit, total: offset + items.length + (items.length === limit ? 1 : 0)
        };
    }
    async series(id: string, signal?: AbortSignal): Promise<Series> {
        const $ = await this.page(this.url(id), signal), title = $('h1').first().text().trim();
        if (!title)
            throw new SourceError('Weeb Central series layout changed.');
        return {
            id, source: this.manifest.id, title, description: text($('meta[name="description"]').attr('content') || ''), url: this.url(id), coverRef: this.coverReference($('meta[property="og:image"]').attr('content'))
        };
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal) {
        if (!this.matches(filter))
            return this.slice([], offset);
        const items = await this.cached(`chapters:${id}`, async () => {
            const seriesUrl = new URL(this.url(id)), key = seriesUrl.pathname.split('/')[2];
            const $ = await this.page(`https://weebcentral.com/series/${key}/full-chapter-list`, signal);
            return this.sort($('a[href^="/chapters/"]').toArray().map(e => {
                const a = $(e), name = a.find('span.grow > span').first().text().trim() || a.text().trim();
                const number = name.match(/(?:Chapter|Episode)\s*(\d+(?:\.\d+)?)/i)?.[1];
                if (!number)
                    throw new SourceError('Weeb Central chapter numbering changed.');
                return this.chapterItem(id, a.attr('href')!, number, name);
            }));
        });
        return this.slice(items, offset);
    }
    async chapter(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal);
        const link = $('a[href*="/series/"]').toArray().map(e => $(e).attr('href')!).find(h => /^\/series\/[A-Z0-9]{26}(?:\/[a-z0-9-]+)?\/?$/i.test(this.path(h)));
        const number = $('title').text().match(/(?:Chapter|Episode)\s*(\d+(?:\.\d+)?)/i)?.[1];
        if (!link || !number)
            throw new SourceError('Weeb Central reader metadata changed.');
        return this.chapterItem(encodePath(this.path(link)), this.url(id), number);
    }
    async resolve(id: string, signal?: AbortSignal) {
        const url = new URL(this.url(id));
        if (!/^\/chapters\/[A-Z0-9]{26}\/?$/i.test(url.pathname))
            throw new SourceError('Invalid chapter identity.');
        url.pathname = url.pathname.replace(/\/$/, '') + '/images';
        url.search = '?is_prev=False&reading_style=long_strip';
        const $ = await this.page(url.href, signal);
        return this.resolved($('#chapter-images img').toArray().map(e => $(e).attr('src') || ''));
    }
}
