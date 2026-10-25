import { setTimeout as delay } from 'node:timers/promises';
import { lookup } from 'node:dns/promises';
import { Gate, publicIPv4, retryAfter, validateUrl, type RequestOptions } from './http.js';
import { SourceError } from '../shared/types.js';
export async function assertPublicHost(url: URL) {
    const records = await lookup(url.hostname, { all: true, family: 4 });
    if (!records.length || records.some(r => !publicIPv4(r.address)))
        throw new SourceError('Source DNS resolved to a blocked address.');
}
export type SessionFetch = (input: string, init: RequestInit) => Promise<Response>;
// Uses a real, source-isolated Chromium session. Never transfers clearance cookies to Node.
export class SessionHttp {
    private gate: Gate;
    constructor(private fetch: SessionFetch, private guard: (url: URL) => Promise<void> = assertPublicHost, interval = 1100) {
        this.gate = new Gate(interval);
    }
    async html(url: string, hosts: string[], signal?: AbortSignal, _cookies?: RequestOptions['cookies']) {
        return (await this.get(url, hosts, signal, false, { html: true })).toString('utf8');
    }
    async get(url: string, hosts: string[], signal?: AbortSignal, image = false, options: RequestOptions = {}) {
        if (options.bearer || options.form)
            throw new SourceError('Source session transport only supports public GET requests.');
        for (let attempt = 0;; attempt++) {
            try {
                return await this.request(url, hosts, signal, image, options);
            }
            catch (e) {
                if (!signal?.aborted && e instanceof Error && ['AbortError', 'TimeoutError'].includes(e.name))
                    e = new SourceError('Source browser request timed out. Check the local source window and retry.', 'transient');
                if (signal?.aborted || !(e instanceof SourceError) || e.kind !== 'transient' || attempt >= 2)
                    throw e;
                await delay(Math.max(e.retryAfterMs, 1000 * 2 ** attempt), undefined, { signal });
            }
        }
    }
    private async request(input: string, hosts: string[], signal: AbortSignal | undefined, image: boolean, options: RequestOptions): Promise<Buffer> {
        const deadline = AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]);
        let url = validateUrl(input, hosts);
        for (let redirects = 0;; redirects++) {
            deadline.throwIfAborted();
            await this.gate.wait(deadline);
            await this.guard(url);
            const headers: Record<string, string> = { Accept: image ? 'image/*' : options.html ? 'text/html' : 'application/json' };
            if (options.referer) {
                validateUrl(options.referer, hosts);
                headers.Referer = options.referer;
            }
            let response: Response;
            try {
                response = await this.fetch(url.href, {
                    method: 'GET', headers, credentials: 'include', redirect: 'manual', cache: image ? 'default' : 'no-store', signal: deadline
                });
            }
            catch (e) {
                if (deadline.aborted)
                    throw e;
                throw new SourceError('Source browser session request failed. Open the local source window and check connectivity.', 'transient');
            }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (!location || redirects >= 4)
                    throw new SourceError('Too many source redirects.');
                url = validateUrl(new URL(location, url).href, hosts);
                continue;
            }
            const max = image ? 32 * 1024 * 1024 : 8 * 1024 * 1024, reader = response.body?.getReader(), chunks: Buffer[] = [];
            let size = 0;
            try {
                if (reader)
                    for (;;) {
                        deadline.throwIfAborted();
                        const next = await reader.read();
                        if (next.done)
                            break;
                        size += next.value.byteLength;
                        if (size > max)
                            throw new SourceError('Source response exceeds size limit.');
                        chunks.push(Buffer.from(next.value));
                    }
            }
            catch (e) {
                await reader?.cancel().catch(() => {
                });
                throw e;
            }
            finally {
                reader?.releaseLock();
            }
            const bytes = Buffer.concat(chunks), type = response.headers.get('content-type') ?? '';
            if ([401, 403].includes(response.status) || /cf-chl-|challenge-platform|<title>[^<]*(just a moment|attention required)/i.test(bytes.subarray(0, 20000).toString()) || image && /text\/html/i.test(type))
                throw new SourceError('Source denied this request in its saved browser session. Complete any check in the local Source window, confirm search works there, then retry. A new challenge cannot be cleared automatically.', 'action_required');
            if ([429, 503].includes(response.status)) {
                const ms = Math.max(retryAfter(response.headers.get('retry-after') ?? undefined), 5000);
                this.gate.block(ms);
                throw new SourceError('Source is rate limiting requests. Wait before retrying.', 'transient', ms);
            }
            if (response.status >= 500)
                throw new SourceError('Source is temporarily unavailable.', 'transient');
            if (response.status !== 200)
                throw new SourceError(`Source returned HTTP ${response.status}.`);
            if (image && !/^image\/(jpeg|png|webp)/i.test(type))
                throw new SourceError('Source did not return a supported image.');
            return bytes;
        }
    }
}
