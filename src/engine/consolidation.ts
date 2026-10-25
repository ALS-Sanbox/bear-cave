import path from 'node:path';
import { readdir, lstat, mkdir, rename, rmdir, writeFile } from 'node:fs/promises';
import type { Store } from '../core/store.js';
import { contained, digest } from './files.js';
import { markerData, markerHasIdentity, addSeriesIdentity, checkPath, titleKey, withDirectoryLock } from './folders.js';
import { verifyOutput } from './verification.js';
interface Move {
    from: string;
    to: string;
}
interface Merge {
    root: string;
    from: string;
    to: string;
    identities: string[];
    title: string;
    moves: Move[];
}
async function exists(file: string) {
    try {
        await lstat(file);
        return true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return false;
        throw e;
    }
}
async function treeSafe(root: string, file: string) {
    await checkPath(root, file);
    if ((await lstat(file)).isDirectory())
        for (const e of await readdir(file))
            await treeSafe(root, contained(file, e));
}
const belongs = (dir: string, file: string) => file === dir || file.startsWith(dir + path.sep);
function remap(file: string | null | undefined, merge: Merge): typeof file {
    if (!file || !belongs(merge.from, file))
        return file;
    const move = merge.moves.find(m => belongs(m.from, file));
    return move ? path.join(move.to, path.relative(move.from, file)) : file === merge.from ? merge.to : file;
}
async function plan(store: Store, root: string, from: string, to: string, marker: any): Promise<Merge> {
    const identities: string[] = [...new Set<string>([marker.identity, ...(marker.identities ?? [])])];
    const tag = digest(Buffer.from(identities.join('|'))).slice(0, 8), moves: Move[] = [], reserved = new Set<string>();
    async function add(file: string, dest: string) {
        await treeSafe(root, file);
        await checkPath(root, dest);
        const original = dest;
        for (let n = 1; await exists(dest) || reserved.has(dest.toLowerCase()); n++) {
            const ext = path.extname(original);
            dest = contained(path.dirname(original), `${path.basename(original, ext)} [import-${tag}-${n}]${ext}`);
        }
        reserved.add(dest.toLowerCase());
        moves.push({ from: file, to: dest });
    }
    for (const entry of await readdir(from)) {
        const file = contained(from, entry);
        if (entry === '.bear-cave') {
            await checkPath(root, file);
            for (const child of await readdir(file))
                await add(contained(file, child), contained(to, '.bear-cave', child));
        }
        else if (['.bear-cave-series.json', 'metadata.json', 'coverart.png'].includes(entry) && (entry === '.bear-cave-series.json' || await exists(contained(to, entry)))) {
            await add(file, contained(to, '.bear-cave', 'imports', `${tag}-${entry.replace(/^\./, '')}`));
        }
        else
            await add(file, contained(to, entry));
    }
    return {
        root, from, to, identities, title: marker.title, moves
    };
}
async function apply(store: Store, key: string, merge: Merge) {
    const { root, from, to } = merge;
    // All mutations are confined to the checked library root. No recursive deletes or overwrites.
    await checkPath(root, from);
    await checkPath(root, to);
    for (const move of merge.moves) {
        await checkPath(root, move.from);
        await checkPath(root, move.to);
        if (!await exists(move.from)) {
            if (await exists(move.to))
                continue;
            throw Error('A planned library file is missing.');
        }
        if (await exists(move.to))
            throw Error('Library merge destination changed. Existing files were preserved.');
        await treeSafe(root, move.from);
        await mkdir(path.dirname(move.to), { recursive: true });
        await rename(move.from, move.to);
    }
    for (const identity of merge.identities)
        await addSeriesIdentity(to, identity, merge.title);
    store.db.exec('BEGIN IMMEDIATE');
    try {
        for (const job of store.jobs().filter(j => path.resolve(j.root) === path.resolve(root))) {
            const patch = {
                output: remap(job.output, merge) ?? null, seriesFolder: remap(job.seriesFolder, merge) ?? undefined,
                previousOutputs: job.previousOutputs?.map(p => remap(p, merge)!),
                replacement: job.replacement ? { ...job.replacement, original: remap(job.replacement.original, merge)! } : undefined
            };
            if (JSON.stringify(patch) !== JSON.stringify({
                output: job.output, seriesFolder: job.seriesFolder, previousOutputs: job.previousOutputs, replacement: job.replacement
            }))
                store.update(job.id, patch);
        }
        for (const identity of merge.identities)
            store.mapFolder(root, identity, path.relative(root, to));
        store.db.exec('COMMIT');
    }
    catch (e) {
        store.db.exec('ROLLBACK');
        throw e;
    }
    const meta = contained(from, '.bear-cave');
    if (await exists(meta)) {
        await checkPath(root, meta);
        await rmdir(meta);
    }
    if (await exists(from)) {
        await checkPath(root, from);
        await rmdir(from);
    }
    store.set(key, null);
}
export async function consolidateLibrary(store: Store, root: string) {
    return withDirectoryLock(root, async () => {
        if (store.states('running').some(j => path.resolve(j.root) === path.resolve(root)))
            throw Error('Stop active downloads before combining library folders.');
        let merged = 0, linked = 0;
        const prefix = `library-merge:${digest(Buffer.from(path.resolve(root))).slice(0, 16)}:`;
        for (const row of store.db.prepare("SELECT key,value FROM kv WHERE key LIKE ? AND value!='null'").all(prefix + '%')) {
            const merge = JSON.parse(String(row.value)) as Merge;
            if (path.resolve(merge.root) !== path.resolve(root))
                throw Error('Invalid library merge root.');
            await apply(store, String(row.key), merge);
            merged++;
        }
        const groups = new Map<string, {
            dir: string;
            marker: any;
        }[]>();
        for (const entry of await readdir(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.'))
                continue;
            const dir = contained(root, entry.name);
            try {
                await checkPath(root, dir);
                const markerFile = contained(dir, '.bear-cave-series.json');
                let marker;
                try {
                    marker = await markerData(markerFile);
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw e;
                    // Older libraries lack markers: prove ownership from recorded output paths.
                    const recorded = store.jobs().filter(j => path.resolve(j.root) === path.resolve(root) && j.output && path.dirname(j.output).toLowerCase() === dir.toLowerCase());
                    const identities = [...new Set(recorded.map(j => `${j.source}:${j.series.id}`))];
                    if (identities.length !== 1 || !recorded.length || new Set(recorded.map(j => titleKey(j.series.title))).size !== 1)
                        continue;
                    marker = {
                        version: 1, identity: identities[0], title: recorded[0].series.title
                    };
                    await writeFile(markerFile, JSON.stringify(marker), { flag: 'wx' });
                    store.mapFolder(root, marker.identity, path.relative(root, dir));
                    linked++;
                }
                if (typeof marker.title !== 'string' || !marker.title.trim() || typeof marker.identity !== 'string')
                    continue;
                const group = groups.get(titleKey(marker.title)) ?? [];
                group.push({ dir, marker });
                groups.set(titleKey(marker.title), group);
            }
            catch { /* Unknown folders are not matched by filename. */
            }
        }
        // Queued supplementary sources can share an existing library even before their first output.
        const series = new Map(store.jobs().filter(j => path.resolve(j.root) === path.resolve(root)).map(j => [`${j.source}:${j.series.id}`, j.series]));
        for (const [identity, s] of series) {
            if (store.folder(root, identity))
                continue;
            const candidates = groups.get(titleKey(s.title)) ?? [];
            if (candidates.length !== 1)
                continue;
            const target = candidates[0], ids: string[] = [target.marker.identity, ...(target.marker.identities ?? [])];
            if (!ids.includes(identity) && ids.some(id => id.startsWith(`${s.source}:`)))
                continue;
            await addSeriesIdentity(target.dir, identity, s.title);
            target.marker = await markerData(contained(target.dir, '.bear-cave-series.json'));
            store.mapFolder(root, identity, path.relative(root, target.dir));
            linked++;
        }
        for (const group of groups.values()) {
            if (group.length < 2)
                continue;
            const identities = [...new Set<string>(group.flatMap(g => [g.marker.identity, ...(g.marker.identities ?? [])]))];
            const sources = identities.map(id => id.slice(0, id.indexOf(':')));
            if (new Set(sources).size !== sources.length)
                continue; // Same-source editions remain distinct.
            group.sort((a, b) => path.basename(a.dir).length - path.basename(b.dir).length || a.dir.localeCompare(b.dir));
            const target = group[0];
            for (const source of group.slice(1)) {
                const key = prefix + digest(Buffer.from(source.dir + '|' + target.dir)).slice(0, 16);
                const merge = await plan(store, root, source.dir, target.dir, source.marker);
                store.set(key, merge);
                await apply(store, key, merge);
                merged++;
            }
        }
        if (merged || linked) {
            // Cross-source deduplication only trusts checked completed output.
            for (const job of store.states('completed').filter(j => path.resolve(j.root) === path.resolve(root)))
                store.update(job.id, { verification: await verifyOutput(job) });
            for (const job of store.states('queued').filter(j => path.resolve(j.root) === path.resolve(root))) {
                if (job.replacement || job.copySuffix)
                    continue;
                const peer = store.equivalentChapter(job.chapter, root);
                if (peer && (peer.state === 'completed' || peer.created < job.created || peer.created === job.created && peer.id < job.id))
                    store.update(job.id, { state: 'cancelled', error: `Already available or queued from ${peer.source}. Existing chapter files were kept.` });
            }
        }
        return { merged, linked };
    });
}
