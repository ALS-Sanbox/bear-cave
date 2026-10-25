import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, realpath, rm } from 'node:fs/promises';
import { createArchive, verifyArchive, validManifest, validPage, MAX_PAGE_BYTES, MAX_PAGES, type Manifest, type PageRecord } from './archive.js';
import { seriesDirectory, checkPath } from './folders.js';
import type { Store } from '../core/store.js';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { Job, Series } from '../shared/types.js';
export function safeName(value: string, max = 55): string {
    let s = value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').trim();
    if (!s || s === '.' || s === '..')
        s = 'Untitled';
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s))
        s = `_${s}`;
    return s.slice(0, max).replace(/[. ]+$/g, '') || 'Untitled';
}
export function contained(root: string, ...parts: string[]): string {
    const result = path.resolve(root, ...parts), rel = path.relative(root, result);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
        throw Error('Unsafe output path');
    if (result.length > 245)
        throw Error('Download path is too long. Choose a shorter download root.');
    return result;
}
export async function noLink(file: string) {
    try {
        if ((await lstat(file)).isSymbolicLink())
            throw Error('Symbolic links and junctions are not allowed in download paths.');
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
    }
}
export function digest(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
}
export async function saveCover(root: string, title: string, bytes: Uint8Array, signal?: AbortSignal, series?: Series, store?: Store) {
    if (bytes.byteLength > MAX_PAGE_BYTES)
        throw Error('Cover exceeds image size limit');
    imageExtension(bytes);
    const dir = series ? await seriesDirectory(root, series, store) : contained(await realpath(root), safeName(title, 65));
    await noLink(dir);
    await mkdir(dir, { recursive: true });
    const file = contained(dir, 'coverart.png'), temp = contained(dir, `.coverart-${randomUUID()}.part`);
    await noLink(file);
    const png = await sharp(Buffer.from(bytes), { limitInputPixels: 40000000 }).rotate().png().toBuffer();
    signal?.throwIfAborted();
    try {
        await writeFile(temp, png, { flag: 'wx' });
        signal?.throwIfAborted();
        await noLink(file);
        await rename(temp, file);
    }
    finally {
        await rm(temp, { force: true });
    }
    return file;
}
export function chapterNumber(value: string): string {
    return /^\d+(?:\.\d+)?$/.test(value) ? value.replace(/^\d+/, n => n.replace(/^0+(?=\d)/, '').padStart(3, '0')) : safeName(value, 20);
}
function fileId(value: string) {
    return /^[a-f0-9-]{36}$/i.test(value) ? value.toLowerCase() : digest(Buffer.from(value)).slice(0, 32);
}
export function imageExtension(data: Uint8Array): string {
    const b = Buffer.from(data);
    if (b.length >= 12 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.subarray(-8, -4).toString() === 'IEND')
        return 'png';
    if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217)
        return 'jpg';
    if (b.length >= 16 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length)
        return 'webp';
    throw Error('Downloaded page is not a complete PNG, JPEG or WebP image.');
}
export class ChapterOutput {
    private dir = '';
    private final = '';
    private stage = '';
    private manifest!: Manifest;
    constructor(private job: Job, private store?: Store) {
    }
    async open(revision: string, count: number, identities?: string[]) {
        if (count < 1 || count > MAX_PAGES || identities && identities.length !== count)
            throw Error('Invalid chapter page count');
        const root = await realpath(this.job.root);
        this.dir = await seriesDirectory(root, this.job.series, this.store);
        await checkPath(root, this.dir);
        await mkdir(this.dir, { recursive: true });
        this.job.seriesFolder = this.dir;
        if (this.store)
            this.store.update(this.job.id, { seriesFolder: this.dir });
        const metadata = contained(this.dir, '.bear-cave');
        await noLink(metadata);
        await mkdir(metadata, { recursive: true });
        const identity = `${this.job.source}:${this.job.chapter.id}`;
        const base = `${safeName(path.basename(this.dir), 65)} ${chapterNumber(this.job.chapter.number)}${this.job.copySuffix ?? ''}`;
        let stem = base;
        // Atomically claim a readable filename so translations and cross-source duplicates never overwrite each other.
        for (let attempt = 0; attempt < 2; attempt++) {
            const claim = contained(metadata, `${digest(Buffer.from(stem)).slice(0, 32)}.json`);
            await noLink(claim);
            try {
                await writeFile(claim, JSON.stringify(identity), { flag: 'wx' });
                break;
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                    throw e;
            }
            if (JSON.parse(await readFile(claim, 'utf8')) === identity)
                break;
            if (attempt === 1)
                throw Error('Chapter filename conflicts with another download.');
            stem = `${base} [${this.job.source}-${digest(Buffer.from(identity)).slice(0, 8)}]`;
        }
        this.final = contained(this.dir, stem + (this.job.format === 'cbz' ? '.cbz' : ''));
        this.stage = contained(metadata, `${fileId(identity + (this.job.copySuffix ?? ''))}.incomplete`);
        await noLink(this.stage);
        await noLink(this.final);
        await mkdir(this.stage, { recursive: true });
        const manifestFile = contained(this.stage, 'manifest.json');
        await noLink(manifestFile);
        try {
            if ((await lstat(manifestFile)).size <= 1024 * 1024)
                this.manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest;
        }
        catch { /* Missing or torn manifest is safely regenerated. */
        }
        if (!this.manifest || ![1, 2].includes(this.manifest.version) || this.manifest.chapter !== this.job.chapter.id || this.manifest.revision !== revision || !Array.isArray(this.manifest.pages) || this.manifest.pages.length !== count || this.manifest.version === 2 && JSON.stringify(this.manifest.identities) !== JSON.stringify(identities))
            this.manifest = {
                version: 2, chapter: this.job.chapter.id, source: this.job.source, series: this.job.series.id, revision, identities, pages: Array.from({ length: count }, () => null)
            };
        else
            this.manifest = {
                ...this.manifest, version: 2, identities, source: this.job.source, series: this.job.series.id
            };
        this.manifest.finalName = path.basename(this.final);
        await this.save();
    }
    private async save() {
        const temp = contained(this.stage, 'manifest.json.part');
        await noLink(temp);
        await noLink(contained(this.stage, 'manifest.json'));
        await writeFile(temp, JSON.stringify(this.manifest));
        await rename(temp, contained(this.stage, 'manifest.json'));
    }
    async recoverFinal(signal?: AbortSignal): Promise<{
        file: string;
        count: number;
    } | undefined> {
        try {
            await noLink(this.final);
            await lstat(this.final);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return;
            throw e;
        }
        let saved: Manifest;
        if (this.job.format === 'cbz')
            saved = await verifyArchive(this.final, undefined, signal);
        else {
            const { verifyOutput } = await import('./verification.js');
            const result = await verifyOutput({ ...this.job, output: this.final }, signal);
            if (result.state !== 'verified')
                throw Error('Existing chapter folder could not be verified; it has been kept.');
            const metadata = contained(this.final, 'manifest.json');
            await noLink(metadata);
            saved = validManifest(JSON.parse(await readFile(metadata, 'utf8')));
        }
        if (saved.chapter !== this.job.chapter.id || saved.source && saved.source !== this.job.source || saved.series && saved.series !== this.job.series.id)
            throw Error('Existing output belongs to another chapter; it has been kept.');
        signal?.throwIfAborted();
        return { file: this.final, count: saved.pages.length };
    }
    private validRecord(p: PageRecord): boolean {
        return validPage(p);
    }
    async has(index: number) {
        const p = this.manifest.pages[index];
        if (!p || !this.validRecord(p))
            return false;
        try {
            const file = contained(this.stage, p.name);
            await noLink(file);
            if ((await lstat(file)).size > MAX_PAGE_BYTES)
                return false;
            const b = await readFile(file);
            imageExtension(b);
            return b.length === p.size && digest(b) === p.hash;
        }
        catch {
            return false;
        }
    }
    async page(index: number, bytes: Buffer) {
        if (bytes.length > MAX_PAGE_BYTES)
            throw Error('Image exceeds 32 MiB limit');
        const ext = imageExtension(bytes), name = `${String(index + 1).padStart(5, '0')}.${ext}`;
        const file = contained(this.stage, name), temp = file + '.part';
        await noLink(temp);
        await noLink(file);
        await writeFile(temp, bytes);
        await rename(temp, file);
        this.manifest.pages[index] = {
            name, hash: digest(bytes), size: bytes.length
        };
        await this.save();
    }
    async finish(signal?: AbortSignal): Promise<string> {
        for (let i = 0; i < this.manifest.pages.length; i++) {
            signal?.throwIfAborted();
            if (!await this.has(i))
                throw Error('Chapter output failed page validation.');
        }
        await noLink(this.final);
        if (this.job.format === 'folders') {
            // Existing output is never silently overwritten; crash-after-rename recovery validates it.
            try {
                await lstat(this.final);
                await this.validateFolder(signal);
                return this.final;
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
            signal?.throwIfAborted();
            await rename(this.stage, this.final);
            await this.validateFolder(signal);
        }
        else {
            try {
                await lstat(this.final);
                await this.validateZip(this.final, signal);
                return this.final;
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
            const temp = this.final + '.part';
            await noLink(temp);
            await createArchive(temp, this.stage, this.manifest, signal);
            await verifyArchive(temp, this.manifest, signal);
            signal?.throwIfAborted();
            await rename(temp, this.final);
            await rm(this.stage, { recursive: true, force: true });
        }
        return this.final;
    }
    private async validateZip(file: string, signal?: AbortSignal) {
        await verifyArchive(file, this.manifest, signal);
    }
    private async validateFolder(signal?: AbortSignal) {
        const metadata = contained(this.final, 'manifest.json');
        await noLink(metadata);
        if ((await lstat(metadata)).size > 1024 * 1024)
            throw Error('Manifest exceeds size limit');
        const saved = validManifest(JSON.parse(await readFile(metadata, 'utf8')) as Manifest);
        if (saved.chapter !== this.manifest.chapter || saved.revision !== this.manifest.revision || JSON.stringify(saved.pages) !== JSON.stringify(this.manifest.pages))
            throw Error('Existing folder conflicts with this chapter.');
        for (const p of saved.pages) {
            signal?.throwIfAborted();
            if (!p || !this.validRecord(p))
                throw Error('Invalid output manifest');
            const file = contained(this.final, p.name);
            await noLink(file);
            if ((await lstat(file)).size > MAX_PAGE_BYTES)
                throw Error('Page size limit');
            const bytes = await readFile(file);
            if (digest(bytes) !== p.hash)
                throw Error('Output page checksum failed');
            imageExtension(bytes);
        }
    }
}
