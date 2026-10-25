import sharp from 'sharp';
import type { Registry } from '../sources/registry.js';
import type { Series } from '../shared/types.js';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, lstat, realpath } from 'node:fs/promises';
import type { Store } from '../core/store.js';
import { checkPath, markerHasIdentity } from '../engine/folders.js';
import { contained, digest, imageExtension } from '../engine/files.js';
// Read only identity-mapped library files; browsing a cover must not create folders.
export async function readLibraryCover(store: Store, root: string, source: string, id: string) {
    try {
        root = await realpath(root);
        const folder = store.folder(root, `${source}:${id}`);
        if (!folder)
            return;
        const dir = contained(root, folder);
        await checkPath(root, dir);
        const marker = contained(dir, '.bear-cave-series.json');
        await checkPath(root, marker);
        if ((await lstat(marker)).size > 16384)
            return;
        const owner = JSON.parse(await readFile(marker, 'utf8'));
        // Read-only cross-source lookups may map an alias before a download adds it to the marker.
        if (!markerHasIdentity(owner, `${source}:${id}`) && (typeof owner?.identity !== 'string' || store.folder(root, owner.identity) !== folder))
            return;
        const file = contained(dir, 'coverart.png');
        await checkPath(root, file);
        const info = await lstat(file);
        if (!info.isFile() || info.size > 32 * 1024 * 1024)
            return;
        return await readFile(file);
    }
    catch {
        return;
    }
}
async function thumbnail(data: Uint8Array) {
    if (data.byteLength > 32 * 1024 * 1024)
        throw Error('Cover too large');
    imageExtension(data);
    return sharp(Buffer.from(data), { limitInputPixels: 40000000 }).rotate().resize({
        width: 240, height: 360, fit: 'inside', withoutEnlargement: true
    }).png().toBuffer();
}
export class CoverCache {
    private references = new Map<string, string>();
    private cache = new Map<string, {
        expires: number;
        bytes?: Buffer;
    }>();
    private pending = new Map<string, Promise<Buffer>>();
    private bytes = 0;
    private active = 0;
    private shutdown = new AbortController();
    constructor(private registry: Registry, private localCover?: (source: string, id: string) => Promise<Uint8Array | undefined>) {
    }
    remember(series: Series) {
        if (typeof series.coverRef === 'string' && series.coverRef.length <= 4096) {
            const key = `${series.source}:${series.id}`;
            this.references.set(key, series.coverRef);
            if (!this.cache.get(key)?.bytes)
                this.cache.delete(key);
            if (this.references.size > 1000)
                this.references.delete(this.references.keys().next().value!);
        }
    }
    async get(source: string, id: string) {
        this.shutdown.signal.throwIfAborted();
        const referenceKey = `${source}:${id}`;
        const local = await this.localCover?.(source, id).catch(() => undefined);
        this.shutdown.signal.throwIfAborted();
        const key = local ? `${referenceKey}:${digest(local)}` : referenceKey, old = this.cache.get(key);
        if (old && old.expires > Date.now()) {
            if (!old.bytes)
                throw Error('Cover unavailable');
            return old.bytes;
        }
        if (this.pending.has(key))
            return this.pending.get(key)!;
        if (this.pending.size >= 32)
            throw Error('Cover requests are busy');
        const task = Promise.resolve().then(async () => {
            let acquired = false;
            try {
                const signal = AbortSignal.any([AbortSignal.timeout(60000), this.shutdown.signal]);
                while (this.active >= 2)
                    await delay(25, undefined, { signal });
                this.active++;
                acquired = true;
                let bytes: Buffer | undefined;
                if (local) {
                    try {
                        bytes = await thumbnail(local);
                    }
                    catch { /* A corrupt saved cover may be refreshed from the source. */
                    }
                }
                if (!bytes) {
                    const adapter = this.registry.get(source);
                    if (!adapter.cover)
                        throw Error('Cover unavailable');
                    const reference = this.references.get(referenceKey);
                    try {
                        bytes = await thumbnail(await adapter.cover(id, signal, reference));
                    }
                    catch (e) {
                        signal.throwIfAborted();
                        if (!reference)
                            throw e;
                        // Search listings may advertise expired URLs or placeholder images.
                        // Resolve current artwork exactly as the explicit download action does.
                        this.references.delete(referenceKey);
                        bytes = await thumbnail(await adapter.cover(id, signal));
                    }
                }
                this.put(key, bytes, Date.now() + 10 * 60000);
                return bytes;
            }
            catch (e) {
                console.warn(`Cover thumbnail unavailable (${source}:${id}):`, (e as Error).message);
                this.put(key, undefined, Date.now() + 60000);
                throw Error('Cover unavailable');
            }
            finally {
                if (acquired)
                    this.active--;
                this.pending.delete(key);
            }
        });
        this.pending.set(key, task);
        return task;
    }
    private put(key: string, bytes: Buffer | undefined, expires: number) {
        const old = this.cache.get(key);
        this.bytes -= old?.bytes?.length ?? 0;
        this.cache.delete(key);
        this.cache.set(key, { bytes, expires });
        this.bytes += bytes?.length ?? 0;
        while (this.cache.size > 128 || this.bytes > 32 * 1024 * 1024) {
            const first = this.cache.keys().next().value!;
            this.bytes -= this.cache.get(first)?.bytes?.length ?? 0;
            this.cache.delete(first);
        }
    }
    async stop() {
        this.shutdown.abort();
        await Promise.allSettled(this.pending.values());
        this.cache.clear();
        this.references.clear();
    }
}
