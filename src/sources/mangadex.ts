import { z } from 'zod';
import { SafeHttp, sharedHttp } from './http.js';
import { SourceError, type SourceAdapter, type SourceManifest, type Chapter, type Series, type ChapterFilter, type PageResult } from '../shared/types.js';
export const uuid = z.string().uuid();
const relationship = z.object({
    id: z.string(), type: z.string(), attributes: z.object({ name: z.string().optional() }).passthrough().optional()
});
const entity = z.object({
    id: z.string().uuid(), attributes: z.record(z.string(), z.unknown()), relationships: z.array(relationship).default([])
});
type Entity = z.infer<typeof entity>;
const collection = z.object({
    data: z.array(entity), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive()
});
export const mangadexManifest: SourceManifest = {
    id: 'mangadex', name: 'MangaDex', website: 'https://mangadex.org/', status: 'operational', interfaceVersion: 1, capabilities: ['search', 'series', 'chapters', 'public-download', 'local-session'], apiHosts: ['api.mangadex.org'], imageHosts: ['uploads.mangadex.org', '*.mangadex.network'], recommended: {
        chapters: 1, pageRequests: 1, requestIntervalMs: 300
    }
};
function localized(value: unknown): string {
    const v = z.record(z.string(), z.string()).safeParse(value);
    return v.success ? v.data.en ?? Object.values(v.data)[0] ?? '' : '';
}
export function parseSeries(e: Entity): Series {
    return {
        id: e.id, source: 'mangadex', title: localized(e.attributes.title) || 'Untitled', description: localized(e.attributes.description), coverRef: z.string().optional().parse(e.relationships.find(r => r.type === 'cover_art')?.attributes?.fileName)
    };
}
export function parseChapter(e: Entity): Chapter {
    const a = e.attributes;
    return {
        id: e.id, source: 'mangadex', seriesId: e.relationships.find(r => r.type === 'manga')?.id ?? '', title: String(a.title ?? ''), number: String(a.chapter ?? 'Oneshot'), volume: String(a.volume ?? ''), language: String(a.translatedLanguage ?? ''), groups: e.relationships.filter(r => r.type === 'scanlation_group').map(r => ({ id: r.id, name: r.attributes?.name ?? r.id })), pages: typeof a.pages === 'number' ? a.pages : 0, external: Boolean(a.externalUrl)
    };
}
export type JsonClient = Pick<SafeHttp, 'json'>;
export class MangaDex implements SourceAdapter {
    manifest = mangadexManifest;
    account = {
        kind: 'browser' as const, loginUrl: 'https://mangadex.org/', hosts: ['auth.mangadex.org']
    };
    async cover(id: string, signal?: AbortSignal, reference?: string) {
        uuid.parse(id);
        if (reference && /^[a-zA-Z0-9_.-]+$/.test(reference))
            return this.images.get(`https://uploads.mangadex.org/covers/${id}/${reference}`, this.manifest.imageHosts, signal, true);
        const r = z.object({ data: entity }).parse(await this.api(`/manga/${id}`, new URLSearchParams({ 'includes[]': 'cover_art' }), signal));
        const cover = r.data.relationships.find(r => r.type === 'cover_art');
        const file = z.string().regex(/^[a-zA-Z0-9_.-]+$/).safeParse(cover?.attributes?.fileName);
        if (!file.success)
            throw new SourceError('This series has no available cover art.');
        return this.images.get(`https://uploads.mangadex.org/covers/${id}/${file.data}`, this.manifest.imageHosts, signal, true);
    }
    constructor(private http: JsonClient, private images: Pick<SafeHttp, 'get'> = sharedHttp) {
    }
    private async api(route: string, params: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
        return this.http.json(`https://api.mangadex.org${route}?${params}`, this.manifest.apiHosts, signal);
    }
    async search(query: string, offset = 0, signal?: AbortSignal): Promise<PageResult<Series>> {
        const p = this.pagination(offset, 20);
        p.set('includes[]', 'cover_art');
        p.set('title', query.slice(0, 200));
        p.set('order[relevance]', 'desc');
        const result = collection.parse(await this.api('/manga', p, signal));
        return { ...result, items: result.data.map(parseSeries) };
    }
    async series(id: string, signal?: AbortSignal): Promise<Series> {
        uuid.parse(id);
        const r = z.object({ data: entity }).parse(await this.api(`/manga/${id}`, new URLSearchParams({ 'includes[]': 'cover_art' }), signal));
        return parseSeries(r.data);
    }
    async chapter(id: string, signal?: AbortSignal): Promise<Chapter> {
        uuid.parse(id);
        const r = z.object({ data: entity }).parse(await this.api(`/chapter/${id}`, new URLSearchParams({ 'includes[]': 'scanlation_group' }), signal));
        return parseChapter(r.data);
    }
    async chapters(id: string, filter: ChapterFilter, offset = 0, signal?: AbortSignal): Promise<PageResult<Chapter>> {
        uuid.parse(id);
        const p = this.pagination(offset, 100);
        p.set('manga', id);
        p.set('translatedLanguage[]', z.string().regex(/^[a-z]{2,3}(-[a-z]{2})?$/).parse(filter.language));
        if (filter.group)
            p.set('groups[]', uuid.parse(filter.group));
        p.set('includes[]', 'scanlation_group');
        p.set('order[volume]', 'asc');
        p.set('order[chapter]', 'asc');
        p.set('includeFutureUpdates', '0');
        p.set('includeEmptyPages', '0');
        p.set('includeExternalUrl', '0');
        p.set('includeUnavailable', '0');
        // /chapter supports groups[]; the manga feed endpoint does not declare that filter.
        const r = collection.parse(await this.api('/chapter', p, signal));
        return { ...r, items: r.data.map(parseChapter) };
    }
    private pagination(offset: number, limit: number) {
        if (!Number.isInteger(offset) || offset < 0 || offset + limit > 10000)
            throw new SourceError('MangaDex pagination is limited to 10,000 results. Narrow your search or chapter filters.');
        return new URLSearchParams({ limit: String(limit), offset: String(offset) });
    }
    async resolve(id: string, signal?: AbortSignal) {
        uuid.parse(id);
        const chapter = await this.chapter(id, signal);
        if (chapter.external)
            throw new SourceError('This chapter is hosted externally and cannot be downloaded by the MangaDex connector.');
        if (chapter.pages === null || chapter.pages <= 0)
            throw new SourceError('This chapter has no available pages.');
        const r = z.object({ baseUrl: z.string().url(), chapter: z.object({ hash: z.string().regex(/^[a-f0-9]+$/i), data: z.array(z.string().regex(/^[a-zA-Z0-9_.-]+$/)).min(1).max(2000) }) }).parse(await this.api(`/at-home/server/${id}`, new URLSearchParams({ forcePort443: 'true' }), signal));
        return {
            revision: r.chapter.hash, identities: r.chapter.data, urls: r.chapter.data.map(file => `${r.baseUrl}/data/${r.chapter.hash}/${encodeURIComponent(file)}`)
        };
    }
}
