import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createInflateRaw } from 'node:zlib';
import { Zip, ZipPassThrough } from 'fflate';
import path from 'node:path';
export const MAX_PAGE_BYTES = 32 * 1024 * 1024, MAX_PAGES = 2000, MAX_ARCHIVE_BYTES = 0xffff0000;
export interface PageRecord {
    name: string;
    hash: string;
    size: number;
}
export interface Manifest {
    version: 1 | 2;
    chapter: string;
    source?: string;
    series?: string;
    revision: string;
    identities?: string[];
    finalName?: string;
    pages: (PageRecord | null)[];
}
export function validPage(p: PageRecord) {
    return /^\d{5}\.(png|jpg|webp)$/.test(p.name) && /^[a-f0-9]{64}$/.test(p.hash) && p.size > 0 && p.size <= MAX_PAGE_BYTES;
}
export function validManifest(m: Manifest) {
    if (!m || ![1, 2].includes(m.version) || typeof m.chapter !== 'string' || typeof m.revision !== 'string' || !Array.isArray(m.pages) || !m.pages.length || m.pages.length > MAX_PAGES || m.pages.some((p, i) => !p || !validPage(p) || !p.name.startsWith(String(i + 1).padStart(5, '0') + '.')))
        throw Error('Invalid chapter manifest');
    return m;
}
// Stored ZIP entries stream through bounded chunks; no chapter-wide buffers or synchronous compression.
export async function createArchive(file: string, dir: string, manifest: Manifest, signal?: AbortSignal) {
    const output = createWriteStream(file);
    let blocked = false, error: Error | undefined, total = 0;
    output.on('error', e => {
        error = e;
    });
    const zip = new Zip((e, data, final) => {
        if (e) {
            error = e;
            output.destroy(e);
            return;
        }
        total += data.length;
        if (total > MAX_ARCHIVE_BYTES) {
            error = Error('Archive exceeds ZIP32 safety limit (4 GiB). Use image folders.');
            output.destroy(error);
            return;
        }
        if (!output.write(data))
            blocked = true;
        if (final)
            output.end();
    });
    const flush = async () => {
        signal?.throwIfAborted();
        if (error)
            throw error;
        if (blocked && !output.destroyed) {
            await once(output, 'drain', { signal });
            blocked = false;
        }
        if (error)
            throw error;
    };
    try {
        for (const p of validManifest(manifest).pages) {
            signal?.throwIfAborted();
            const entry = new ZipPassThrough(p!.name);
            zip.add(entry);
            for await (const chunk of createReadStream(path.join(dir, p!.name), { highWaterMark: 64 * 1024, signal })) {
                entry.push(chunk, false);
                await flush();
            }
            entry.push(new Uint8Array(), true);
            await flush();
        }
        const meta = new ZipPassThrough('bear-cave.json');
        zip.add(meta);
        meta.push(Buffer.from(JSON.stringify(manifest)), true);
        await flush();
        zip.end();
        await once(output, 'close', { signal });
        if (error)
            throw error;
        signal?.throwIfAborted();
    }
    catch (e) {
        output.destroy();
        if (!output.closed)
            await new Promise<void>(resolve => output.once('close', () => resolve()));
        throw e;
    }
}
// Read the bounded central directory, then stream each entry separately (stored or legacy deflated ZIP).
export async function verifyArchive(file: string, expected?: Manifest, signal?: AbortSignal): Promise<Manifest> {
    const handle = await open(file, 'r');
    try {
        const size = (await handle.stat()).size;
        if (size < 22 || size > MAX_ARCHIVE_BYTES)
            throw Error('Invalid archive size');
        const tail = Buffer.alloc(Math.min(size, 65557));
        await handle.read(tail, 0, tail.length, size - tail.length);
        let end = -1;
        for (let i = tail.length - 22; i >= 0; i--)
            if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
                end = i;
                break;
            }
        if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6))
            throw Error('Invalid ZIP directory');
        const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
        if (count < 2 || count > MAX_PAGES + 1 || length > 1024 * 1024 || offset + length !== size - tail.length + end)
            throw Error('Invalid ZIP entry limits');
        const directory = Buffer.alloc(length);
        await handle.read(directory, 0, length, offset);
        const entries: {
            name: string;
            method: number;
            packed: number;
            size: number;
            offset: number;
            crc: number;
        }[] = [];
        let cursor = 0;
        for (let i = 0; i < count; i++) {
            signal?.throwIfAborted();
            if (cursor + 46 > length || directory.readUInt32LE(cursor) !== 0x02014b50)
                throw Error('Invalid ZIP entry');
            const n = directory.readUInt16LE(cursor + 28), extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32), name = directory.toString('utf8', cursor + 46, cursor + 46 + n), flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10), entrySize = directory.readUInt32LE(cursor + 24);
            if (flags & 1 || ![0, 8].includes(method) || directory.readUInt32LE(cursor + 20) > MAX_PAGE_BYTES + 1024 * 1024 || (!/^\d{5}\.(png|jpg|webp)$/.test(name) && name !== 'bear-cave.json') || entries.some(e => e.name === name) || entrySize > (name === 'bear-cave.json' ? 1024 * 1024 : MAX_PAGE_BYTES))
                throw Error('Unsafe archive entry');
            entries.push({
                name, method, packed: directory.readUInt32LE(cursor + 20), size: entrySize, offset: directory.readUInt32LE(cursor + 42), crc: directory.readUInt32LE(cursor + 16)
            });
            cursor += 46 + n + extra + comment;
        }
        if (cursor !== length)
            throw Error('Invalid ZIP directory length');
        const results = new Map<string, {
            hash: string;
            size: number;
            bytes?: Buffer;
        }>();
        let previousEnd = 0;
        for (const e of entries) {
            signal?.throwIfAborted();
            const local = Buffer.alloc(30);
            if (e.offset < previousEnd || e.offset + 30 > offset)
                throw Error('Overlapping archive entries');
            await handle.read(local, 0, 30, e.offset);
            if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== e.method)
                throw Error('Invalid local ZIP entry');
            const nameLength = local.readUInt16LE(26), extra = local.readUInt16LE(28), name = Buffer.alloc(nameLength);
            await handle.read(name, 0, nameLength, e.offset + 30);
            if (name.toString() !== e.name)
                throw Error('ZIP filenames disagree');
            const start = e.offset + 30 + nameLength + extra;
            previousEnd = start + e.packed;
            if (previousEnd > offset || !e.packed)
                throw Error('Invalid ZIP entry range');
            const input = createReadStream(file, {
                start, end: previousEnd - 1, highWaterMark: 64 * 1024, signal
            });
            const stream = e.method === 8 ? input.pipe(createInflateRaw()) : input;
            input.on('error', error => stream.destroy(error));
            const hash = createHash('sha256'), chunks: Buffer[] = [];
            let bytes = 0, crc = 0xffffffff;
            try {
                for await (const data of stream) {
                    signal?.throwIfAborted();
                    const chunk = Buffer.from(data);
                    bytes += chunk.length;
                    if (bytes > e.size || bytes > MAX_PAGE_BYTES)
                        throw Error('Archive expansion exceeds limit');
                    hash.update(chunk);
                    crc = crcUpdate(crc, chunk);
                    if (e.name === 'bear-cave.json')
                        chunks.push(chunk);
                }
            }
            finally {
                input.destroy();
                stream.destroy();
                if (!input.closed)
                    await new Promise<void>(resolve => input.once('close', () => resolve()));
            }
            if (bytes !== e.size || ((crc ^ 0xffffffff) >>> 0) !== e.crc)
                throw Error('Archive CRC or length mismatch');
            results.set(e.name, {
                hash: hash.digest('hex'), size: bytes, bytes: chunks.length ? Buffer.concat(chunks) : undefined
            });
        }
        const m = validManifest(JSON.parse(results.get('bear-cave.json')?.bytes?.toString() ?? 'null'));
        if (entries.length !== m.pages.length + 1 || entries.slice(0, -1).some((e, i) => e.name !== m.pages[i]!.name) || entries.at(-1)!.name !== 'bear-cave.json')
            throw Error('Archive entries do not match manifest order');
        if (expected && (m.chapter !== expected.chapter || m.revision !== expected.revision || JSON.stringify(m.pages) !== JSON.stringify(expected.pages)))
            throw Error('Existing output has conflicting metadata.');
        for (const p of m.pages) {
            const actual = results.get(p!.name);
            if (!actual || actual.size !== p!.size || actual.hash !== p!.hash)
                throw Error('Archive checksum mismatch');
        }
        return m;
    }
    finally {
        await handle.close();
    }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++)
        n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});
function crcUpdate(crc: number, bytes: Uint8Array) {
    for (const b of bytes)
        crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return crc;
}
