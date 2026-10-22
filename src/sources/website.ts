import { load, type CheerioAPI } from 'cheerio';
import { createHash } from 'node:crypto';
import { SafeHttp, validateUrl, type RequestOptions } from './http.js';
import { SourceError, type SourceAdapter, type SourceManifest, type Series, type Chapter, type ChapterFilter, type PageResult } from '../shared/types.js';
export type WebsiteTransport = Pick<SafeHttp, 'html' | 'get'>;
export function encodePath(value: string) {
    return Buffer.from(value).toString('base64url');
}
export function decodePath(id: string) {
    if (!/^[A-Za-z0-9_-]{1,1200}$/.test(id))
        throw new SourceError('Invalid source identity.');
    const s = Buffer.from(id, 'base64url').toString();
    if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || /[\x00-\x1f]/.test(s) || encodePath(s) !== id)
        throw new SourceError('Invalid source identity.');
    return s;
}
export const text = (s: string) => load(s).text().replace(/\s+/g, ' ').trim();
// Only connectors with immutable image paths opt in. Unknown image/query schemes retain the complete URL.
export function pageIdentity(url: string, immutablePath = false) {
    if (!immutablePath)
        return url;
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()])
        if (['token', 'expires', 'signature', 'Signature', 'Policy', 'Key-Pair-Id'].includes(key) || key.startsWith('X-Amz-'))
            u.searchParams.delete(key);
    return u.pathname + u.search;
}
export function nextData($: CheerioAPI): Record<string, any> {
    try {
        return JSON.parse($('#__NEXT_DATA__').text()).props.pageProps;
    }
    catch {
        throw new SourceError('Source page data changed. Please report this connector error.');
    }
}
export function astroProps($: CheerioAPI, component: string): any {
    const raw = $('astro-island').toArray().find(el => el.attribs['component-url']?.includes(component))?.attribs.props;
    if (!raw)
        throw new SourceError('Source component data changed.');
    function revive(v: any): any {
        if (Array.isArray(v) && typeof v[0] === 'number') {
            if (v[0] === 0)
                return revive(v[1]);
            if (v[0] === 1)
                return v[1].map(revive);
        }
        if (v && typeof v === 'object' && !Array.isArray(v))
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
        return v;
    }
    try {
        return revive(JSON.parse(raw));
    }
    catch {
        throw new SourceError('Invalid source component data.');
    }
}
export abstract class WebsiteSource implements SourceAdapter {
    abstract manifest: SourceManifest;
    protected abstract identityPattern: RegExp;
    protected cache = new Map<string, {
        expires: number;
        value: unknown;
    }>();
    constructor(protected http: WebsiteTransport = new SafeHttp(1100), private cookies?: RequestOptions['cookies']) {
    }
    get account(): {
        kind: 'browser';
        loginUrl: string;
    } {
        return { kind: 'browser', loginUrl: this.manifest.website };
    }
    protected path(url: string): string {
        const u = validateUrl(new URL(url, this.manifest.website).href, this.manifest.apiHosts);
        u.hash = '';
        return u.pathname + u.search;
    }
    protected url(id: string): string {
        const relative = decodePath(id);
        if (!this.identityPattern.test(relative))
            throw new SourceError('Invalid source identity path.');
        return validateUrl(new URL(relative, this.manifest.website).href, this.manifest.apiHosts).href;
    }
    protected async page(url: string, signal?: AbortSignal) {
        return load(await this.http.html(validateUrl(url, this.manifest.apiHosts).href, this.manifest.apiHosts, signal, this.cookies));
    }
    protected async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const old = this.cache.get(key);
        if (old && old.expires > Date.now())
            return old.value as T;
        const value = await fn();
        if (this.cache.size >= 40)
            this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: Date.now() + 120000, value });
        return value;
    }
    protected coverReference(value?: string) {
        if (!value)
            return undefined;
        try {
            return validateUrl(new URL(value, this.manifest.website).href, this.manifest.imageHosts).href;
        }
        catch {
            return undefined;
        }
    }
    protected slice<T>(items: T[], offset: number, limit = 50): PageResult<T> {
        if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
            throw new SourceError('Invalid page offset.');
        return {
            items: items.slice(offset, offset + limit), total: items.length, offset, limit
        };
    }
    protected chapterItem(seriesId: string, path: string, number: string, title = '', pages: number | null = null): Chapter {
        return {
            id: encodePath(this.path(path)), source: this.manifest.id, seriesId, title: text(title), number, volume: '', language: 'en', groups: [{ id: this.manifest.id, name: this.manifest.name }], pages, external: false
        };
    }
    protected matches(filter: ChapterFilter) {
        return filter.language === 'en' && (!filter.group || filter.group === this.manifest.id);
    }
    protected sort(chapters: Chapter[]) {
        return [...new Map(chapters.map(c => [c.id, c])).values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    }
    protected async crawl(start: string, parse: ($: CheerioAPI) => void, links: ($: CheerioAPI) => string[], signal?: AbortSignal) {
        const pending = [start], seen = new Set<string>();
        while (pending.length) {
            signal?.throwIfAborted();
            const url = pending.shift()!;
            const key = this.path(url);
            if (seen.has(key))
                continue;
            if (seen.size >= 500)
                throw new SourceError('Source has too many pages to count safely. Narrow the search.');
            seen.add(key);
            const $ = await this.page(new URL(key, this.manifest.website).href, signal);
            parse($);
            for (const link of links($)) {
                const target = new URL(this.path(link), this.manifest.website).href;
                if (!seen.has(this.path(target)))
                    pending.push(target);
            }
        }
    }
    protected resolved(urls: string[]) {
        if (!urls.length)
            throw new SourceError('No public chapter pages are available. It may require local login, payment, an app, or source repair.', 'action_required');
        if (urls.length > 2000)
            throw new SourceError('Chapter page count exceeds safety limit.');
        const validated = urls.map(u => validateUrl(u, this.manifest.imageHosts).href), identities = validated.map(u => createHash('sha256').update(pageIdentity(u, ['asura', 'flame'].includes(this.manifest.id))).digest('hex'));
        return {
            revision: createHash('sha256').update(JSON.stringify(identities)).digest('hex'), identities, urls: validated
        };
    }
    async cover(id: string, signal?: AbortSignal, reference?: string) {
        if (reference)
            return this.readPage(validateUrl(reference, this.manifest.imageHosts).href, signal);
        const $ = await this.page(this.url(id), signal);
        const image = $('meta[property="og:image"]').attr('content') || $('.summary_image img,.thumb img,.detail_header img').first().attr('data-src') || $('.summary_image img,.thumb img,.detail_header img').first().attr('src');
        if (!image)
            throw new SourceError('This series has no available cover art.');
        return this.readPage(new URL(image, this.manifest.website).href, signal);
    }
    async readPage(url: string, signal?: AbortSignal) {
        return this.http.get(url, this.manifest.imageHosts, signal, true, { referer: this.manifest.website, cookies: this.cookies ? u => this.manifest.apiHosts.includes(u.hostname) ? this.cookies!(u) : Promise.resolve('') : undefined });
    }
    abstract search(query: string, offset: number, signal?: AbortSignal): Promise<PageResult<Series>>;
    abstract series(id: string, signal?: AbortSignal): Promise<Series>;
    abstract chapters(id: string, filter: ChapterFilter, offset: number, signal?: AbortSignal): Promise<PageResult<Chapter>>;
    abstract chapter(id: string, signal?: AbortSignal): Promise<Chapter>;
    abstract resolve(id: string, signal?: AbortSignal): Promise<import('../shared/types.js').ResolvedPages>;
}
export function manifest(id: string, name: string, website: string, imageHosts: string[], note?: string): SourceManifest {
    return {
        id, name, website, status: 'operational', interfaceVersion: 1, apiHosts: [new URL(website).hostname], imageHosts, capabilities: ['search', 'series', 'chapters', 'public-download', 'local-session'], note, recommended: {
            chapters: 1, pageRequests: 1, requestIntervalMs: 1100
        }
    };
}
