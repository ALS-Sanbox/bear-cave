import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Settings, Job, Series, Chapter, JobState } from '../shared/types.js';
export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,source TEXT NOT NULL,chapter_id TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL, UNIQUE(source,chapter_id));`);
    // Running work becomes queued; explicit pauses and global pause survive restart.
    for (const j of this.jobs()) if (j.state === 'running') this.update(j.id, { state: 'queued', error: 'Recovered after interrupted shutdown.' });
  }
  get<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(String(row.value)) as T : undefined; }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  jobs(): Job[] { return this.db.prepare('SELECT data FROM jobs ORDER BY rowid DESC').all().map(r => JSON.parse(String(r.data)) as Job); }
  job(id: string): Job | undefined { const r = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id); return r ? JSON.parse(String(r.data)) : undefined; }
  enqueue(series: Series, chapter: Chapter, settings: Settings): { job: Job; duplicate: boolean } {
    const existing = this.db.prepare('SELECT data FROM jobs WHERE source=? AND chapter_id=?').get(chapter.source, chapter.id);
    if (existing) return { job: JSON.parse(String(existing.data)), duplicate: true };
    const now = new Date().toISOString();
    const job: Job = { id: randomUUID(), source: chapter.source, series, chapter, state: 'queued', done: 0, total: chapter.pages ?? 0, attempts: 0, error: null, output: null, created: now, updated: now, root: settings.downloadRoot, format: settings.format };
    this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?)').run(job.id, job.source, chapter.id, job.state, JSON.stringify(job)); return { job, duplicate: false };
  }
  update(id: string, patch: Partial<Job>): Job {
    const old = this.job(id); if (!old) throw Error('Unknown job');
    const job = { ...old, ...patch, id: old.id, source: old.source, updated: new Date().toISOString() };
    this.db.prepare('UPDATE jobs SET state=?,data=? WHERE id=?').run(job.state, JSON.stringify(job), id); return job;
  }
  states(...states: JobState[]) { return this.jobs().filter(j => states.includes(j.state)); }
  clearFailed() { return Number(this.db.prepare("DELETE FROM jobs WHERE state='failed'").run().changes); }
  remove(id:string) { return Number(this.db.prepare('DELETE FROM jobs WHERE id=?').run(id).changes); }
  close() { this.db.close(); }
}
