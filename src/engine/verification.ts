import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { verifyArchive, validManifest, MAX_PAGE_BYTES, type Manifest } from './archive.js';
import { digest, noLink, contained, imageExtension } from './files.js';
import { checkPath, seriesDirectory } from './folders.js';
import type { Job } from '../shared/types.js';
import type { Store } from '../core/store.js';
export async function verifyOutput(job: Job, signal?: AbortSignal): Promise<NonNullable<Job['verification']>> {
    let state: NonNullable<Job['verification']>['state'] = 'verified';
    try {
        const root = await realpath(job.root);
        if (!job.output) {
            state = 'missing';
            return { state, checked: new Date().toISOString() };
        }
        await checkPath(root, job.output);
        let info;
        try {
            info = await lstat(job.output);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return { state: 'missing', checked: new Date().toISOString() };
            throw e;
        }
        let m: Manifest;
        if (info.isDirectory()) {
            const file = contained(job.output, 'manifest.json');
            await noLink(file);
            if ((await lstat(file)).size > 1024 * 1024)
                throw Error('Manifest too large');
            m = validManifest(JSON.parse(await readFile(file, 'utf8')));
            const names = await readdir(job.output);
            if (names.length !== m.pages.length + 1)
                throw Error('Unexpected folder contents');
            for (const p of m.pages) {
                signal?.throwIfAborted();
                const file = contained(job.output, p!.name);
                await noLink(file);
                const size = (await lstat(file)).size;
                if (size > MAX_PAGE_BYTES || size !== p!.size)
                    throw Error('Invalid page size');
                const bytes = await readFile(file);
                if (digest(bytes) !== p!.hash)
                    throw Error('Page checksum mismatch');
                imageExtension(bytes);
            }
        }
        else
            m = await verifyArchive(job.output, undefined, signal);
        if (m.chapter !== job.chapter.id)
            throw Error('Output belongs to another chapter');
    }
    catch (e) {
        if (signal?.aborted)
            throw e;
        const code = (e as NodeJS.ErrnoException).code;
        const storageExists = await realpath(job.root).then(() => true, () => false);
        state = !storageExists || ['EACCES', 'EPERM', 'EBUSY', 'EIO', 'ENODEV', 'ENOTDIR'].includes(code ?? '') || /junction|Unsafe output path/.test((e as Error).message) ? 'inaccessible' : 'damaged';
    }
    return { state, checked: new Date().toISOString() };
}
export async function redownload(store: Store, id: string, mode: 'missing' | 'copy', signal?: AbortSignal) {
    if (store.maintenanceActive)
        throw Error('Local maintenance is running. Try again shortly.');
    const job = store.job(id);
    if (!job || job.state !== 'completed')
        throw Error('Choose a completed chapter.');
    const verification = await verifyOutput(job, signal);
    signal?.throwIfAborted();
    store.update(id, { verification });
    if (mode === 'missing' && verification.state !== 'missing')
        throw Error('Existing output requires the separate-copy choice.');
    if (verification.state === 'inaccessible')
        throw Error('Storage is inaccessible. Reconnect it before downloading again.');
    const seriesFolder = await seriesDirectory(job.root, job.series, store);
    signal?.throwIfAborted();
    if (store.maintenanceActive)
        throw Error('Local maintenance is running. Try again shortly.');
    return store.update(id, {
        state: 'queued', seriesFolder, done: 0, error: null, output: null, verification: undefined, copySuffix: mode === 'copy' ? ` [copy ${Date.now()}]` : job.copySuffix, previousOutputs: [...(job.previousOutputs ?? []), ...(job.output && verification.state !== 'missing' ? [job.output] : [])]
    });
}
