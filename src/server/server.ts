import { reconcile, libraryStatus, syncSeries } from '../engine/library.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../core/store.js';
import type { Queue } from '../engine/queue.js';
import type { Registry } from '../sources/registry.js';
import type { Settings, Chapter, Series } from '../shared/types.js';
import { SourceError } from '../shared/types.js';
import { performancePreferences, updatePerformance } from '../core/settings.js';
import { Auth } from './auth.js';
import { saveCover } from '../engine/files.js';
import { findSeriesDirectory } from '../engine/folders.js';
import { existingSeriesFolder, reconcileExternal } from '../engine/external-library.js';
import { CoverCache, readLibraryCover } from './covers.js';
import { FollowScheduler } from '../engine/follows.js';
import { verifyOutput, redownload } from '../engine/verification.js';
import { matching, selectionSummary, enqueueSelection } from '../engine/selection.js';
const publicSeries = ({ coverRef, ...s }: Series) => ({
    ...s, title: s.title.slice(0, 300), description: s.description.slice(0, 4000)
});
const publicJob = ({ root, seriesFolder, previousOutputs, replacement, output, ...j }: import('../shared/types.js').Job) => ({
    ...j, error: j.error?.slice(0, 1200) ?? null, chapter: {
        ...j.chapter, title: j.chapter.title.slice(0, 500), groups: j.chapter.groups.slice(0, 30).map(g => ({ ...g, name: g.name.slice(0, 200) }))
    }, series: { ...publicSeries(j.series), description: "" }, output: output ? path.basename(output) : null
});
class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
interface Preview {
    session: string;
    expires: number;
    series: Series;
    chapters: Chapter[];
    multipleTranslations: number;
    format?: 'folders' | 'cbz';
}
const opaqueId = z.string().min(1).max(1200).regex(/^[a-zA-Z0-9_-]+$/);
export function createDashboard(store: Store, queue: Queue, registry: Registry, settings: () => Settings, uiDir: string, saveSettings?: (next: Settings) => void) {
    const auth = new Auth(store), previews = new Map<string, Preview>();
    let busyPreviews = 0;
    let scanningLibrary = false;
    const scans = new Map<string, {
        expires: number;
        result: unknown;
        folder: string;
        modified: number;
    }>();
    let reads: number[] = [];
    const covers = new CoverCache(registry, (source, id) => readLibraryCover(store, settings().downloadRoot, source, id)), follows = new FollowScheduler(store, registry, queue, settings);
    const seriesHints = new Map<string, Series>();
    const remember = (series: Series) => {
        covers.remember(series);
        const key = `${series.source}:${series.id}`;
        seriesHints.delete(key);
        seriesHints.set(key, {
            id: series.id, source: series.source, title: series.title, description: ''
        });
        if (seriesHints.size > 1000)
            seriesHints.delete(seriesHints.keys().next().value!);
    };
    const verifyingJobs = new Set<string>();
    let verifying = 0, closing = false;
    const requests = new Set<AbortController>(), tasks = new Set<Promise<void>>();
    const previewFor = (session: string, series: Series, chapters: Chapter[], format?: 'cbz' | 'folders') => {
        for (const [id, p] of previews)
            if (p.expires < Date.now() || p.session === session)
                previews.delete(id);
        const summary = selectionSummary(store, series.source, chapters, settings().downloadRoot), token = randomBytes(24).toString('hex');
        previews.set(token, {
            session, series, chapters, format, multipleTranslations: summary.multipleTranslations, expires: Date.now() + 300000
        });
        return {
            token, ...summary, expiresInSeconds: 300
        };
    };
    const send = (res: ServerResponse, status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
    };
    async function body(req: IncomingMessage): Promise<unknown> {
        if (!req.headers['content-type']?.startsWith('application/json'))
            throw new ApiError(415, 'JSON request required.');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > 64 * 1024)
                throw new ApiError(413, 'Request too large.');
            chunks.push(chunk);
        }
        try {
            return JSON.parse(Buffer.concat(chunks).toString());
        }
        catch {
            throw new ApiError(400, 'Invalid JSON.');
        }
    }
    const server = createServer(async (req, res) => {
        let complete!: () => void;
        const completion = new Promise<void>(resolve => {
            complete = resolve;
        });
        tasks.add(completion);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        res.setHeader('Cache-Control', 'no-store');
        const abort = new AbortController();
        requests.add(abort);
        res.on('close', () => {
            requests.delete(abort);
            if (!res.writableEnded)
                abort.abort();
        });
        try {
            if (closing)
                throw new ApiError(503, 'Bear Cave is stopping.');
            const s = settings();
            registry.configure(s);
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : s.port;
            const locals = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
            const host = req.headers.host ?? '';
            const local = locals.includes(`http://${host}`);
            const remote = Boolean(s.publicUrl && s.trustTunnel && host === new URL(s.publicUrl).host && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-proto'] === 'https');
            if (!local && !remote)
                throw new ApiError(403, 'Unrecognized dashboard host or proxy.');
            const expectedOrigin = remote ? s.publicUrl : `http://${host}`;
            if (req.headers.origin && req.headers.origin !== expectedOrigin)
                throw new ApiError(403, 'Origin is not allowed.');
            if (remote)
                res.setHeader('Strict-Transport-Security', 'max-age=31536000');
            const url = new URL(req.url ?? '/', expectedOrigin), method = req.method ?? 'GET';
            const changing = !['GET', 'HEAD'].includes(method);
            if (changing && req.headers.origin !== expectedOrigin)
                throw new ApiError(403, 'An exact Origin header is required.');
            const session = auth.session(req.headers.cookie);
            const cookie = (id: string, age: number) => `bc_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${remote ? '; Secure' : ''}`;
            if (url.pathname === '/api/login' && method === 'POST') {
                const data = z.object({ password: z.string().max(256) }).strict().parse(await body(req));
                try {
                    const login = await auth.login(data.password);
                    if (session)
                        auth.sessions.delete(session.id);
                    res.setHeader('Set-Cookie', cookie(login.id, 43200));
                    return send(res, 200, { csrf: login.csrf });
                }
                catch (e) {
                    throw new ApiError((e as Error).message.startsWith('Too many') ? 429 : 401, (e as Error).message);
                }
            }
            if (url.pathname === '/api/session' && method === 'GET')
                return send(res, 200, {
                    authenticated: Boolean(session), csrf: session?.csrf, setupRequired: !store.get('admin-hash')
                });
            if (url.pathname.startsWith('/api/')) {
                if (!session)
                    throw new ApiError(401, 'Please log in.');
                if (changing && req.headers['x-csrf-token'] !== session.csrf)
                    throw new ApiError(403, 'CSRF token is missing or invalid.');
                if (method === 'POST' && url.pathname === '/api/logout') {
                    auth.sessions.delete(session.id);
                    res.setHeader('Set-Cookie', cookie('', 0));
                    return send(res, 200, { ok: true });
                }
                if (url.pathname === '/api/performance' && method === 'GET')
                    return send(res, 200, performancePreferences(settings()));
                if (url.pathname === '/api/performance' && method === 'POST') {
                    if (!saveSettings)
                        throw new ApiError(503, 'Performance settings are unavailable in this host.');
                    const next = updatePerformance(settings(), await body(req));
                    saveSettings(next);
                    return send(res, 200, performancePreferences(settings()));
                }
                if (method === 'GET' && url.pathname === '/api/sources')
                    return send(res, 200, registry.manifests().map(m => ({ ...m, hold: store.holds().find(h => h.source === m.id) ?? null })));
                if (method === 'GET' && url.pathname === '/api/summary')
                    return send(res, 200, {
                        jobs: [], total: 0, groups: {}, counts: store.counts(), holds: store.holds(), paused: Boolean(store.get('queue-paused')), performance: queue.metrics()
                    });
                if (method === 'GET' && url.pathname === '/api/jobs') {
                    const history = url.searchParams.get('history') === 'true', offset = z.coerce.number().int().min(0).max(10000000).parse(url.searchParams.get('offset') ?? 0), limit = z.coerce.number().int().min(1).max(100).parse(url.searchParams.get('limit') ?? 100);
                    const page = store.list({
                        history, offset, limit, source: url.searchParams.get('source') || undefined, state: url.searchParams.get('state') || undefined, search: (url.searchParams.get('q') ?? '').slice(0, 200)
                    });
                    return send(res, 200, {
                        ...page, jobs: page.jobs.map(publicJob), groups: store.groupSummaries(page.jobs), counts: store.counts(), holds: store.holds(), paused: Boolean(store.get('queue-paused')), performance: queue.metrics()
                    });
                }
                if (method === 'GET' && url.pathname === '/api/library-status') {
                    const source = z.string().max(30).parse(url.searchParams.get('source')), id = opaqueId.parse(url.searchParams.get('id'));
                    registry.get(source);
                    const total = z.coerce.number().int().min(0).max(10000).parse(url.searchParams.get('total') ?? 0);
                    return send(res, 200, libraryStatus(store, { source, id } as Series, total, s.downloadRoot));
                }
                if (method === 'POST' && url.pathname === '/api/chapter-status') {
                    const data = z.object({ source: z.string().max(30), ids: z.array(opaqueId).max(100) }).strict().parse(await body(req));
                    const jobs = store.chapterJobs(data.source, data.ids);
                    for (const id of data.ids) {
                        const job = jobs[id];
                        if (job) {
                            const peer = store.equivalentChapter(job.chapter, s.downloadRoot);
                            if (peer)
                                jobs[id] = peer;
                        }
                    }
                    return send(res, 200, Object.fromEntries(Object.entries(jobs).map(([id, j]) => [id, j.verification && ['missing', 'damaged'].includes(j.verification.state) ? j.verification.state : j.state])));
                }
                if (method === 'GET' && url.pathname === '/api/cover-image') {
                    const source = z.string().max(30).parse(url.searchParams.get('source')), id = opaqueId.parse(url.searchParams.get('id'));
                    try {
                        const bytes = await covers.get(source, id);
                        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' });
                        return res.end(bytes);
                    }
                    catch {
                        throw new ApiError(404, 'Cover unavailable.');
                    }
                }
                if (method === 'POST' && url.pathname === '/api/source-retry') {
                    const { source } = z.object({ source: z.string().max(30) }).strict().parse(await body(req));
                    registry.get(source);
                    return send(res, 200, { requeued: await queue.retrySource(source) });
                }
                if (method === 'POST' && url.pathname === '/api/jobs/group') {
                    const data = z.object({
                        source: z.string().max(30), series: opaqueId, action: z.enum(['pause', 'resume', 'retry', 'remove'])
                    }).strict().parse(await body(req));
                    return send(res, 200, { changed: await queue.group(data.source, data.series, data.action) });
                }
                if (method === 'POST' && url.pathname === '/api/jobs/verify') {
                    const { id } = z.object({ id: z.string().uuid() }).strict().parse(await body(req)), job = store.job(id);
                    if (!job || job.state !== 'completed')
                        throw new ApiError(400, 'Choose a completed chapter.');
                    if (verifying >= 2 || verifyingJobs.has(id))
                        throw new ApiError(429, 'Verification is busy.');
                    verifying++;
                    verifyingJobs.add(id);
                    try {
                        const verification = await verifyOutput(job, abort.signal);
                        store.update(id, { verification });
                        if (registry.manifests().some(m => m.id === job.source && m.status === 'operational'))
                            await syncSeries(store, registry.get(job.source), job.series, job.root, abort.signal, undefined, { create: false, coverFormat: s.coverFormat }).catch(e => console.warn('Metadata:', (e as Error).message));
                        return send(res, 200, verification);
                    }
                    finally {
                        verifying--;
                        verifyingJobs.delete(id);
                    }
                }
                if (method === 'POST' && url.pathname === '/api/jobs/redownload') {
                    const { id, mode } = z.object({ id: z.string().uuid(), mode: z.enum(['missing', 'copy', 'replace']) }).strict().parse(await body(req));
                    if (verifying >= 2 || verifyingJobs.has(id))
                        throw new ApiError(429, 'Verification is busy.');
                    verifying++;
                    verifyingJobs.add(id);
                    try {
                        await redownload(store, id, mode, abort.signal);
                        queue.tick();
                        return send(res, 200, { ok: true });
                    }
                    catch (e) {
                        throw new ApiError(400, (e as NodeJS.ErrnoException).code ? 'Storage could not be accessed. Check local Settings.' : (e as Error).message);
                    }
                    finally {
                        verifying--;
                        verifyingJobs.delete(id);
                    }
                }
                if (method === 'GET' && url.pathname === '/api/follows')
                    return send(res, 200, store.follows().map(f => ({ ...f, series: publicSeries(f.series) })));
                if (method === 'POST' && url.pathname === '/api/follows') {
                    const data = z.object({
                        source: z.string().max(30), seriesId: opaqueId, language: z.string().min(2).max(10), group: opaqueId.optional(), autoDownload: z.boolean().default(false), enabled: z.boolean().default(false), outputFormat: z.enum(['inherit', 'cbz', 'folders']).default('inherit'), intervalHours: z.number().int().min(1).max(168).default(6)
                    }).strict().parse(await body(req));
                    const series = await registry.get(data.source).series(data.seriesId, abort.signal);
                    remember(series);
                    const result = follows.save(series, data);
                    return send(res, 200, { ...result, series: publicSeries(series) });
                }
                const followMatch = /^\/api\/follows\/([a-f0-9-]+)\/(check|preview|remove)$/.exec(url.pathname);
                if (method === 'POST' && followMatch) {
                    z.object({}).strict().parse(await body(req));
                    const [_, id, action] = followMatch;
                    if (action === 'remove') {
                        follows.remove(id);
                        return send(res, 200, { ok: true });
                    }
                    const result = await follows.check(id);
                    return send(res, 200, action === 'preview' ? previewFor(session.id, result.follow.series, result.chapters, result.follow.outputFormat === 'inherit' ? undefined : result.follow.outputFormat) : { ...result.summary, follow: { ...result.follow, series: publicSeries(result.follow.series) } });
                }
                if (method === 'POST' && url.pathname === '/api/cover') {
                    const data = z.object({
                        source: z.string().max(30), id: opaqueId, format: z.enum(['png', 'jpg']).optional()
                    }).strict().parse(await body(req));
                    const adapter = registry.get(data.source);
                    if (!adapter.cover)
                        throw new ApiError(400, 'Cover art is unavailable for this source.');
                    const series = await adapter.series(data.id, abort.signal), bytes = await adapter.cover(data.id, abort.signal);
                    const format = data.format ?? s.coverFormat ?? 'png';
                    await saveCover(s.downloadRoot, series.title, bytes, abort.signal, series, store, format);
                    await syncSeries(store, adapter, series, s.downloadRoot, abort.signal, undefined, { coverFormat: format }).catch(e => console.warn('Metadata:', (e as Error).message));
                    return send(res, 200, { saved: true, filename: `coverart.${format}` });
                }
                if (method === 'POST' && url.pathname === '/api/jobs/delete') {
                    const data = z.object({ id: z.string().uuid().optional(), all: z.literal(true).optional() }).strict().refine(d => Boolean(d.id) !== Boolean(d.all)).parse(await body(req));
                    return send(res, 200, { deleted: await queue.remove(data.id ? [data.id] : store.states('queued', 'running', 'paused', 'failed', 'action_required', 'cancelled').map(j => j.id)) });
                }
                if (method === 'POST' && url.pathname === '/api/queue') {
                    const { action } = z.object({ action: z.enum(['pause', 'resume']) }).strict().parse(await body(req));
                    action === 'pause' ? queue.pauseAll() : queue.resumeAll();
                    return send(res, 200, { ok: true });
                }
                const jobMatch = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);
                if (method === 'POST' && url.pathname === '/api/jobs/clear-failed') {
                    z.object({}).strict().parse(await body(req));
                    return send(res, 200, { cleared: await queue.clearFailed() });
                }
                if (method === 'POST' && jobMatch) {
                    const { action } = z.object({ action: z.enum(['pause', 'resume', 'cancel', 'retry']) }).strict().parse(await body(req));
                    await queue.control(jobMatch[1], action);
                    return send(res, 200, { ok: true });
                }
                if (method === 'GET' && url.pathname === '/api/search-all') {
                    const query = z.string().min(1).max(200).parse(url.searchParams.get('q'));
                    const targets = registry.manifests().filter(m => m.status === 'operational');
                    reads = reads.filter(t => Date.now() - t < 60000);
                    if (reads.length + targets.length > 90)
                        throw new ApiError(429, 'Too many source requests. Wait a minute.');
                    reads.push(...targets.map(() => Date.now()));
                    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
                    res.flushHeaders();
                    const emit = (event: unknown) => {
                        if (!res.destroyed && !abort.signal.aborted)
                            res.write(JSON.stringify(event) + '\n');
                    };
                    await Promise.all(targets.map(async (target) => {
                        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]);
                        let cancel!: () => void;
                        try {
                            signal.throwIfAborted();
                            const cancelled = new Promise<never>((_resolve, reject) => {
                                cancel = () => reject(signal.reason);
                                signal.addEventListener('abort', cancel, { once: true });
                            });
                            const page = await Promise.race([registry.get(target.id).search(query, 0, signal), cancelled]);
                            page.items.forEach(remember);
                            emit({ source: target.id, page: { ...page, items: page.items.map(publicSeries) } });
                        }
                        catch (e) {
                            emit({ source: target.id, error: signal.aborted ? 'Search timed out. Retry this source.' : e instanceof SourceError ? e.message : 'Source search failed. Retry this source.' });
                        }
                        finally {
                            if (cancel)
                                signal.removeEventListener('abort', cancel);
                        }
                    }));
                    return res.end();
                }
                if (method === 'GET' && ['/api/search', '/api/series', '/api/chapters'].includes(url.pathname)) {
                    reads = reads.filter(t => Date.now() - t < 60000);
                    if (reads.length >= 90)
                        throw new ApiError(429, 'Too many source requests. Wait a minute.');
                    reads.push(Date.now());
                    const adapter = registry.get(url.searchParams.get('source') ?? 'mangadex');
                    const offset = z.coerce.number().int().min(0).max(9999).parse(url.searchParams.get('offset') ?? 0);
                    if (url.pathname === '/api/search') {
                        const page = await adapter.search(z.string().min(1).max(200).parse(url.searchParams.get('q')), offset, abort.signal);
                        page.items.forEach(remember);
                        return send(res, 200, { ...page, items: page.items.map(publicSeries) });
                    }
                    const id = opaqueId.parse(url.searchParams.get('id'));
                    if (url.pathname === '/api/series') {
                        const series = await adapter.series(id, abort.signal);
                        remember(series);
                        // Browsing metadata must not crawl the catalog or re-hash local archives.
                        // Download previews reconcile files before anything is enqueued.
                        if (!store.folder(s.downloadRoot, `${series.source}:${series.id}`))
                            await findSeriesDirectory(s.downloadRoot, series, store);
                        return send(res, 200, { ...publicSeries(series), library: { ...libraryStatus(store, series, 0, s.downloadRoot), totalKnown: false } });
                    }
                    const page = await adapter.chapters(id, { language: url.searchParams.get('language') ?? 'en', group: url.searchParams.get('group') || undefined }, offset, abort.signal);
                    const hint = seriesHints.get(`${adapter.manifest.id}:${id}`);
                    if (hint && !store.folder(s.downloadRoot, `${hint.source}:${hint.id}`))
                        await findSeriesDirectory(s.downloadRoot, hint, store);
                    const local = store.chapterJobs(adapter.manifest.id, page.items.map(c => c.id));
                    for (const c of page.items) {
                        const peer = store.equivalentChapter(c, s.downloadRoot);
                        if (peer)
                            local[c.id] = peer;
                    }
                    return send(res, 200, {
                        ...page, library: libraryStatus(store, {
                            id, source: adapter.manifest.id, title: '', description: ''
                        }, page.total, s.downloadRoot), items: page.items.map(c => ({
                            ...c, localChapterId: local[c.id]?.chapter.id, localSource: local[c.id]?.source, localJobId: local[c.id]?.id, localState: local[c.id]?.verification && ['missing', 'damaged'].includes(local[c.id].verification!.state) ? local[c.id].verification!.state : local[c.id]?.state ?? 'not_downloaded'
                        }))
                    });
                }
                if (method === 'POST' && url.pathname === '/api/library-scan') {
                    const data = z.object({
                        source: z.string().max(30), seriesId: opaqueId, language: z.string().min(2).max(10), group: opaqueId.optional(), force: z.boolean().optional()
                    }).strict().parse(await body(req));
                    const adapter = registry.get(data.source), key = JSON.stringify([s.downloadRoot, data.source, data.seriesId, data.language, data.group]);
                    const cached = scans.get(key);
                    if (!data.force && cached && cached.expires > Date.now()) {
                        const info = await lstat(cached.folder).catch(() => undefined);
                        if (info?.isDirectory() && !info.isSymbolicLink() && info.mtimeMs === cached.modified)
                            return send(res, 200, cached.result);
                    }
                    if (scanningLibrary)
                        throw new ApiError(409, 'Another folder check is finishing. Try again shortly.');
                    scanningLibrary = true;
                    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(300000)]);
                    try {
                        const series = seriesHints.get(`${data.source}:${data.seriesId}`) ?? await adapter.series(data.seriesId, signal);
                        const found = await existingSeriesFolder(store, series, s.downloadRoot);
                        let result: unknown;
                        if (!found.folder)
                            result = {
                                folderFound: false, imported: 0, ambiguous: found.ambiguous ? 1 : 0, skipped: 0
                            };
                        else {
                            const chapters = await matching(adapter, data.seriesId, data, undefined, signal);
                            const verified = await reconcile(store, series, chapters, s, signal);
                            result = { ...await reconcileExternal(store, series, chapters, s, signal, verified), completed: libraryStatus(store, series, chapters.length, s.downloadRoot).downloaded };
                        }
                        signal.throwIfAborted();
                        if (found.folder)
                            scans.set(key, {
                                expires: Date.now() + 30000, result, folder: found.folder, modified: (await lstat(found.folder)).mtimeMs
                            });
                        if (scans.size > 64)
                            scans.delete(scans.keys().next().value!);
                        return send(res, 200, result);
                    }
                    finally {
                        scanningLibrary = false;
                    }
                }
                if (method === 'POST' && url.pathname === '/api/preview') {
                    const data = z.object({
                        source: z.string().max(30), seriesId: opaqueId, language: z.string().min(2).max(10), group: opaqueId.optional(), ids: z.array(opaqueId).min(1).max(10000).optional(), all: z.boolean().optional(), exclude: z.array(opaqueId).max(10000).optional()
                    }).strict().parse(await body(req));
                    // The UI has one current confirmation per session; replacing/cancelling previews must not exhaust the cache.
                    for (const [id, p] of previews)
                        if (p.expires < Date.now() || p.session === session.id)
                            previews.delete(id);
                    if (busyPreviews >= 1 || previews.size >= 10)
                        throw new ApiError(429, 'A chapter preview is already in progress, or too many are pending.');
                    busyPreviews++;
                    try {
                        const adapter = registry.get(data.source), series = await adapter.series(data.seriesId, abort.signal), resolved = await matching(adapter, data.seriesId, data.all ? { language: '*' } : data, data.all ? undefined : data.ids, abort.signal), chapters = resolved.filter(c => !data.exclude?.includes(c.id));
                        const verified = await reconcile(store, series, chapters, s, abort.signal);
                        await reconcileExternal(store, series, chapters, s, abort.signal, verified);
                        await syncSeries(store, adapter, series, s.downloadRoot, abort.signal, data.all ? resolved.length : undefined, { create: false, coverFormat: s.coverFormat }).catch(e => console.warn('Metadata:', (e as Error).message));
                        return send(res, 200, previewFor(session.id, series, chapters));
                    }
                    finally {
                        busyPreviews--;
                    }
                }
                if (method === 'POST' && url.pathname === '/api/enqueue') {
                    const data = z.object({ token: z.string(), confirmTranslations: z.boolean() }).strict().parse(await body(req));
                    const p = previews.get(data.token);
                    if (!p || p.session !== session.id || p.expires < Date.now())
                        throw new ApiError(400, 'Preview expired. Preview the matching chapters again.');
                    let result;
                    try {
                        result = enqueueSelection(store, p.series, p.chapters, { ...s, format: p.format ?? s.format }, data.confirmTranslations);
                    }
                    catch (e) {
                        if ((e as Error).message.startsWith('Additional translations'))
                            throw new ApiError(400, (e as Error).message);
                        throw e;
                    }
                    previews.delete(data.token);
                    queue.tick();
                    return send(res, 200, result);
                }
                throw new ApiError(404, 'Unknown API route.');
            }
            if (!['GET', 'HEAD'].includes(method))
                throw new ApiError(405, 'Method not allowed.');
            const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
            // Serve only build assets; never fall back to arbitrary paths or application data.
            if (name !== 'index.html' && name !== 'favicon.ico' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|png)$/.test(name))
                throw new ApiError(404, 'Not found.');
            const file = await readFile(path.join(uiDir, name));
            res.setHeader('Content-Type', name.endsWith('.ico') ? 'image/x-icon' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
            res.end(method === 'HEAD' ? undefined : file);
        }
        catch (e) {
            if (res.headersSent || res.destroyed)
                return;
            const status = e instanceof ApiError ? e.status : e instanceof z.ZodError ? 400 : e instanceof SourceError ? 502 : 400;
            send(res, status, { error: e instanceof z.ZodError ? 'Invalid request parameters.' : e instanceof ApiError || e instanceof SourceError ? e.message : 'Request failed. Refresh and try again.' });
        }
        finally {
            tasks.delete(completion);
            complete();
        }
    });
    server.requestTimeout = 120000;
    server.headersTimeout = 10000;
    return {
        server, auth, follows, listen: (port = settings().port) => new Promise<number>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => {
                server.removeListener('error', reject);
                const a = server.address();
                resolve(typeof a === 'object' && a ? a.port : port);
            });
        }), close: async () => {
            closing = true;
            const closed = new Promise<void>((resolve, reject) => {
                if (!server.listening)
                    return resolve();
                server.close(e => e ? reject(e) : resolve());
                server.closeAllConnections();
            });
            for (const controller of requests)
                controller.abort();
            await Promise.allSettled([follows.stop(), covers.stop(), ...tasks]);
            await closed;
            auth.clear();
        }
    };
}
