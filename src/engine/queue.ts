import { setTimeout as delay } from 'node:timers/promises';
import type { Store } from '../core/store.js';
import type { Registry } from '../sources/registry.js';
import { SafeHttp, sharedHttp } from '../sources/http.js';
import { SourceError, type Job, type Settings } from '../shared/types.js';
import { ChapterOutput } from './files.js';

export class PagePool {
  active = 0;
  constructor(private limit: () => number) {}
  async run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    while (this.active >= this.limit()) await delay(25,undefined,{ signal });
    signal.throwIfAborted(); this.active++;
    try { return await fn(); } finally { this.active--; }
  }
}
export class Queue {
  private active = new Map<string,{ controller: AbortController; promise: Promise<void> }>();
  private timer?: ReturnType<typeof setInterval>; private stopping = false;
  readonly pool: PagePool;
  constructor(readonly store: Store, private registry: Registry, private settings: () => Settings, private http: Pick<SafeHttp,'get'> = sharedHttp, private worker?: (job: Job, signal: AbortSignal) => Promise<string>) { this.pool = new PagePool(() => this.settings().pageRequests); }
  start() { this.timer = setInterval(() => this.tick(),150); this.tick(); }
  tick() {
    if (this.stopping || this.store.get<boolean>('queue-paused')) return;
    const s = this.settings();
    for (const j of this.store.states('queued').reverse()) {
      const blocked=this.store.get<string>(`source-action:${j.source}`);
      if(blocked) { this.store.update(j.id,{state:'action_required',error:blocked}); continue; }
      if (this.active.size >= s.globalChapters) break;
      if (this.active.has(j.id)) continue;
      const perSource = [...this.active.keys()].filter(id => this.store.job(id)?.source === j.source).length;
      if (perSource >= (s.sourceChapters[j.source] ?? 1)) continue;
      const controller = new AbortController();
      this.store.update(j.id, { state: 'running', error: null, attempts: j.attempts + 1 });
      const promise = this.execute(j,controller.signal).finally(() => { this.active.delete(j.id); });
      this.active.set(j.id,{ controller,promise });
    }
  }
  private async execute(job: Job, signal: AbortSignal) {
    try {
      const output = await (this.worker ? this.worker(job,signal) : this.download(job,signal));
      // Commit completion only if the job has not been paused/cancelled during finalization.
      if (this.store.job(job.id)?.state === 'running') this.store.update(job.id,{ state: 'completed', done: this.store.job(job.id)!.total, output, error: null });
    } catch (e) {
      if (signal.aborted) return;
      const errno = (e as NodeJS.ErrnoException).code;
      const message = errno === 'ENOSPC' ? 'Disk full. Free space and retry.' : ['EACCES','EPERM','ENOENT'].includes(errno ?? '') ? 'Download folder is inaccessible. Check folder permissions and retry.' : e instanceof SourceError ? e.message : e instanceof Error && !e.message.includes(job.root) ? e.message : 'Download failed. Check output folder and retry.';
      if(e instanceof SourceError && e.kind==='action_required') {
        this.store.set(`source-action:${job.source}`,message);
        for(const affected of this.store.states('queued','running').filter(j=>j.source===job.source)) { this.store.update(affected.id,{state:'action_required',error:message}); if(affected.id!==job.id)this.active.get(affected.id)?.controller.abort(); }
      } else this.store.update(job.id,{state:'failed',error:message});
    }
  }
  private async download(job: Job, signal: AbortSignal): Promise<string> {
    const adapter = this.registry.get(job.source); let resolved = await adapter.resolve(job.chapter.id,signal);
    const output = new ChapterOutput(job); await output.open(resolved.revision,resolved.urls.length);
    this.store.update(job.id,{ total: resolved.urls.length, done: 0 });
    let refreshes = 0;
    for (let i = 0; i < resolved.urls.length; i++) {
      signal.throwIfAborted();
      if (!await output.has(i)) {
        try {
          const bytes = await this.pool.run(() => this.http.get(resolved.urls[i],adapter.manifest.imageHosts,signal,true),signal);
          signal.throwIfAborted(); await output.page(i,bytes);
        } catch (e) {
          if (e instanceof SourceError && e.kind === 'expired' && refreshes++ < 2) {
            const next = await adapter.resolve(job.chapter.id,signal);
            if (next.revision !== resolved.revision || next.urls.length !== resolved.urls.length) throw new SourceError('Chapter pages changed during download. Retry to safely restart.');
            resolved = next; i--; continue;
          }
          throw e;
        }
      }
      this.store.update(job.id,{ done: i + 1 });
    }
    signal.throwIfAborted(); return output.finish();
  }
  control(id: string, action: 'pause'|'resume'|'cancel'|'retry') {
    const j = this.store.job(id); if (!j) throw Error('Unknown job');
    if (j.state === 'completed') throw Error('Completed jobs cannot be changed.');
    if (action === 'pause') { if (!['running','queued'].includes(j.state)) throw Error('Only active jobs can be paused.'); this.store.update(id,{ state: 'paused' }); this.active.get(id)?.controller.abort(); }
    if (action === 'cancel') { this.store.update(id,{ state: 'cancelled' }); this.active.get(id)?.controller.abort(); }
    if (action === 'resume' || action === 'retry') { if (this.active.has(id)) throw Error('Job is still stopping. Try again shortly.'); if (!['paused','failed','cancelled','action_required'].includes(j.state)) throw Error('Job cannot be retried in its current state.'); if(j.state==='action_required')this.store.set(`source-action:${j.source}`,null); this.store.update(id,{ state: 'queued', error: null }); }
    this.tick();
  }
  pauseAll() { this.store.set('queue-paused',true); for (const j of this.store.states('running','queued')) this.control(j.id,'pause'); }
  resumeAll() { this.store.set('queue-paused',false); for (const j of this.store.states('paused')) this.store.update(j.id,{ state: 'queued' }); this.tick(); }
  async stop() { this.stopping = true; if (this.timer) clearInterval(this.timer); for (const [id,a] of this.active) { if (this.store.job(id)?.state === 'running') this.store.update(id,{ state: 'queued' }); a.controller.abort(); } await Promise.all([...this.active.values()].map(a => a.promise)); }
}
