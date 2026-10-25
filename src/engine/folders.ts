import path from 'node:path';
import { mkdir, readdir, readFile, writeFile, lstat, realpath, rename } from 'node:fs/promises';
import { safeName, contained, digest, noLink } from './files.js';
import type { Store } from '../core/store.js';
import { SourceError, type Series } from '../shared/types.js';
export async function markerData(file: string) {
    await noLink(file);
    if ((await lstat(file)).size > 16384)
        throw Error('Series marker exceeds size limit');
    return JSON.parse(await readFile(file, 'utf8'));
}
export function markerHasIdentity(marker: any, identity: string): boolean {
    return marker?.identity === identity || Array.isArray(marker?.identities) && marker.identities.includes(identity);
}
export const titleKey = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
export async function addSeriesIdentity(dir: string, identity: string, title: string) {
    const file = contained(dir, '.bear-cave-series.json'), marker = await markerData(file);
    if (markerHasIdentity(marker, identity))
        return;
    const identities = [...new Set<string>([marker.identity, ...(marker.identities ?? []), identity])];
    const temp = contained(dir, '.series-marker.part');
    await noLink(temp);
    await writeFile(temp, JSON.stringify({
        ...marker, version: 2, identities, title: marker.title || title
    }));
    await rename(temp, file);
}
const directoryLocks = new Map<string, Promise<unknown>>();
export async function withDirectoryLock<T>(root: string, work: () => Promise<T>): Promise<T> {
    const key = path.resolve(root).toLowerCase(), previous = directoryLocks.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {
    }).then(work);
    directoryLocks.set(key, pending);
    try {
        return await pending;
    }
    finally {
        if (directoryLocks.get(key) === pending)
            directoryLocks.delete(key);
    }
}
async function claimSeries(dir: string, identity: string, title: string) {
    const file = contained(dir, '.bear-cave-series.json');
    try {
        return markerHasIdentity(await markerData(file), identity);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
    }
    try {
        await writeFile(file, JSON.stringify({
            version: 1, identity, title
        }), { flag: 'wx' });
        return true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
            throw e;
        return markerHasIdentity(await markerData(file), identity);
    }
}
export async function checkPath(root: string, file: string) {
    contained(root, path.relative(root, file));
    let current = root;
    await noLink(root);
    for (const part of path.relative(root, file).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        await noLink(current);
    }
}
export async function seriesDirectory(root: string, series: Series, store?: Store): Promise<string> {
    return withDirectoryLock(root, () => resolveSeriesDirectory(root, series, store));
}
async function resolveSeriesDirectory(root: string, series: Series, store?: Store) {
    root = await realpath(root);
    const identity = `${series.source}:${series.id}`, known = store?.folder(root, identity);
    if (known) {
        const dir = contained(root, known);
        await checkPath(root, dir);
        await mkdir(dir, { recursive: true });
        if (!await claimSeries(dir, identity, series.title))
            throw new SourceError('The mapped series folder belongs to another identity. Choose another download root in local Settings.');
        return dir;
    }
    // Adopt recorded legacy output only when no other identity shares that directory.
    const recorded = store?.legacyOutput(series.source, series.id, root);
    if (recorded?.output) {
        const dir = path.dirname(recorded.output);
        if (!store!.folderConflict(dir, series.source, series.id)) {
            await checkPath(root, dir);
            await mkdir(dir, { recursive: true });
            if (await claimSeries(dir, identity, series.title)) {
                store!.claimFolder(root, identity, path.relative(root, dir));
                return dir;
            }
        }
    }
    // Portable markers also recover renamed series and libraries whose SQLite history was lost.
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.'))
            continue;
        const dir = contained(root, entry.name);
        try {
            await checkPath(root, dir);
            const marker = await markerData(contained(dir, '.bear-cave-series.json'));
            const identities: string[] = [marker.identity, ...(marker.identities ?? [])];
            if (!markerHasIdentity(marker, identity)) {
                if (!store || typeof marker.title !== 'string' || titleKey(marker.title) !== titleKey(series.title) || identities.some(id => id.startsWith(`${series.source}:`)))
                    continue;
                await addSeriesIdentity(dir, identity, series.title);
            }
            store?.claimFolder(root, identity, entry.name);
            return dir;
        }
        catch { /* Unmarked and unrelated directories are left untouched. */
        }
    }
    const base = safeName(series.title, 65), suffix = digest(Buffer.from(identity)).slice(0, 8);
    for (const candidate of [base, `${safeName(series.title, 52)} [${series.source}-${suffix}]`]) {
        const existing = (await readdir(root)).find(n => n.toLowerCase() === candidate.toLowerCase()), dir = contained(root, existing ?? candidate);
        await checkPath(root, dir);
        const marker = contained(dir, '.bear-cave-series.json');
        if (existing) {
            try {
                await noLink(marker);
                if (!markerHasIdentity(await markerData(marker), identity))
                    continue;
            }
            catch {
                // v0.2.x folders had chapter claims but no series marker. Adopt only if every claim is provably this series.
                if (!store)
                    continue;
                const metadata = contained(dir, '.bear-cave');
                try {
                    await noLink(metadata);
                    const claims = (await readdir(metadata)).filter(n => /^[a-f0-9]{32}\.json$/.test(n));
                    if (!claims.length)
                        continue;
                    let owned = true;
                    for (const name of claims) {
                        const claim = contained(metadata, name);
                        await noLink(claim);
                        if ((await lstat(claim)).size > 4096) {
                            owned = false;
                            break;
                        }
                        const value = JSON.parse(await readFile(claim, 'utf8'));
                        if (typeof value !== 'string') {
                            owned = false;
                            break;
                        }
                        const split = value.indexOf(':'), source = value.slice(0, split), chapter = value.slice(split + 1), job = store.chapterJobs(source, [chapter])[chapter];
                        if (!job || source !== series.source || job.series.id !== series.id) {
                            owned = false;
                            break;
                        }
                    }
                    if (!owned)
                        continue;
                }
                catch {
                    continue;
                }
            }
        }
        await mkdir(dir, { recursive: true });
        await noLink(marker);
        try {
            await writeFile(marker, JSON.stringify({
                version: 1, identity, title: series.title
            }), { flag: 'wx' });
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                throw e;
            if (!markerHasIdentity(await markerData(marker), identity))
                continue;
        }
        if (store)
            try {
                store.claimFolder(root, identity, path.relative(root, dir));
            }
            catch {
                continue;
            }
        return dir;
    }
    throw Error('Cannot safely assign a series folder. Check local storage.');
}
