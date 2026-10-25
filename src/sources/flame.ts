import { WebsiteSource, manifest, nextData, encodePath, text } from './website.js';
import type { ChapterFilter, Series } from '../shared/types.js';
import { SourceError } from '../shared/types.js';
export class Flame extends WebsiteSource {
    protected identityPattern = /^\/series\/\d+(?:\/[a-f0-9]{16})?\/?$/i;
    manifest = manifest('flame', 'Flame Comics', 'https://flamecomics.xyz/', ['cdn.flamecomics.xyz']);
    private parseSeries(s: any): Series {
        if (!Number.isInteger(s?.series_id) || typeof s.title !== 'string')
            throw new SourceError('Flame series data changed.');
        return {
            id: encodePath(`/series/${s.series_id}`), source: 'flame', title: s.title, metadata: { ...s }, description: text(s.description ?? ''), coverRef: this.coverReference(s.cover ?? s.cover_url)
        };
    }
    async search(query: string, offset = 0, signal?: AbortSignal) {
        const items = await this.cached('catalog', async () => {
            const data = nextData(await this.page('https://flamecomics.xyz/browse', signal));
            if (!Array.isArray(data.series))
                throw new SourceError('Flame catalog data changed.');
            return data.series.filter((s: any) => s.type !== 'Novel' && s.type !== 'Web Novel').map((s: any) => this.parseSeries(s));
        });
        return this.slice(items.filter(s => s.title.toLowerCase().includes(query.toLowerCase())), offset);
    }
    async series(id: string, signal?: AbortSignal) {
        return this.parseSeries(nextData(await this.page(this.url(id), signal)).series);
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal) {
        if (!this.matches(filter))
            return this.slice([], offset);
        const items = await this.cached(`chapters:${id}`, async () => {
            const d = nextData(await this.page(this.url(id), signal));
            if (!Array.isArray(d.chapters))
                throw new SourceError('Flame chapter data changed.');
            return this.sort(d.chapters.filter((c: any) => !c.notice && Number(c.release_date) * 1000 <= Date.now()).map((c: any) => {
                if (!/^[a-f0-9]{16}$/i.test(c.token))
                    throw new SourceError('Flame chapter identity changed.');
                return this.chapterItem(id, `/series/${d.series.series_id}/${c.token}`, String(Number(c.chapter)), c.title ?? '');
            }));
        });
        return this.slice(items, offset);
    }
    async chapter(id: string, signal?: AbortSignal) {
        const d = nextData(await this.page(this.url(id), signal)), c = d.chapter;
        if (!c)
            throw new SourceError('Flame chapter is unavailable.');
        return this.chapterItem(encodePath(`/series/${c.series_id}`), this.url(id), String(Number(c.chapter)), c.chapter_title ?? '', Object.keys(c.images ?? {}).length);
    }
    async resolve(id: string, signal?: AbortSignal) {
        const url = this.url(id), $ = await this.page(url, signal), d = nextData($);
        if (!d.chapter?.images)
            throw new SourceError('Flame chapter pages are unavailable.', 'action_required');
        const paths = Object.keys(d.chapter.images).sort((a, b) => Number(a) - Number(b)).map(k => d.chapter.images[k].name);
        const urls = paths.map(name => {
            const el = $('img').toArray().find(e => {
                try {
                    return new URL(e.attribs.src).pathname.endsWith('/' + name);
                }
                catch {
                    return false;
                }
            });
            if (!el)
                throw new SourceError('Flame reader image data changed.');
            return el.attribs.src;
        });
        return this.resolved(urls);
    }
}
