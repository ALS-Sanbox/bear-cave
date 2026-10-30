import type { SourceAdapter, SourceManifest } from '../shared/types.js';
import { MangaDex } from './mangadex.js';
import { sharedHttp } from './http.js';
import { Asura } from './asura.js';
import { Flame } from './flame.js';
import { Webtoon } from './webtoon.js';
import { SourceError } from '../shared/types.js';
import { Comix, type ComixBrowser } from './comix.js';
import { MangaFreak } from './mangafreak.js';
import { MangaPill } from './mangapill.js';
import { WeebCentral } from './weebcentral.js';
import type { WebsiteTransport } from './website.js';
import { WordPressSource } from './wordpress.js';
export function websiteAdapters(cookies?: (source: string, url: URL) => Promise<string>, comix?: ComixBrowser, transport?: (source: string, hosts: string[]) => WebsiteTransport): SourceAdapter[] {
    const adapters = [new Asura(undefined, u => cookies?.('asura', u) ?? Promise.resolve('')), new Flame(undefined, u => cookies?.('flame', u) ?? Promise.resolve('')), new Webtoon(undefined, u => cookies?.('webtoon', u) ?? Promise.resolve('')), new WordPressSource('thunder', undefined, u => cookies?.('thunder', u) ?? Promise.resolve('')), new MangaPill(undefined, u => cookies?.('mangapill', u) ?? Promise.resolve('')), new WeebCentral(undefined, u => cookies?.('weebcentral', u) ?? Promise.resolve('')), new MangaFreak(undefined, u => cookies?.('mangafreak', u) ?? Promise.resolve('')), new Comix(comix)];
    if (transport)
        for (const adapter of adapters) {
            if (adapter.manifest.id !== 'comix')
                adapter.setTransport(transport(adapter.manifest.id, [...adapter.manifest.apiHosts, ...adapter.manifest.imageHosts]));
        }
    return adapters;
}
export const toongodUnavailable: SourceManifest = {
    id: 'toongod', name: 'ToonGod', website: 'https://www.toongod.org/', status: 'planned', interfaceVersion: 1,
    capabilities: [], apiHosts: ['www.toongod.org', 'toongod.org'], imageHosts: [], recommended: {
        chapters: 1, pageRequests: 1, requestIntervalMs: 1100
    },
    note: 'Unavailable: public requests return a Cloudflare human-verification page. Live search, chapter extraction and image downloads have not been verified; downloads remain disabled. Existing files and history are preserved.'
};
export class Registry {
    private adapters = new Map<string, SourceAdapter>();
    constructor(adapters?: SourceAdapter[], private unavailable: SourceManifest[] = adapters === undefined ? [toongodUnavailable] : []) {
        for (const a of adapters ?? [new MangaDex(sharedHttp), ...websiteAdapters()]) {
            if (a.manifest.interfaceVersion !== 1 || !/^[a-z][a-z0-9-]{0,29}$/.test(a.manifest.id) || a.manifest.status !== 'operational' || this.adapters.has(a.manifest.id))
                throw Error('Invalid source registration');
            this.adapters.set(a.manifest.id, a);
        }
    }
    get(id: string) {
        const a = this.adapters.get(id);
        if (!a)
            throw new SourceError(id === 'toongod' ? 'ToonGod was removed from active sources: Cloudflare verification blocks public access and live chapter downloads remain unverified. Existing files and history are preserved; choose another source.' : 'Source is planned or unknown.', 'action_required');
        return a;
    }
    configure(settings: import('../shared/types.js').Settings) {
        for (const adapter of this.adapters.values())
            adapter.configureDownloads?.(settings);
    }
    manifests(): SourceManifest[] {
        return [...this.adapters.values()].map(a => a.manifest).concat(this.unavailable);
    }
}
