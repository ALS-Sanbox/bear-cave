import path from 'node:path';
import { mkdir, realpath, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Settings } from '../shared/types.js';
export const settingsSchema = z.object({
    downloadRoot: z.string().min(3).max(220), format: z.enum(['folders', 'cbz']),
    globalChapters: z.number().int().min(1).max(8), sourceChapters: z.record(z.string().regex(/^[a-z0-9-]+$/), z.number().int().min(1).max(4)),
    pageRequests: z.number().int().min(1).max(3), port: z.number().int().min(1024).max(65535),
    startWithWindows: z.boolean(), publicUrl: z.string().max(200), trustTunnel: z.boolean()
}).strict().superRefine((s, ctx) => {
    if (s.publicUrl) {
        try {
            const u = new URL(s.publicUrl);
            if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash || !u.hostname.includes('.') || /localhost|^\d+[.]/i.test(u.hostname))
                throw Error();
        }
        catch {
            ctx.addIssue({ code: 'custom', message: 'Public URL must be an HTTPS origin, e.g. https://bearcave.lionhosting.net' });
        }
    }
    if (s.trustTunnel && !s.publicUrl)
        ctx.addIssue({ code: 'custom', message: 'Tunnel trust requires an explicit public URL' });
}).transform(s => ({ ...s, publicUrl: s.publicUrl ? new URL(s.publicUrl).origin : '' }));
export function defaults(root: string): Settings {
    return {
        downloadRoot: root, format: 'cbz', globalChapters: 2, sourceChapters: { mangadex: 1 }, pageRequests: 1, port: 43110, startWithWindows: false, publicUrl: '', trustTunnel: false
    };
}
export async function validateRoot(root: string, forbidden: string[]): Promise<string> {
    if (!path.isAbsolute(root) || root.startsWith('\\\\') || root.startsWith('//'))
        throw Error('Choose an absolute local folder, not a network share.');
    const requested = path.resolve(root);
    const within = (a: string, b: string) => {
        const r = path.relative(b, a);
        return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
    };
    if (forbidden.some(f => within(requested, path.resolve(f))))
        throw Error('Downloads must be outside application resources and repository.');
    await mkdir(requested, { recursive: true });
    const canonical = await realpath(requested);
    const canonicalForbidden = await Promise.all(forbidden.map(async (f) => {
        try {
            return await realpath(f);
        }
        catch {
            return path.resolve(f);
        }
    }));
    if (canonicalForbidden.some(f => within(canonical, f)))
        throw Error('Download folder resolves inside application resources.');
    const probe = path.join(canonical, `.bear-cave-write-${randomUUID()}`);
    await writeFile(probe, '', { flag: 'wx' });
    await unlink(probe);
    return canonical;
}
