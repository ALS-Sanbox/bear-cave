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
        this.pool = new PagePool(() => this.settings().pageRequests);
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
            if (perSource >= (s.sourceChapters[j.source] ?? 1))
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
            if (!this.worker)
                await syncSeries(this.store, this.registry.get(job.source), job.series, job.root, undefined, undefined, {coverFormat:this.settings().coverFormat}).catch(e => console.warn('Series metadata:', (e as Error).message));
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
        await syncSeries(this.store, adapter, job.series, job.root, signal, undefined, {coverFormat:this.settings().coverFormat}).catch(e => console.warn('Series metadata:', (e as Error).message));
        let resolved = await adapter.resolve(job.chapter.id, signal);
        const output = new ChapterOutput(job, this.store);
        await output.open(resolved.revision, resolved.urls.length, resolved.identities);
        const recovered = await output.recoverFinal(signal);
        if (recovered) {
            this.store.update(job.id, { total: recovered.count, done: recovered.count });
            return recovered.file;
        }
        this.store.update(job.id, { total: resolved.urls.length, done: 0 });
        let refreshes = 0;
        for (let i = 0; i < resolved.urls.length; i++) {
            signal.throwIfAborted();
            if (!await output.has(i)) {
                try {
                    const bytes = await this.pool.run(() => adapter.readPage ? adapter.readPage(resolved.urls[i], signal) : this.http.get(resolved.urls[i], adapter.manifest.imageHosts, signal, true), signal);
                    signal.throwIfAborted();
                    await output.page(i, Buffer.from(bytes));
                }
                catch (e) {
                    if (e instanceof SourceError && e.kind === 'expired' && refreshes++ < 2) {
                        const next = await adapter.resolve(job.chapter.id, signal);
                        if (next.revision !== resolved.revision || next.urls.length !== resolved.urls.length || JSON.stringify(next.identities) !== JSON.stringify(resolved.identities))
                            throw new SourceError('Chapter pages changed during download. Retry to safely restart.');
                        resolved = next;
                        i--;
                        continue;
                    }
                    throw e;
                }
            }
            this.store.update(job.id, { done: i + 1 });
        }
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
        if (this.timer)
            clearInterval(this.timer);
        for (const [id, a] of this.active) {
            if (this.store.job(id)?.state === 'running')
                this.store.update(id, { state: 'queued' });
            a.controller.abort();
        }
        await Promise.all([...this.active.values()].map(a => a.promise));
        await this.maintenanceDone?.catch(() => {
        });
    }
}
