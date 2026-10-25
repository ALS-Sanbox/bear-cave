import { WebsiteSource, manifest, encodePath, text } from './website.js';
import { SourceError, type ChapterFilter, type Series } from '../shared/types.js';
export class WordPressSource extends WebsiteSource {
    protected identityPattern = /^\/(?:(?:comics|manga|webtoon)\/[a-z0-9-]+(?:\/[a-z0-9.-]+)?|[a-z0-9-]+-chapter-[a-z0-9.-]+)\/?$/i;
    constructor(id: 'thunder' | 'toongod', http?: import('./website.js').WebsiteTransport, cookies?: import('./http.js').RequestOptions['cookies']) {
        super(http, cookies);
        this.manifest = id === 'thunder' ? manifest(id, 'ThunderScans', 'https://en-thunderscans.com/', ['en-thunderscans.com']) : manifest(id, 'ToonGod', 'https://www.toongod.org/', ['www.toongod.org', 'toongod.org', '*.toongod.org'], 'Enabled connector; live access requires local human verification. Reader markup remains unverified against the protected site.');
    }
    manifest: import('../shared/types.js').SourceManifest;
    protected override async page(url: string, signal?: AbortSignal) {
        try {
            return await super.page(url, signal);
        }
        catch (e) {
            if (e instanceof SourceError && e.kind === 'action_required')
                throw new SourceError(`${this.manifest.name}: public access was denied or a human verification challenge was returned. Open the source session from the local tray and retry if access is available. Search, chapter lists and readers cannot be verified while blocked.`, 'action_required');
            throw e;
        }
    }
    async search(query: string, offset = 0, signal?: AbortSignal) {
        const items = await this.cached(`search:${query}`, async () => {
            const found = new Map<string, Series>();
            const start = new URL(`/?s=${encodeURIComponent(query)}&post_type=wp-manga`, this.manifest.website).href;
            await this.crawl(start, $ => {
                $('.bsx a,.c-tabs-item__content .post-title a,.post-title h3 a,.listupd .bs a').each((_i, e) => {
                    const a = $(e), href = a.attr('href');
                    if (!href)
                        return;
                    const p = this.path(href);
                    if (!/^\/(comics|manga|webtoon)\/[^/?#]+\/?$/.test(p))
                        return;
                    const title = a.find('h2,h3,.tt').first().text().trim() || a.attr('title') || a.find('img').attr('alt') || a.text().trim();
                    if (!title)
                        return;
                    const id = encodePath(p);
                    found.set(id, {
                        id, source: this.manifest.id, title: text(title), description: '', coverRef: this.coverReference(a.find('img').attr('data-src') || a.find('img').attr('src'))
                    });
                });
            }, $ => $('a.next.page-numbers,.pagination .next a,.hpage a.r').toArray().map(e => $(e).attr('href')!).filter(Boolean), signal);
            return [...found.values()];
        });
        return this.slice(items, offset);
    }
    async series(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal), title = $('.entry-title,.post-title h1,h1').first().clone().children('span,div').remove().end().text().trim();
        if (!title)
            throw new SourceError('Source series layout changed.');
        const fields: Record<string, string> = Object.fromEntries($('.post-content_item,.post-status .post-content_item').toArray().map(e => [$(e).find('.summary-heading').text().trim(), $(e).find('.summary-content').text().trim()]).filter(([k]) => k));
        const field = (pattern: RegExp) => Object.entries(fields).find(([k]) => pattern.test(k))?.[1] || null;
        const release = field(/release|year/i)?.match(/\b(?:19|20)\d{2}\b/)?.[0];
        return {
            id, source: this.manifest.id, title, url: this.url(id), coverRef: this.coverReference($('meta[property="og:image"]').attr('content')), metadata: {
                authors: $('.author-content a').toArray().map(e => $(e).text().trim()),
                artists: $('.artist-content a').toArray().map(e => $(e).text().trim()),
                genres: $('.genres-content a').toArray().map(e => $(e).text().trim()),
                tags: $('.tags-content a').toArray().map(e => $(e).text().trim()),
                alternative_titles: field(/alternative/i) ? [field(/alternative/i)] : [],
                status: field(/^status$/i), type: field(/^type$/i), release_year: release ? Number(release) : null, original_language: field(/language/i),
                source_fields: fields
            }, description: text($('.entry-content[itemprop="description"],.summary__content,.description-summary').first().html() ?? '')
        };
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal) {
        if (!this.matches(filter))
            return this.slice([], offset);
        const items = await this.cached(`chapters:${id}`, async () => {
            const collected: import('../shared/types.js').Chapter[] = [];
            await this.crawl(this.url(id), $ => {
                const links = $('#chapterlist a[href],.wp-manga-chapter a[href],.listing-chapters_wrap a[href]').toArray().filter(e => !$(e).attr('href')!.startsWith('#'));
                if (!links.length)
                    throw new SourceError('Chapter list is unavailable or requires local interaction.', 'action_required');
                collected.push(...links.filter(e => !$(e).closest('li').find('.fa-lock,.locked,.premium').length).map(e => {
                    const a = $(e), href = a.attr('href')!;
                    const name = text(a.find('.chapternum').text() || a.text());
                    const number = name.match(/(?:chapter|ch[.\s]*)\s*(\d+(?:\.\d+)?)/i)?.[1] ?? name.match(/\d+(?:\.\d+)?/)?.[0] ?? name;
                    return this.chapterItem(id, href, number, name);
                }));
            }, $ => $('.listing-chapters_wrap a.next.page-numbers,#chapterlist a.next.page-numbers').toArray().map(e => $(e).attr('href')!).filter(Boolean), signal);
            return this.sort(collected);
        });
        return this.slice(items, offset);
    }
    async chapter(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal);
        const series = $('a[href*="/comics/"],a[href*="/manga/"],a[href*="/webtoon/"],.post-title a,.allc a').toArray().map(e => $(e).attr('href')).find(h => h && /^\/(comics|manga|webtoon)\/[^/]+\/?$/.test(this.path(h)));
        if (!series)
            throw new SourceError('Source chapter series link changed.');
        const title = $('h1').first().text().trim(), number = title.match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1] ?? title;
        return this.chapterItem(encodePath(this.path(series)), this.url(id), number, title);
    }
    async resolve(id: string, signal?: AbortSignal) {
        const $ = await this.page(this.url(id), signal);
        const script = $('script').toArray().map(e => $(e).html() ?? '').find(s => s.includes('ts_reader.run('));
        let urls: string[] = [];
        if (script) {
            const json = script.match(/ts_reader\.run\((\{[\s\S]*?\})\)\s*;/)?.[1];
            try {
                const data = JSON.parse(json ?? '');
                if (data.protected || data.unlock_token)
                    throw new SourceError('Chapter requires authorized local access.', 'action_required');
                urls = data.sources?.[0]?.images ?? [];
            }
            catch (e) {
                if (e instanceof SourceError)
                    throw e;
                throw new SourceError('Source reader data changed.');
            }
        }
        else
            urls = $('.reading-content img,#readerarea img').toArray().map(e => ($(e).attr('data-src') || $(e).attr('data-lazy-src') || $(e).attr('data-original') || $(e).attr('src') || '').trim()).filter(u => !u.endsWith('.svg') && !u.startsWith('data:'));
        return this.resolved(urls.map(u => new URL(u, this.manifest.website).href));
    }
}
