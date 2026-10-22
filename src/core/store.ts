import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Settings, Job, Series, Chapter, JobState, FollowedSeries } from '../shared/types.js';
export class Store {
    readonly db: DatabaseSync;
    maintenanceActive = false;
    constructor(file: string) {
        this.db = new DatabaseSync(file);
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,source TEXT NOT NULL,chapter_id TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL, UNIQUE(source,chapter_id));`);
        const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
        if (version < 1) {
            // Keep a local SQLite-consistent backup before the first schema migration.
            if (file !== ':memory:' && !existsSync(`${file}.pre-v1.bak`))
                this.db.prepare('VACUUM INTO ?').run(`${file}.pre-v1.bak`);
            this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE jobs ADD COLUMN series_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE jobs ADD COLUMN title TEXT NOT NULL DEFAULT '';
        UPDATE jobs SET series_id=json_extract(data,'$.series.id'),title=json_extract(data,'$.series.title');
        CREATE INDEX jobs_state ON jobs(state);
        CREATE INDEX jobs_series_state ON jobs(source,series_id,state);
        CREATE TABLE follows(id TEXT PRIMARY KEY,source TEXT NOT NULL,series_id TEXT NOT NULL,next_check TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(source,series_id));
        CREATE INDEX follows_due ON follows(next_check);
        CREATE TABLE folders(root TEXT NOT NULL,identity TEXT NOT NULL,folder TEXT NOT NULL COLLATE NOCASE,PRIMARY KEY(root,identity),UNIQUE(root,folder));
        PRAGMA user_version=1;COMMIT;`);
        }
        this.db.exec('CREATE INDEX IF NOT EXISTS jobs_chapter_state ON jobs(chapter_id,state);CREATE INDEX IF NOT EXISTS jobs_state_title ON jobs(state,title,source);CREATE INDEX IF NOT EXISTS jobs_queue_source ON jobs(state,source);');
        if (version < 2) {
            // Derived statistics only: original job records and download paths are not rewritten.
            this.db.exec(`BEGIN IMMEDIATE;
              CREATE TABLE series_stats(source TEXT NOT NULL,series_id TEXT NOT NULL,completed INTEGER NOT NULL,remaining INTEGER NOT NULL,done INTEGER NOT NULL,total INTEGER NOT NULL,PRIMARY KEY(source,series_id));
              INSERT INTO series_stats SELECT source,series_id,SUM(state='completed'),SUM(state!='completed'),SUM(COALESCE(json_extract(data,'$.done'),0)),SUM(COALESCE(json_extract(data,'$.total'),0)) FROM jobs GROUP BY source,series_id;
              CREATE TRIGGER jobs_stats_insert AFTER INSERT ON jobs BEGIN
                INSERT INTO series_stats VALUES(NEW.source,NEW.series_id,NEW.state='completed',NEW.state!='completed',COALESCE(json_extract(NEW.data,'$.done'),0),COALESCE(json_extract(NEW.data,'$.total'),0))
                ON CONFLICT(source,series_id) DO UPDATE SET completed=completed+excluded.completed,remaining=remaining+excluded.remaining,done=done+excluded.done,total=total+excluded.total;
              END;
              CREATE TRIGGER jobs_stats_delete AFTER DELETE ON jobs BEGIN
                UPDATE series_stats SET completed=completed-(OLD.state='completed'),remaining=remaining-(OLD.state!='completed'),done=done-COALESCE(json_extract(OLD.data,'$.done'),0),total=total-COALESCE(json_extract(OLD.data,'$.total'),0) WHERE source=OLD.source AND series_id=OLD.series_id;
              END;
              CREATE TRIGGER jobs_stats_update AFTER UPDATE OF state,data ON jobs BEGIN
                UPDATE series_stats SET completed=completed+(NEW.state='completed')-(OLD.state='completed'),remaining=remaining+(NEW.state!='completed')-(OLD.state!='completed'),done=done+COALESCE(json_extract(NEW.data,'$.done'),0)-COALESCE(json_extract(OLD.data,'$.done'),0),total=total+COALESCE(json_extract(NEW.data,'$.total'),0)-COALESCE(json_extract(OLD.data,'$.total'),0) WHERE source=NEW.source AND series_id=NEW.series_id;
              END;
              PRAGMA user_version=2;COMMIT;`);
        }
        for (const j of this.states('running'))
            this.update(j.id, { state: 'queued', error: 'Recovered after interrupted shutdown.' });
    }
    get<T>(key: string): T | undefined {
        const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key);
        return row ? JSON.parse(String(row.value)) as T : undefined;
    }
    set(key: string, value: unknown) {
        this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
    }
    jobs(): Job[] {
        return this.db.prepare('SELECT data FROM jobs ORDER BY rowid DESC').all().map(r => JSON.parse(String(r.data)) as Job);
    }
    job(id: string): Job | undefined {
        const r = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);
        return r ? JSON.parse(String(r.data)) : undefined;
    }
    enqueue(series: Series, chapter: Chapter, settings: Settings): {
        job: Job;
        duplicate: boolean;
    } {
        if (this.maintenanceActive)
            throw Error('Local staging maintenance is running. Try again shortly.');
        if (series.source !== chapter.source || series.id !== chapter.seriesId)
            throw Error('Series and chapter identities do not match. Refresh the source.');
        series = {
            ...series, coverRef: undefined, title: series.title.slice(0, 300), description: series.description.slice(0, 4000)
        };
        const existing = this.db.prepare('SELECT data FROM jobs WHERE source=? AND chapter_id=?').get(chapter.source, chapter.id);
        if (existing)
            return { job: JSON.parse(String(existing.data)), duplicate: true };
        const now = new Date().toISOString();
        const job: Job = {
            id: randomUUID(), source: chapter.source, series, chapter, state: 'queued', done: 0, total: chapter.pages ?? 0, attempts: 0, error: null, output: null, created: now, updated: now, root: settings.downloadRoot, format: settings.format
        };
        this.db.prepare('INSERT INTO jobs(id,source,chapter_id,state,data,series_id,title) VALUES (?,?,?,?,?,?,?)').run(job.id, job.source, chapter.id, job.state, JSON.stringify(job), series.id, series.title);
        return { job, duplicate: false };
    }
    update(id: string, patch: Partial<Job>): Job {
        const old = this.job(id);
        if (!old)
            throw Error('Unknown job');
        const job = {
            ...old, ...patch, id: old.id, source: old.source, updated: new Date().toISOString()
        };
        this.db.prepare('UPDATE jobs SET state=?,data=? WHERE id=?').run(job.state, JSON.stringify(job), id);
        return job;
    }
    states(...states: JobState[]): Job[] {
        if (!states.length)
            return [];
        return this.db.prepare(`SELECT data FROM jobs WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY rowid DESC`).all(...states).map(r => JSON.parse(String(r.data)));
    }
    queued(limit = 16): Job[] {
        const candidates = this.db.prepare("SELECT DISTINCT source FROM jobs WHERE state='queued'").all().flatMap(s => this.db.prepare("SELECT rowid AS fifo,data FROM jobs WHERE state='queued' AND source=? ORDER BY rowid LIMIT ?").all(String(s.source), limit));
        return candidates.sort((a, b) => Number(a.fifo) - Number(b.fifo)).map(r => JSON.parse(String(r.data)));
    }
    transition(from: JobState[], to: JobState, source?: string, error: string | null = null) {
        if (this.maintenanceActive && to === 'queued')
            throw Error('Local maintenance is running. Try again shortly.');
        const args: (string | null)[] = [to, to, error, new Date().toISOString(), ...from];
        if (source)
            args.push(source);
        return Number(this.db.prepare(`UPDATE jobs SET state=?,data=json_set(data,'$.state',?,'$.error',?,'$.updated',?) WHERE state IN (${from.map(() => '?').join(',')})${source ? ' AND source=?' : ''}`).run(...args).changes);
    }
    chapterJobs(source: string, ids: string[]): Record<string, Job> {
        if (!ids.length)
            return {};
        return Object.fromEntries(this.db.prepare(`SELECT chapter_id,data FROM jobs WHERE source=? AND chapter_id IN (${ids.map(() => '?').join(',')})`).all(source, ...ids).map(r => [String(r.chapter_id), JSON.parse(String(r.data))]));
    }
    list(options: {
        history?: boolean;
        source?: string;
        state?: string;
        search?: string;
        offset?: number;
        limit?: number;
        series?: string;
    } = {}) {
        const where = [options.history ? "state='completed'" : "state!='completed'"], args: (string | number)[] = [];
        if (options.source) {
            where.push('source=?');
            args.push(options.source);
        }
        if (options.series) {
            where.push('series_id=?');
            args.push(options.series);
        }
        if (options.state) {
            if (options.history && options.state === 'unverified')
                where.push("json_extract(data,'$.verification.state') IS NULL");
            else if (options.history && ['verified', 'missing', 'damaged', 'inaccessible'].includes(options.state)) {
                where.push("json_extract(data,'$.verification.state')=?");
                args.push(options.state);
            }
            else {
                where.push('state=?');
                args.push(options.state);
            }
        }
        if (options.search) {
            where.push('title LIKE ? ESCAPE \'\\\'');
            args.push(`%${options.search.replace(/[\\%_]/g, '\\$&')}%`);
        }
        const clause = where.join(' AND '), total = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${clause}`).get(...args)!.n);
        const jobs = this.db.prepare(`SELECT data FROM jobs WHERE ${clause} ORDER BY rowid ${options.history ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`).all(...args, Math.min(options.limit ?? 100, 100), options.offset ?? 0).map(r => JSON.parse(String(r.data)) as Job);
        return {
            jobs, total, offset: options.offset ?? 0, limit: Math.min(options.limit ?? 100, 100)
        };
    }
    counts() {
        return Object.fromEntries(this.db.prepare('SELECT state,COUNT(*) AS n FROM jobs GROUP BY state').all().map(r => [String(r.state), Number(r.n)]));
    }
    groupSummaries(jobs: Job[]) {
        const groups: Record<string, {
            completed: number;
            remaining: number;
            done: number;
            total: number;
            active?: string;
        }> = {};
        for (const job of jobs) {
            const key = `${job.source}:${job.series.id}`;
            if (groups[key])
                continue;
            const row = this.db.prepare('SELECT completed,remaining,done,total FROM series_stats WHERE source=? AND series_id=?').get(job.source, job.series.id)!;
            const running = this.db.prepare("SELECT json_extract(data,'$.chapter.number') AS chapter FROM jobs WHERE source=? AND series_id=? AND state='running' LIMIT 1").get(job.source, job.series.id);
            groups[key] = {
                completed: Number(row.completed), remaining: Number(row.remaining), done: Number(row.done), total: Number(row.total), active: running ? String(running.chapter) : undefined
            };
        }
        return groups;
    }
    seriesJobs(source: string, id: string, includeCompleted = true): Job[] {
        return this.db.prepare(`SELECT data FROM jobs WHERE source=? AND series_id=? ${includeCompleted ? '' : "AND state!='completed'"} ORDER BY rowid`).all(source, id).map(r => JSON.parse(String(r.data)));
    }
    legacyOutput(source: string, id: string, root: string): Job | undefined {
        const row = this.db.prepare("SELECT data FROM jobs WHERE source=? AND series_id=? AND json_extract(data,'$.root')=? AND json_extract(data,'$.output') IS NOT NULL LIMIT 1").get(source, id, root);
        return row ? JSON.parse(String(row.data)) : undefined;
    }
    folderConflict(dir: string, source: string, id: string) {
        const prefix = (dir + path.sep).replace(/[\\%_]/g, match => '\\' + match) + '%';
        for (const row of this.db.prepare("SELECT source,series_id,json_extract(data,'$.output') AS output FROM jobs WHERE json_extract(data,'$.output') LIKE ? ESCAPE '\\' AND (source!=? OR series_id!=?)").iterate(prefix, source, id))
            if (path.dirname(String(row.output)).toLowerCase() === dir.toLowerCase())
                return true;
        return false;
    }
    logicalChapters(source: string, id: string) {
        return this.db.prepare("SELECT DISTINCT COALESCE(json_extract(data,'$.chapter.volume'),'')||'|'||json_extract(data,'$.chapter.number')||'|'||json_extract(data,'$.chapter.language') AS key FROM jobs WHERE source=? AND series_id=?").all(source, id).map(r => String(r.key));
    }
    holds() {
        return this.db.prepare("SELECT key,value FROM kv WHERE key LIKE 'source-action:%' AND value!='null'").all().map(r => ({
            source: String(r.key).slice(14), reason: JSON.parse(String(r.value)) as string, count: Number(this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE source=? AND state='action_required'").get(String(r.key).slice(14))!.n)
        }));
    }
    folder(root: string, identity: string) {
        return this.db.prepare('SELECT folder FROM folders WHERE root=? AND identity=?').get(root, identity)?.folder as string | undefined;
    }
    claimFolder(root: string, identity: string, folder: string) {
        this.db.prepare('INSERT INTO folders VALUES(?,?,?) ON CONFLICT(root,identity) DO NOTHING').run(root, identity, folder);
        return this.folder(root, identity)!;
    }
    follows(): FollowedSeries[] {
        return this.db.prepare('SELECT data FROM follows ORDER BY next_check').all().map(r => JSON.parse(String(r.data)));
    }
    follow(id: string): FollowedSeries | undefined {
        const row = this.db.prepare('SELECT data FROM follows WHERE id=?').get(id);
        return row ? JSON.parse(String(row.data)) : undefined;
    }
    saveFollow(f: FollowedSeries) {
        this.db.prepare('INSERT INTO follows VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET next_check=excluded.next_check,data=excluded.data').run(f.id, f.series.source, f.series.id, f.nextCheck, JSON.stringify(f));
        return f;
    }
    unfollow(id: string) {
        this.db.prepare('DELETE FROM follows WHERE id=?').run(id);
    }
    clearFailed() {
        return Number(this.db.prepare("DELETE FROM jobs WHERE state='failed'").run().changes);
    }
    remove(id: string) {
        return Number(this.db.prepare('DELETE FROM jobs WHERE id=?').run(id).changes);
    }
    close() {
        this.db.close();
    }
}
