import type { SourceAdapter, SourceManifest } from '../shared/types.js';
import { MangaDex } from './mangadex.js';
import { sharedHttp } from './http.js';
import { Asura } from './asura.js';
import { Flame } from './flame.js';
import { Webtoon } from './webtoon.js';
import { SourceError } from '../shared/types.js';
import { Comix, type ComixBrowser } from './comix.js';
import { MangaPill } from './mangapill.js';
import { WeebCentral } from './weebcentral.js';
import { WordPressSource } from './wordpress.js';
export function websiteAdapters(cookies?: (source: string, url: URL) => Promise<string>, comix?: ComixBrowser): SourceAdapter[] {
    return [new Asura(undefined, u => cookies?.('asura', u) ?? Promise.resolve('')), new Flame(undefined, u => cookies?.('flame', u) ?? Promise.resolve('')), new Webtoon(undefined, u => cookies?.('webtoon', u) ?? Promise.resolve('')), new WordPressSource('thunder', undefined, u => cookies?.('thunder', u) ?? Promise.resolve('')), new MangaPill(undefined, u => cookies?.('mangapill', u) ?? Promise.resolve('')), new WeebCentral(undefined, u => cookies?.('weebcentral', u) ?? Promise.resolve('')), new Comix(comix)];
}
export class Registry {
    private adapters = new Map<string, SourceAdapter>();
    constructor(adapters?: SourceAdapter[]) {
        for (const a of adapters ?? [new MangaDex(sharedHttp), ...websiteAdapters()]) {
            if (a.manifest.interfaceVersion !== 1 || !/^[a-z][a-z0-9-]{0,29}$/.test(a.manifest.id) || a.manifest.status !== 'operational' || this.adapters.has(a.manifest.id))
                throw Error('Invalid source registration');
            this.adapters.set(a.manifest.id, a);
        }
    }
    get(id: string) {
        const a = this.adapters.get(id);
        if (!a)
            throw new SourceError(id === 'toongod' ? 'ToonGod has been removed. Existing files and history are preserved; choose another source for new downloads.' : 'Source is planned or unknown.', 'action_required');
        return a;
    }
    manifests(): SourceManifest[] {
        return [...this.adapters.values()].map(a => a.manifest);
    }
}
