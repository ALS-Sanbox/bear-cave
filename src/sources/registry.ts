import type { SourceAdapter, SourceManifest } from '../shared/types.js';
import { MangaDex } from './mangadex.js';
import { sharedHttp } from './http.js';
export class Registry {
  private adapters = new Map<string, SourceAdapter>();
  constructor(adapters: SourceAdapter[] = [new MangaDex(sharedHttp)]) { for (const a of adapters) { if (a.manifest.interfaceVersion !== 1 || !/^[a-z][a-z0-9-]{0,29}$/.test(a.manifest.id) || a.manifest.status!=='operational' || this.adapters.has(a.manifest.id)) throw Error('Invalid source registration'); this.adapters.set(a.manifest.id, a); } }
  get(id: string) { const a = this.adapters.get(id); if (!a) throw Error('Source is planned or unknown.'); return a; }
  manifests(): SourceManifest[] {
    const planned = [['toongod','ToonGod','https://www.toongod.org/'],['asura','Asura Scans','https://asurascans.com/comics'],['flame','Flame Comics','https://flamecomics.xyz/'],['webtoon','WEBTOON','https://www.webtoons.com/en/'],['thunder','ThunderScans','https://en-thunderscans.com/']];
    return [...this.adapters.values()].map(a => a.manifest).concat(planned.map(([id,name,website]) => ({ id,name,website,status: 'planned' as const, interfaceVersion: 1 as const, capabilities: [], apiHosts: [], imageHosts: [], recommended: { chapters: 1,pageRequests: 1,requestIntervalMs: 1000 } })));
  }
}
