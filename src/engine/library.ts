import { libraryChapterCount } from '../shared/chapters.js';
import path from 'node:path';
import { readdir, readFile, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Store } from '../core/store.js';
import type { Chapter, Series, SourceAdapter, Settings } from '../shared/types.js';
import { seriesDirectory, checkPath } from './folders.js';
import { contained, noLink, saveCover, digest } from './files.js';
import { verifyOutput } from './verification.js';
import { matching } from './selection.js';
import { verifyArchive, validManifest } from './archive.js';
// Identity comes from source chapter manifests, never from similar folder titles.
export async function reconcile(store: Store, series: Series, chapters: Chapter[], settings: Settings, signal?: AbortSignal) {
    const dir = await seriesDirectory(settings.downloadRoot, series, store);
    const known = new Map(chapters.map(c => [c.id, c]));
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        signal?.throwIfAborted();
        if (entry.name.startsWith('.') || entry.name.includes('.backup-') || (!entry.isDirectory() && !entry.name.endsWith('.cbz')))
            continue;
        const file = contained(dir, entry.name);
        try {
            await checkPath(settings.downloadRoot, file);
            let manifest;
            if (entry.isDirectory()) {
                const mf = contained(file, 'manifest.json');
                await noLink(mf);
                if ((await lstat(mf)).size > 1024 * 1024)
                    continue;
                manifest = validManifest(JSON.parse(await readFile(mf, 'utf8')));
            }
            else
                manifest = await verifyArchive(file, undefined, signal);
            if (manifest.source && manifest.source !== series.source || manifest.series && manifest.series !== series.id)
                continue;
            if (!manifest.source) {
                const owner = store.db.prepare("SELECT source,series_id FROM jobs WHERE json_extract(data,'$.output')=? LIMIT 1").get(file);
                if (owner && (owner.source !== series.source || owner.series_id !== series.id))
                    continue;
                if (!owner) {
                    const stem = entry.isDirectory() ? entry.name : path.basename(entry.name, '.cbz');
                    const claim = contained(dir, '.bear-cave', `${digest(Buffer.from(stem)).slice(0, 32)}.json`);
                    let identity: unknown;
                    try {
                        await noLink(claim);
                        if ((await lstat(claim)).size < 4096)
                            identity = JSON.parse(await readFile(claim, 'utf8'));
                    }
                    catch {
                    }
                    if (identity && identity !== `${series.source}:${manifest.chapter}`)
                        continue;
                    const marker = contained(dir, '.bear-cave-series.json');
                    await noLink(marker);
                    const group = JSON.parse(await readFile(marker, 'utf8'));
                    if (!identity && new Set([group.identity, ...(group.identities ?? [])]).size > 1)
                        continue;
                }
            }
            const chapter = known.get(manifest.chapter);
            if (!chapter)
                continue;
            const existing = store.chapterJobs(series.source, [chapter.id])[chapter.id];
            if (existing && existing.state !== 'completed')
                continue;
            if (existing?.output && existing.output !== file && path.resolve(existing.root) === path.resolve(settings.downloadRoot) && (await verifyOutput(existing, signal)).state === 'verified')
                continue;
            const candidate = {
                ...(existing ?? { root: settings.downloadRoot, chapter }), source: series.source, series, root: settings.downloadRoot, output: file
            };
            const verification = await verifyOutput(candidate as import('../shared/types.js').Job, signal);
            if (verification.state !== 'verified')
                continue;
            if (existing && store.job(existing.id)?.state !== 'completed')
                continue;
            const job = existing ?? store.enqueue(series, chapter, settings, { importOutput: true }).job;
            store.update(job.id, {
                state: 'completed', root: settings.downloadRoot, output: file, format: entry.isDirectory() ? 'folders' : 'cbz', done: manifest.pages.length, total: manifest.pages.length, verification
            });
        }
        catch (e) {
            if (signal?.aborted)
                throw e; /* Unknown or unusable files remain untouched. */
        }
    }
    for (const job of new Map([...store.seriesJobs(series.source, series.id), ...store.libraryJobs(series.source, series.id, settings.downloadRoot)].map(j => [j.id, j])).values()) {
        if (job.state !== 'completed')
            continue;
        const verification = path.resolve(job.root) === path.resolve(settings.downloadRoot)
            ? await verifyOutput(job, signal) : { state: 'missing' as const, checked: new Date().toISOString() };
        if (store.job(job.id)?.state === 'completed')
            store.update(job.id, { verification });
    }
}
export function libraryStatus(store: Store, series: Series, total: number, root?: string) {
    const jobs = store.libraryJobs(series.source, series.id, root);
    const downloaded = libraryChapterCount(jobs.filter(j => j.state === 'completed' && j.verification?.state === 'verified'));
    total = Math.max(total, libraryChapterCount(jobs));
    const state = jobs.some(j => ['running', 'queued'].includes(j.state)) ? 'Downloading' : downloaded === total && total > 0 ? 'Fully Downloaded' : jobs.some(j => j.state === 'failed' || j.verification?.state === 'damaged') ? 'Download Failed' : downloaded ? 'Partially Downloaded' : 'Not Downloaded';
    return {
        state, downloaded, total
    };
}
const locks = new Map<string, Promise<void>>();
export async function syncSeries(store: Store, adapter: SourceAdapter, series: Series, root: string, signal?: AbortSignal, total?: number, options: {
    offline?: boolean;
} = {}) {
    const dir = await seriesDirectory(root, series, store);
    const key = dir;
    const sourceKey = `${root}:${series.source}:${series.id}`;
    const previous = locks.get(key) ?? Promise.resolve();
    const work = previous.catch(() => {
    }).then(async () => {
        const file = contained(dir, 'metadata.json');
        await noLink(file);
        let old: Record<string, any> = {};
        try {
            if ((await lstat(file)).size < 4 * 1024 * 1024)
                old = JSON.parse(await readFile(file, 'utf8'));
        }
        catch {
        }
        const now = new Date().toISOString();
        const countRetryKey = `metadata-count-attempt:${sourceKey}`;
        if (!options.offline && total === undefined && old.chapters?.total_available == null && Date.now() - (store.get<number>(countRetryKey) ?? 0) >= 3600000) {
            store.set(countRetryKey, Date.now());
            try {
                total = (await matching(adapter, series.id, { language: '*' }, undefined, signal)).length;
            }
            catch (e) {
                console.warn('Chapter count unavailable:', (e as Error).message);
            }
        }
        const jobs = store.libraryJobs(series.source, series.id, root).filter(j => path.resolve(j.root) === path.resolve(root));
        const complete = jobs.filter(j => j.state === 'completed' && j.verification?.state === 'verified');
        const extra = Object.fromEntries(Object.entries(series.metadata ?? {}).filter(([, v]) => v !== null && v !== '' && (!Array.isArray(v) || v.length)));
        const sourceUrl = series.url ?? (series.source === 'mangadex' ? `https://mangadex.org/title/${series.id}` : new URL(Buffer.from(series.id, 'base64url').toString(), adapter.manifest.website).href);
        const source = {
            id: series.source, name: adapter.manifest.name, series_id: series.id, url: sourceUrl,
            cover_url: series.coverRef ? (series.source === 'mangadex' ? `https://uploads.mangadex.org/covers/${series.id}/${series.coverRef}` : series.coverRef) : null
        };
        const sources: Record<string, any>[] = old.sources ?? (old.source ? [old.source] : []);
        const knownSource = sources.findIndex(s => s.series_id === series.id && (s.id === series.source || s.name === adapter.manifest.name));
        const sourceEntry = {
            ...(knownSource >= 0 ? sources[knownSource] : {}), ...source, cover_url: source.cover_url ?? (knownSource >= 0 ? sources[knownSource].cover_url : null), metadata: { ...(knownSource >= 0 ? sources[knownSource].metadata : {}), ...extra },
            total_available: total ?? (knownSource >= 0 ? sources[knownSource].total_available : null) ?? null
        };
        if (knownSource >= 0)
            sources[knownSource] = sourceEntry;
        else
            sources.push(sourceEntry);
        const primary = !old.source || old.source.series_id === series.id && old.source.name === adapter.manifest.name;
        const fields = primary ? extra : Object.fromEntries(Object.entries(extra).filter(([k]) => old[k] == null || old[k] === '' || Array.isArray(old[k]) && !old[k].length));
        const data = {
            schema_version: 1, alternative_titles: [], authors: [], artists: [], genres: [], tags: [], status: null, type: null, release_year: null, original_language: null,
            ...old, ...fields, title: primary ? series.title || old.title : old.title || series.title, description: primary ? series.description || old.description || null : old.description || series.description || null,
            source: primary ? {
                ...old.source, ...source, cover_url: source.cover_url ?? old.source?.cover_url ?? null
            } : old.source,
            sources,
            chapters: { total_available: Math.max(old.chapters?.total_available ?? 0, ...sources.map(s => s.total_available ?? 0), libraryChapterCount(jobs)) || null, downloaded: libraryChapterCount(complete) },
            library: {
                date_added: old.library?.date_added ?? now, last_metadata_update: now,
                last_chapter_download: complete.flatMap(j => j.completedAt ? [j.completedAt] : []).sort().at(-1) ?? old.library?.last_chapter_download ?? null
            },
            source_metadata: {
                ...old.source_metadata, ...(primary ? extra : {}), sources: { ...old.source_metadata?.sources, [series.source]: extra }
            }
        };
        const temp = contained(dir, `.metadata-${randomUUID()}.part`);
        try {
            await writeFile(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
            await noLink(file);
            await rename(temp, file);
        }
        finally {
            await rm(temp, { force: true });
        }
        const cover = contained(dir, 'coverart.png');
        try {
            await noLink(cover);
            const image = sharp(await readFile(cover));
            if ((await image.metadata()).format !== 'png')
                throw Error('Invalid PNG');
            await image.stats();
            return;
        }
        catch {
        }
        if (options.offline)
            return;
        const retryKey = `cover-attempt:${sourceKey}`;
        if (Date.now() - (store.get<number>(retryKey) ?? 0) < 3600000)
            return;
        store.set(retryKey, Date.now());
        try {
            if (adapter.cover) {
                await saveCover(root, series.title, await adapter.cover(series.id, signal, series.coverRef), signal, series, store);
                store.set(retryKey, 0);
            }
        }
        catch (e) {
            console.warn('Cover art unavailable:', (e as Error).message);
        }
    });
    locks.set(key, work);
    try {
        await work;
    }
    finally {
        if (locks.get(key) === work)
            locks.delete(key);
    }
}
