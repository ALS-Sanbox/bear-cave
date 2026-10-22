import { WebsiteSource, manifest, encodePath, astroProps, text } from './website.js';
import { SourceError, type Series, type ChapterFilter } from '../shared/types.js';
export class Asura extends WebsiteSource {
    protected identityPattern = /^\/comics\/[a-z0-9-]+(?:\/chapter\/\d+(?:\.\d+)?)?\/?$/i;
    manifest = { ...manifest('asura', 'Asura Scans', 'https://asurascans.com/', ['cdn.asurascans.com'], 'Public chapters only. Premium/early-access chapters are excluded.'), apiHosts: ['asurascans.com', 'api.asurascans.com'] };
    async search(query: string, offset = 0, signal?: AbortSignal) {
        const items = await this.cached(`search:${query}`, async () => {
            const found = new Map<string, Series>();
            let pages = 1, total = 0;
            for (let page = 1; page <= pages; page++) {
                const url = `https://asurascans.com/browse/comics?search=${encodeURIComponent(query)}&page=${page}`;
                const data = astroProps(await this.page(url, signal), 'BrowseFilters');
                if (!Array.isArray(data.initialSeries) || !Number.isInteger(data.totalCount) || !Number.isInteger(data.initialTotalPages))
                    throw new SourceError('Asura search pagination data changed.');
                if (page === 1) {
                    pages = Math.max(1, data.initialTotalPages);
                    total = data.totalCount;
                    if (pages > 500 || total > 10000)
                        throw new SourceError('Too many Asura search results. Narrow the title.');
                }
                for (const item of data.initialSeries) {
                    if (typeof item.public_url !== 'string' || typeof item.title !== 'string')
                        throw new SourceError('Asura search identity data changed.');
                    const id = encodePath(this.path(item.public_url));
                    found.set(id, {
                        id, source: 'asura', title: item.title, description: text(item.description ?? ''), coverRef: this.coverReference(item.cover ?? item.cover_url)
                    });
                }
            }
            if (found.size !== total)
                throw new SourceError('Asura search results changed while counting. Retry the search.');
            return [...found.values()];
        });
        return this.slice(items, offset);
    }
    async series(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal);
        const title = $('h1').first().text().trim();
        if (!title)
            throw new SourceError('Asura series data changed.');
        return {
            id, source: 'asura', title, description: $('meta[name="description"]').attr('content') ?? ''
        };
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal) {
        if (!this.matches(filter))
            return this.slice([], offset);
        const items = await this.cached(`chapters:${id}`, async () => {
            const $ = await this.page(this.url(id), signal), props = astroProps($, 'ChapterListReact');
            if (!Array.isArray(props.chapters))
                throw new SourceError('Asura chapters changed.');
            if (props.totalChapters && props.chapters.length < props.totalChapters)
                throw new SourceError('Asura returned only part of its chapter list. Connector update required before bulk selection.');
            return this.sort(props.chapters.filter((c: any) => !c.is_premium && (!c.early_access_until || Date.parse(c.early_access_until) <= Date.now()) && (!c.published_at || Date.parse(c.published_at) <= Date.now())).map((c: any) => this.chapterItem(id, `${this.url(id).replace(/\/$/, '')}/chapter/${c.number}`, String(c.number), '', typeof c.page_count === 'number' ? c.page_count : null)));
        });
        return this.slice(items, offset);
    }
    async chapter(id: string, signal?: AbortSignal) {
        const url = this.url(id), u = new URL(url);
        if (!/\/chapter\/[^/]+$/.test(u.pathname))
            throw new SourceError('Invalid Asura chapter identity.');
        const pages = await this.resolve(id, signal);
        return this.chapterItem(encodePath(u.pathname.replace(/\/chapter\/[^/]+$/, '')), url, u.pathname.split('/').at(-1)!, '', pages.urls.length);
    }
    async resolve(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal);
        return this.resolved($('img').toArray().map(e => $(e).attr('data-src') ?? $(e).attr('src') ?? '').filter(u => u.includes('/asura-images/chapters/')));
    }
}
