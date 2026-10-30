import { load } from 'cheerio';
import { WebsiteSource, manifest, encodePath, text, type WebsiteTransport } from './website.js';
import { SourceError, type ChapterFilter, type Series } from '../shared/types.js';
export interface ComixBrowser {
    fastPath?: boolean;
    render?: (url: string, mode: 'browse' | 'series' | 'chapters' | 'reader', signal?: AbortSignal) => Promise<string>;
    transport?: WebsiteTransport;
    hosts?: string[];
}
export class Comix extends WebsiteSource {
    protected identityPattern = /^\/title\/[a-z0-9]+-[a-z0-9-]+(?:\/\d+-chapter-\d+(?:\.\d+)?)?\/?$/i;
    manifest = manifest('comix', 'Comix', 'https://comix.to/browse', ['comix.to', 'static.comix.to'], 'Uses rendered pages in the desktop browser session. Human verification, when requested, needs local interaction.');
    constructor(private browser: ComixBrowser = {}) {
        super(browser.transport);
        if (browser.hosts)
            this.manifest.imageHosts = browser.hosts;
        this.manifest.capabilities.push('translation-groups');
    }
    private browserEnabled = true;
    override configureDownloads(settings: import('../shared/types.js').Settings) {
        super.configureDownloads(settings);
        this.browserEnabled = settings.browserAssisted !== false;
    }
    private async rendered(url: string, mode: 'browse' | 'series' | 'chapters' | 'reader', signal?: AbortSignal) {
        if (this.browser.fastPath && (mode === 'browse' || mode === 'series')) {
            try {
                const page = await this.page(url, signal);
                if (mode === 'browse' ? page('a[href^="/title/"]').length || /0 items|no results|no titles/i.test(page('body').text()) : page('h1.mpage__title').length && page('#initial-data').length)
                    return page;
            }
            catch (e) {
                if (signal?.aborted || e instanceof SourceError && !['action_required', 'transient'].includes(e.kind))
                    throw e;
            }
        }
        if (!this.browserEnabled)
            throw new SourceError('Browser-assisted retrieval is disabled. Enable it in Download performance to use this source.', 'action_required');
        if (!this.browser.render)
            throw new SourceError('Comix requires the Bear Cave desktop browser connection. Open the desktop app and retry.', 'action_required');
        return load(await this.browser.render(url, mode, signal));
    }
    async search(query: string, offset = 0, signal?: AbortSignal) {
        signal?.throwIfAborted();
        return this.cached(`search:${query}:${offset}`, () => this.searchPage(query, offset, signal));
    }
    private async searchPage(query: string, offset: number, signal?: AbortSignal) {
        const limit = 28, page = Math.floor(offset / limit) + 1;
        const $ = await this.rendered(`https://comix.to/browse?keyword=${encodeURIComponent(query)}&page=${page}`, 'browse', signal);
        const found = new Map<string, Series>();
        $('a[href^="/title/"]').each((_i, el) => {
            const a = $(el), path = this.path(a.attr('href')!);
            if (!/^\/title\/[a-z0-9]+-[a-z0-9-]+\/?$/i.test(path))
                return;
            const id = encodePath(path), old = found.get(id), image = a.find('img');
            const title = a.find('h2,h3').first().text().trim() || a.attr('title') || image.attr('alt') || a.text().trim();
            found.set(id, {
                id, source: 'comix', title: text(title || old?.title || ''), description: '', coverRef: this.coverReference(image.attr('src') || image.attr('data-src')) || old?.coverRef
            });
        });
        const items = [...found.values()].filter(s => s.title);
        const next = $('.npager [aria-label="Next page"]').toArray().some(e => !$(e).is('[disabled],[aria-disabled="true"]'));
        return {
            items, totalExact: !next, total: offset + items.length + (next ? 1 : 0), offset, limit
        };
    }
    async series(id: string, signal?: AbortSignal): Promise<Series> {
        signal?.throwIfAborted();
        return this.cached(`series:${id}`, () => this.seriesPage(id, signal));
    }
    private async seriesPage(id: string, signal?: AbortSignal): Promise<Series> {
        const url = this.url(id), $ = await this.rendered(url, 'series', signal);
        let data: any;
        try {
            const initial = JSON.parse($('#initial-data').text());
            data = Object.entries(initial.queries || {}).find(([k]) => k.includes('"detail"'))?.[1];
        }
        catch { /* Fall back to visible metadata. */
        }
        const title = data?.title || $('h1.mpage__title').text().trim();
        if (!title)
            throw new SourceError('Comix series metadata changed.');
        return {
            id, source: 'comix', title, url, description: text(data?.synopsis || $('.mpage__synopsis').text() || ''), coverRef: this.coverReference(data?.poster?.large || data?.poster?.medium || $('meta[property="og:image"]').attr('content')), metadata: {
                authors: data?.authors, artists: data?.artists, genres: data?.genres, alternative_titles: data?.altTitles, status: data?.status, type: data?.type, release_year: data?.year
            }
        };
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal) {
        if (!['en', '*'].includes(filter.language))
            return this.slice([], offset);
        const items = await this.cached(`chapters:${id}`, async () => {
            const $ = await this.rendered(this.url(id), 'chapters', signal);
            return this.sort($('.mchap-item').toArray().map(e => {
                const row = $(e), a = row.find('a[href*="-chapter-"]').first(), href = a.attr('href');
                const number = href?.match(/-chapter-(\d+(?:\.\d+)?)\/?$/)?.[1];
                if (!href || !number)
                    throw new SourceError('Comix chapter identity changed.');
                const chapter = this.chapterItem(id, href, number, a.text());
                const group = row.find('a[href^="/groups/"],a[href^="/u/"]').first(), groupPath = group.attr('href');
                if (groupPath)
                    chapter.groups = [{ id: groupPath.replace(/^\//, '').replace(/[^a-z0-9_-]/gi, '_'), name: group.text().trim() }];
                return chapter;
            }));
        });
        return this.slice(items.filter(c => !filter.group || c.groups.some(g => g.id === filter.group)), offset);
    }
    async chapter(id: string, signal?: AbortSignal) {
        const url = this.url(id), parts = new URL(url).pathname.split('/'), number = parts[3]?.match(/-chapter-(\d+(?:\.\d+)?)/)?.[1];
        if (!number)
            throw new SourceError('Invalid Comix chapter identity.');
        signal?.throwIfAborted();
        return this.chapterItem(encodePath(`/title/${parts[2]}`), url, number);
    }
    async resolve(id: string, signal?: AbortSignal) {
        const url = this.url(id);
        if (!new URL(url).pathname.includes('-chapter-'))
            throw new SourceError('Choose a Comix chapter.');
        const $ = await this.rendered(url, 'reader', signal);
        const images = $('img[data-bear-cave-page]').toArray().sort((a, b) => Number($(a).attr('data-bear-cave-page')) - Number($(b).attr('data-bear-cave-page')));
        return this.resolved(images.map(e => $(e).attr('src') || ''));
    }
    override async cover(id: string, signal?: AbortSignal, reference?: string) {
        const url = reference || (await this.series(id, signal)).coverRef;
        if (!url)
            throw new SourceError('Comix cover unavailable.');
        return this.readPage(url, signal);
    }
    override async readPage(url: string, signal?: AbortSignal) {
        // Current Comix CDNs reject explicit Referer/Origin headers. Keep the
        // ordinary public image request used by the original adapter.
        return this.http.get(url, this.manifest.imageHosts, signal, true);
    }
    override async downloadPage(url: string, file: string, signal?: AbortSignal) {
        if (this.http.getToFile)
            await this.http.getToFile(url, this.manifest.imageHosts, file, signal);
        else {
            const { writeFile } = await import('node:fs/promises');
            await writeFile(file, await this.readPage(url, signal));
        }
    }
}
