import { setTimeout as delay } from 'node:timers/promises';
import type { Store } from '../core/store.js';
import type { Registry } from '../sources/registry.js';
import { SafeHttp, sharedHttp } from '../sources/http.js';
import { SourceError, type Job, type Settings } from '../shared/types.js';
import { rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { checkPath } from './folders.js';
import { verifyOutput } from './verification.js';
import { syncSeries } from './library.js';
import { ChapterOutput } from './files.js';
export class PagePool {
    active = 0;
    constructor(private limit: () => number) {
    }
    async run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
        while (this.active >= this.limit())
            await delay(25, undefined, { signal });
        signal.throwIfAborted();
        this.active++;
        try {
            return await fn();
        }
        finally {
            this.active--;
        }
    }
}
export class Queue {
    onPause?: () => void;
    private active = new Map<string, {
        controller: AbortController;
        promise: Promise<void>;
    }>();
    private timer?: ReturnType<typeof setInterval>;
    private stopping = false;
    private maintaining = false;
    private maintenanceDone?: Promise<unknown>;
    readonly pool: PagePool;
    constructor(readonly store: Store, private registry: Registry, private settings: () => Settings, private http: Pick<SafeHttp, 'get'> = sharedHttp, private worker?: (job: Job, signal: AbortSignal) => Promise<string>) {
        this.pool = new PagePool(() => this.settings().globalPageRequests ?? this.settings().pageRequests);
    }
    private sourcePools = new Map<string, PagePool>();
    private bufferedPool = new PagePool(() => 4);
    private metadataAbort = new AbortController();
    private metadataFinals = new Set<Promise<void>>();
    private metadataFresh = new Map<string, number>();
    private metadata = new Map<string, Promise<void>>();
    private statsStarted = 0;
    private requests = 0;
    private async imageRequest<T>(work: () => Promise<T>) {
        if (!this.statsStarted)
            this.statsStarted = Date.now();
        this.requests++;
        try {
            return await work();
        }
        finally {
            this.requests--;
        }
    }
    private samples: {
        time: number;
        bytes: number;
    }[] = [];
    private transferred = 0;
    private completedImages = 0;
    private failedImages = 0;
    private retries = 0;
    metrics() {
        const now = Date.now();
        this.samples = this.samples.filter(s => s.time > now - 5000);
        const running = this.store.states('running');
        return {
            currentBytesPerSecond: this.samples.reduce((n, s) => n + s.bytes, 0) / 5,
            averageBytesPerSecond: this.transferred / Math.max(1, (now - (this.statsStarted || now)) / 1000),
            bytes: this.transferred, completedImages: this.completedImages, failedImages: this.failedImages, retries: this.retries + sharedHttp.retryCount + this.registry.manifests().filter(m => m.status === 'operational').reduce((n, m) => n + (this.registry.get(m.id).requestRetries ?? 0), 0),
            activeChapters: this.active.size, activeImages: this.requests,
            done: running.reduce((n, j) => n + j.done, 0), total: running.reduce((n, j) => n + j.total, 0)
        };
    }
    private syncMetadata(job: Job) {
        const key = `${job.root}:${job.source}:${job.series.id}`;
        const prior = this.metadata.get(key);
        if (prior)
            return prior;
        if ((this.metadataFresh.get(key) ?? 0) > Date.now())
            return Promise.resolve();
        const work = syncSeries(this.store, this.registry.get(job.source), job.series, job.root, this.metadataAbort.signal, undefined, { coverFormat: this.settings().coverFormat })
            .catch(e => console.warn('Series metadata:', (e as Error).message)).finally(() => {
            if (this.metadata.get(key) === work)
                this.metadata.delete(key);
        });
        if (this.metadataFresh.size >= 500)
            this.metadataFresh.delete(this.metadataFresh.keys().next().value!);
        this.metadataFresh.set(key, Date.now() + 300000);
        this.metadata.set(key, work);
        return work;
    }
    start() {
        this.timer = setInterval(() => this.tick(), 150);
        this.tick();
    }
    tick() {
        if (this.stopping || this.maintaining || this.store.get<boolean>('queue-paused') || this.active.size >= this.settings().globalChapters)
            return;
        const s = this.settings();
        for (const j of this.store.queued()) {
            const blocked = this.store.get<string>(`source-action:${j.source}`);
            if (blocked) {
                this.store.transition(['queued'], 'action_required', j.source, blocked);
                continue;
            }
            if (this.active.size >= s.globalChapters)
                break;
            if (this.active.has(j.id))
                continue;
            const perSource = [...this.active.keys()].filter(id => this.store.job(id)?.source === j.source).length;
            if (perSource >= Math.min(s.sourceChapters[j.source] ?? 1, this.registry.manifests().find(m => m.id === j.source)?.limits?.chapters ?? 4))
                continue;
            const controller = new AbortController();
            this.store.update(j.id, {
                state: 'running', error: null, attempts: j.attempts + 1
            });
            const promise = this.execute(j, controller.signal).finally(() => {
                this.active.delete(j.id);
            });
            this.active.set(j.id, { controller, promise });
        }
    }
    private async execute(job: Job, signal: AbortSignal) {
        try {
            let output = await (this.worker ? this.worker(job, signal) : this.download(job, signal));
            if (job.replacement) {
                const checked = await verifyOutput({ ...job, output }, signal);
                if (checked.state !== 'verified')
                    throw Error('Replacement failed verification. Original chapter preserved.');
                await checkPath(job.root, job.replacement.original);
                const backup = job.replacement.original + `.backup-${randomUUID().slice(0, 8)}`;
                this.store.update(job.id, { previousOutputs: [...(this.store.job(job.id)?.previousOutputs ?? []), backup] });
                let moved = false;
                try {
                    try {
                        await rename(job.replacement.original, backup);
                        moved = true;
                    }
                    catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                            throw e;
                    }
                    await rename(output, job.replacement.original);
                }
                catch (e) {
                    if (moved)
                        await rename(backup, job.replacement.original);
                    throw e;
                }
                output = job.replacement.original;
                this.store.update(job.id, {
                    replacement: undefined, copySuffix: job.replacement.suffix,
                    previousOutputs: [...new Set([...(this.store.job(job.id)?.previousOutputs ?? []).filter(p => p !== output && p !== backup), ...(moved ? [backup] : [])])]
                });
            }
            // Commit completion only if the job has not been paused/cancelled during finalization.
            if (this.store.job(job.id)?.state === 'running')
                this.store.update(job.id, {
                    completedAt: new Date().toISOString(), verification: { state: 'verified', checked: new Date().toISOString() }, state: 'completed', done: this.store.job(job.id)!.total, output, error: null
                });
            if (!this.worker) {
                // Slow catalog/cover work must not hold a chapter worker slot.
                // Drain the final count update at shutdown, after the shared online pass.
                const metadata = this.syncMetadata(job).then(() => syncSeries(this.store, this.registry.get(job.source), job.series, job.root, undefined, undefined, { offline: true, coverFormat: this.settings().coverFormat }))
                    .then(() => {
                }, e => console.warn('Series metadata:', (e as Error).message));
                this.metadataFinals.add(metadata);
                void metadata.finally(() => this.metadataFinals.delete(metadata));
            }
        }
        catch (e) {
            if (signal.aborted)
                return;
            const errno = (e as NodeJS.ErrnoException).code;
            const message = errno === 'ENOSPC' ? 'Disk full. Free space and retry.' : ['EACCES', 'EPERM', 'ENOENT'].includes(errno ?? '') ? 'Download folder is inaccessible. Check folder permissions and retry.' : e instanceof SourceError ? e.message : e instanceof Error && !e.message.includes(job.root) ? e.message : 'Download failed. Check output folder and retry.';
            if (e instanceof SourceError && e.kind === 'action_required') {
                this.store.set(`source-action:${job.source}`, message);
                this.store.transition(['queued', 'running'], 'action_required', job.source, message);
                for (const [id, active] of this.active)
                    if (id !== job.id && this.store.job(id)?.source === job.source)
                        active.controller.abort();
            }
            else
                this.store.update(job.id, { state: 'failed', error: message });
        }
    }
    private async download(job: Job, signal: AbortSignal): Promise<string> {
        const adapter = this.registry.get(job.source);
        adapter.configureDownloads?.(this.settings());
        void this.syncMetadata(job);
        let resolved = await adapter.resolve(job.chapter.id, signal);
        const output = new ChapterOutput(job, this.store);
        await output.open(resolved.revision, resolved.urls.length, resolved.identities);
        const recovered = await output.recoverFinal(signal);
        if (recovered) {
            this.store.update(job.id, { total: recovered.count, done: recovered.count });
            return recovered.file;
        }
        this.store.update(job.id, { total: resolved.urls.length, done: 0 });
        let refreshes = 0, cursor = 0, done = 0;
        let refresh: Promise<void> | undefined, failure: unknown;
        const settings = this.settings();
        let sourcePool = this.sourcePools.get(job.source);
        if (!sourcePool) {
            sourcePool = new PagePool(() => Math.min(this.settings().sourcePageRequests?.[job.source] ?? adapter.manifest.recommended.pageRequests, adapter.manifest.limits?.pageRequests ?? 20));
            this.sourcePools.set(job.source, sourcePool);
        }
        const refreshPages = async (stale: typeof resolved) => {
            if (resolved !== stale)
                return;
            if (!refresh) {
                if (refreshes++ >= 2)
                    throw new SourceError('Page URLs expired repeatedly. Retry this chapter.', 'expired');
                refresh = (async () => {
                    const next = await adapter.resolve(job.chapter.id, signal);
                    if (next.revision !== resolved.revision || next.urls.length !== resolved.urls.length || JSON.stringify(next.identities) !== JSON.stringify(resolved.identities))
                        throw new SourceError('Chapter pages changed during download. Retry to safely restart.');
                    resolved = next;
                })().finally(() => {
                    refresh = undefined;
                });
            }
            await refresh;
        };
        const worker = async () => {
            while (!failure) {
                signal.throwIfAborted();
                const i = cursor++;
                if (i >= resolved.urls.length)
                    return;
                try {
                    if (!await output.has(i)) {
                        // Hold a global slot through staging so concurrent buffers and disk writes stay bounded.
                        await sourcePool!.run(() => this.pool.run(async () => {
                            for (;;) {
                                signal.throwIfAborted();
                                const current = resolved;
                                try {
                                    let size: number;
                                    if (adapter.downloadPage || !adapter.readPage && this.http instanceof SafeHttp) {
                                        size = await output.stream(i, file => this.imageRequest(() => adapter.downloadPage ? adapter.downloadPage(current.urls[i], file, signal) : (this.http as SafeHttp).getToFile(current.urls[i], adapter.manifest.imageHosts, file, signal)), signal);
                                    }
                                    else {
                                        size = await this.bufferedPool.run(async () => {
                                            const bytes = await this.imageRequest(() => adapter.readPage ? adapter.readPage(current.urls[i], signal) : this.http.get(current.urls[i], adapter.manifest.imageHosts, signal, true));
                                            signal.throwIfAborted();
                                            await output.page(i, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
                                            return bytes.length;
                                        }, signal);
                                    }
                                    this.transferred += size;
                                    this.samples.push({ time: Date.now(), bytes: size });
                                    if (this.samples.length > 2000)
                                        this.samples.splice(0, 1000);
                                    this.completedImages++;
                                    break;
                                }
                                catch (e) {
                                    if (e instanceof SourceError && e.kind === 'expired') {
                                        this.retries++;
                                        await refreshPages(current);
                                        continue;
                                    }
                                    throw e;
                                }
                            }
                        }, signal), signal);
                    }
                    this.store.update(job.id, { done: ++done });
                }
                catch (e) {
                    if (!signal.aborted)
                        this.failedImages++;
                    failure ??= e;
                }
            }
        };
        const workers = Array.from({ length: Math.min(settings.pageRequests, resolved.urls.length, 16) }, () => worker());
        const settled = await Promise.allSettled(workers);
        if (failure)
            throw failure;
        const rejected = settled.find(r => r.status === 'rejected');
        if (rejected?.status === 'rejected')
            throw rejected.reason;
        signal.throwIfAborted();
        return output.finish(signal);
    }
    control(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry'): void | Promise<void> {
        if (this.maintaining && ['resume', 'retry'].includes(action))
            throw Error('Local staging maintenance is running. Try again shortly.');
        const j = this.store.job(id);
        if (!j)
            throw Error('Unknown job');
        if (j.state === 'completed')
            throw Error('Completed jobs cannot be changed.');
        if (action === 'pause') {
            if (!['running', 'queued'].includes(j.state))
                throw Error('Only active jobs can be paused.');
            this.store.update(id, { state: 'paused' });
            this.active.get(id)?.controller.abort();
        }
        if (action === 'cancel') {
            this.store.update(id, { state: 'cancelled' });
            this.active.get(id)?.controller.abort();
        }
        if (action === 'resume' || action === 'retry') {
            if (!['paused', 'failed', 'cancelled', 'action_required'].includes(j.state))
                throw Error('Job cannot be retried in its current state.');
            const active = this.active.get(id);
            if (active)
                return active.promise.then(() => this.control(id, action));
            if (j.state === 'action_required')
                this.store.set(`source-action:${j.source}`, null);
            this.store.set('queue-paused', false);
            this.store.update(id, { state: 'queued', error: null });
        }
        this.tick();
    }
    async clearFailed() {
        await Promise.all(this.store.states('failed').flatMap(j => this.active.get(j.id)?.promise ?? []));
        return this.store.clearFailed();
    }
    async maintenance<T>(work: () => Promise<T>) {
        if (this.maintaining || this.stopping)
            throw Error('Maintenance is already running.');
        this.maintaining = true;
        this.store.maintenanceActive = true;
        const pending = Promise.resolve().then(work);
        this.maintenanceDone = pending;
        try {
            return await pending;
        }
        finally {
            this.store.maintenanceActive = false;
            this.maintaining = false;
            this.maintenanceDone = undefined;
            this.tick();
        }
    }
    async retrySource(source: string) {
        if (this.maintaining)
            throw Error('Local maintenance is running. Try again shortly.');
        await Promise.all([...this.active].filter(([id]) => {
            const j = this.store.job(id);
            return j?.source === source && j.state === 'action_required';
        }).map(([, a]) => a.promise));
        this.store.set(`source-action:${source}`, null);
        const changed = this.store.transition(['action_required'], 'queued', source);
        this.tick();
        return changed;
    }
    async group(source: string, series: string, action: 'pause' | 'resume' | 'retry' | 'remove') {
        const jobs = this.store.seriesJobs(source, series, false);
        if (action === 'remove')
            return this.remove(jobs.map(j => j.id));
        let changed = 0;
        for (const j of jobs) {
            if (action === 'pause' && !['queued', 'running'].includes(j.state) || action === 'resume' && j.state !== 'paused' || action === 'retry' && !['failed', 'action_required', 'cancelled'].includes(j.state))
                continue;
            await this.control(j.id, action);
            changed++;
        }
        return changed;
    }
    async remove(ids: string[]) {
        const jobs = ids.map(id => this.store.job(id)).filter((j): j is Job => Boolean(j) && j!.state !== 'completed');
        for (const j of jobs) {
            this.store.update(j.id, { state: 'cancelled' });
            this.active.get(j.id)?.controller.abort();
        }
        await Promise.all(jobs.flatMap(j => this.active.get(j.id)?.promise ?? []));
        return jobs.reduce((count, j) => count + this.store.remove(j.id), 0);
    }
    pauseAll() {
        this.store.set('queue-paused', true);
        this.onPause?.();
        this.store.transition(['running', 'queued'], 'paused');
        for (const active of this.active.values())
            active.controller.abort();
    }
    resumeAll() {
        if (this.maintaining)
            throw Error('Local maintenance is running. Try again shortly.');
        this.store.set('queue-paused', false);
        this.store.transition(['paused'], 'queued');
        this.tick();
    }
    async stop() {
        this.stopping = true;
        // Give completed covers and counts a short grace period, then cancel slow
        // source metadata so a browser-protected catalog cannot stall shutdown.
        const metadataDeadline = setTimeout(() => this.metadataAbort.abort(), 5000);
        metadataDeadline.unref();
        if (this.timer)
            clearInterval(this.timer);
        for (const [id, a] of this.active) {
            if (this.store.job(id)?.state === 'running')
                this.store.update(id, { state: 'queued' });
            a.controller.abort();
        }
        await Promise.all([...this.active.values()].map(a => a.promise));
        await Promise.allSettled([...this.metadata.values(), ...this.metadataFinals]);
        clearTimeout(metadataDeadline);
        await this.maintenanceDone?.catch(() => {
        });
    }
}
