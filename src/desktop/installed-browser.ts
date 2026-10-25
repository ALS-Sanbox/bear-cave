import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpPipe, type CdpConnection } from './cdp-pipe.js';
import { SourceError } from '../shared/types.js';
import { assertPublicHost } from '../sources/session-http.js';
import { Gate, validateUrl, type RequestOptions } from '../sources/http.js';
export async function findInstalledBrowser() {
    const candidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')] : []),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe')
    ];
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        }
        catch { /* Try the next normal installation location. */ }
    }
    throw new SourceError('Install Chrome or Microsoft Edge to use the installed-browser source connection.', 'action_required');
}
export interface OwnedBrowser {
    client: CdpConnection;
    stop: () => Promise<void>;
}
export async function launchInstalledBrowser(profile: string): Promise<OwnedBrowser> {
    const executable = await findInstalledBrowser();
    await mkdir(profile, { recursive: true });
    const child: ChildProcess = spawn(executable, ['--user-data-dir=' + path.resolve(profile), '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--new-window', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    const client = new CdpPipe(child.stdio[3] as Writable, child.stdio[4] as Readable);
    let exited = false;
    const exit = new Promise<void>(resolve => { child.once('exit', () => { exited = true; client.close(); resolve(); }); child.once('error', () => { exited = true; client.close(); resolve(); }); });
    const stop = async () => {
        if (!exited)
            await Promise.race([client.send('Browser.close').catch(() => { }), delay(1000)]);
        if (!exited)
            await Promise.race([exit, delay(4000)]);
        if (!exited) {
            child.kill();
            await Promise.race([exit, delay(2000)]);
        }
        client.close();
    };
    try {
        await client.send('Browser.getVersion');
    }
    catch {
        await stop();
        throw new SourceError('Could not connect to the dedicated source browser. Close its old source window, then retry.', 'action_required');
    }
    return { client, stop };
}
export class InstalledBrowser {
    private owned?: OwnedBrowser;
    private starting?: Promise<void>;
    private session = '';
    private target = '';
    private busy = false;
    private stopped = new AbortController();
    private gate = new Gate(1100);
    private allowed: Set<string>;
    private sourceHosts: string[];
    private observed = new Set<string>();
    private imageSession = '';
    private imageWaiter?: {
        urls: Set<string>;
        requests: Set<string>;
        resolve: (response: {
            id: string;
            status: number;
            headers: {
                name: string;
                value: string;
            }[];
            handle?: string;
        }) => void;
        reject: (error: Error) => void;
    };
    private navigationStatus = 0;
    private pendingNavigation = '';
    private mainFrame = '';
    private requestCount = 0;
    constructor(private profile: string, readonly imageHosts: string[], private options: {
        launch?: (profile: string) => Promise<OwnedBrowser>;
        guard?: (url: URL) => Promise<void>;
        attention?: () => void;
    } = {}) {
        this.sourceHosts = ['www.toongod.org', 'toongod.org'];
        this.allowed = new Set([...this.sourceHosts, ...imageHosts, 'challenges.cloudflare.com', '*.challenges.cloudflare.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
    }
    private async guard(input: string, hosts = [...this.allowed]) {
        const url = validateUrl(input, hosts);
        await (this.options.guard ?? assertPublicHost)(url);
        return url;
    }
    private async start() {
        this.stopped.signal.throwIfAborted();
        if (this.starting)
            return this.starting;
        if (this.owned && (this.owned.client.closed || !this.session)) {
            const old = this.owned;
            this.owned = undefined;
            this.imageSession = '';
            await old.stop();
        }
        if (this.owned)
            return;
        if (!this.starting)
            this.starting = (async () => {
                const owned = await (this.options.launch ?? launchInstalledBrowser)(this.profile);
                if (this.stopped.signal.aborted) {
                    await owned.stop();
                    this.stopped.signal.throwIfAborted();
                }
                this.owned = owned;
            this.pendingNavigation = '';
                const { client } = owned;
                const created = await client.send('Target.createTarget', { url: 'about:blank' });
                this.target = created.targetId;
                const attached = await client.send('Target.attachToTarget', { targetId: this.target, flatten: true });
                this.session = attached.sessionId;
                client.onEvent((method, params, session) => {
                    if (method === 'Target.detachedFromTarget' && params.sessionId === this.session)
                        this.session = '';
                    if (method === 'Target.detachedFromTarget' && params.sessionId === this.imageSession) {
                        this.imageSession = '';
                        this.imageWaiter?.reject(Error('Source image tab closed.'));
                    }
                    if (session === this.imageSession && method === 'Fetch.requestPaused') {
                        void this.imageRequest(params);
                        return;
                    }
                    if (session !== this.session)
                        return;
                    if (method === 'Fetch.requestPaused')
                        void this.request(params);
                    if (method === 'Network.responseReceived' && params.type === 'Document' && (!this.mainFrame || params.frameId === this.mainFrame))
                        this.navigationStatus = params.response.status;
                });
                await this.call('Page.enable');
                await this.call('Network.enable');
                await this.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
            })().catch(async (e) => { const owned = this.owned; this.owned = undefined; this.imageSession = ''; await owned?.stop(); throw e; }).finally(() => { this.starting = undefined; });
        await this.starting;
    }
    private async request(event: any, imageDocument = false) {
        const client = this.owned?.client, session = imageDocument ? this.imageSession : this.session;
        if (!client)
            return;
        try {
            if (++this.requestCount > 10000)
                throw Error('Source request limit reached.');
            const raw = new URL(event.request.url);
            if ((event.resourceType === 'Image' || imageDocument) && raw.protocol === 'https:') {
                await this.guard(raw.href, [raw.hostname]);
                if (!this.allowed.has(raw.hostname) && this.observed.size < 100) {
                    this.allowed.add(raw.hostname);
                    this.observed.add(raw.hostname);
                    this.imageHosts.push(raw.hostname);
                }
            }
            await this.guard(event.request.url);
            if (imageDocument && this.imageWaiter?.urls.has(event.request.url))
                this.imageWaiter.requests.add(event.requestId);
            await client.send('Fetch.continueRequest', { requestId: event.requestId }, session);
        }
        catch {
            if (imageDocument)
                this.imageWaiter?.reject(new SourceError('Source image redirected to a blocked destination.'));
            await client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }, session).catch(() => { });
        }
    }
    private call(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
        if (!this.owned)
            return Promise.reject(Error('Installed source browser is closed.'));
        return this.owned.client.send(method, params, this.session, signal);
    }
    private async evaluate<T>(expression: string, signal?: AbortSignal): Promise<T> {
        const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, signal);
        if (result.exceptionDetails)
            throw Error('Source page is not ready.');
        return result.result?.value as T;
    }
    private async lock(signal?: AbortSignal) {
        const combined = AbortSignal.any([this.stopped.signal, ...(signal ? [signal] : [])]);
        while (this.busy)
            await delay(100, undefined, { signal: combined });
        combined.throwIfAborted();
        this.busy = true;
        return combined;
    }
    async open() {
        await this.start();
        await this.call('Page.bringToFront');
        if (!this.busy && !this.pendingNavigation)
            await this.call('Page.navigate', { url: 'https://www.toongod.org/' });
    }
    async html(input: string, hosts: string[], signal?: AbortSignal) {
        await this.guard(input, this.sourceHosts);
        await this.guard(input, hosts);
        const locked = await this.lock(signal);
        const deadline = AbortSignal.any([locked, AbortSignal.timeout(300000)]);
        try {
            await this.start();
            await this.gate.wait(deadline);
            this.navigationStatus = 0;
            this.requestCount = 0;
            // A cancelled search can finish verification later. Retrying must not reload
            // that page and discard the user's progress through another challenge.
            const current = this.pendingNavigation === input ? await this.evaluate<string>('location.href', deadline).catch(() => '') : '';
            if (current !== input) {
                this.pendingNavigation = input;
                const nav = await this.call('Page.navigate', { url: input }, deadline);
                this.mainFrame = nav.frameId ?? '';
                if (nav.errorText)
                    throw new SourceError('ToonGod could not load in the source browser. Check its visible window and retry.', 'action_required');
            }
            const url = new URL(input), search = url.searchParams.has('s'), chapter = /chapter[-\/]/i.test(url.pathname);
            let last = '', stable = 0, clicked = 0, lastClick = 0, notified = false;
            while (!deadline.aborted) {
                if (this.owned?.client.closed || !this.session)
                    throw new SourceError('The dedicated source window was closed. Retry to reopen it.', 'action_required');
                let state: {
                    url: string;
                    challenge: boolean;
                    ready: boolean;
                    signature: string;
                    count: number;
                } | undefined;
                try {
                    state = await this.evaluate(`(()=>{const challenge=/just a moment|attention required|verify you are human/i.test(document.title)||!!document.querySelector('#challenge-form,#challenge-stage');const selector=${JSON.stringify(search ? '.c-tabs-item__content,.bsx,.listupd .bs,.no-results,.search-no-results' : chapter ? '.reading-content img,#readerarea img' : '.wp-manga-chapter a[href],#chapterlist a[href]')};const elements=[...document.querySelectorAll(selector)];return{url:location.href,challenge,ready:elements.length>0,signature:elements.map(e=>e.getAttribute('href')||e.getAttribute('data-src')||e.getAttribute('src')||e.textContent).join('|').slice(0,100000),count:elements.length}})()`, deadline);
                }
                catch (e) {
                    if (deadline.aborted || !this.owned)
                        throw e;
                }
                if (state?.challenge) {
                    if (!notified) {
                        notified = true;
                        this.options.attention?.();
                        await this.call('Page.bringToFront');
                    }
                    // A bounded checkbox attempt in this controlled tab; other challenges remain visible for the user.
                    if (clicked < 3 && Date.now() - lastClick > 4000) {
                        lastClick = Date.now();
                        clicked++;
                        const box = await this.evaluate<number[] | null>(`(()=>{for(const e of document.querySelectorAll('.main-content div')){const r=e.getBoundingClientRect();if(r.width>200&&r.height>55&&r.height<90)return[r.x+30,r.y+r.height/2]}return null})()`, deadline).catch(() => null);
                        if (box) {
                            await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box[0], y: box[1], button: 'left', clickCount: 1 }, deadline);
                            await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box[0], y: box[1], button: 'left', clickCount: 1 }, deadline);
                        }
                    }
                }
                else if (state?.ready) {
                    await this.guard(state.url, this.sourceHosts);
                    if (state.count > 10000)
                        throw new SourceError('ToonGod page exceeds the item limit.');
                    stable = state.signature === last ? stable + 1 : 0;
                    last = state.signature;
                    if (stable >= 3) {
                        const images = await this.evaluate<string[]>(`[...document.images].map(e=>e.getAttribute('data-src')||e.getAttribute('data-lazy-src')||e.src).concat([...document.querySelectorAll('meta[property="og:image"]')].map(e=>e.content))`, deadline);
                        for (const image of images) {
                            try {
                                const u = new URL(image, state.url);
                                await this.guard(u.href, [u.hostname]);
                                if (!this.allowed.has(u.hostname) && this.observed.size < 100) {
                                    this.allowed.add(u.hostname);
                                    this.observed.add(u.hostname);
                                    this.imageHosts.push(u.hostname);
                                }
                            }
                            catch { /* Decorative/invalid images are not admitted. */ }
                        }
                        const html = await this.evaluate<string>('document.documentElement.outerHTML', deadline);
                        if (Buffer.byteLength(html) > 8 * 1024 * 1024)
                            throw new SourceError('ToonGod page exceeds the size limit.');
                        this.pendingNavigation = '';
                        return html;
                    }
                }
                else if ([429, 500, 502, 503, 504].includes(this.navigationStatus))
                    throw new SourceError('ToonGod is temporarily unavailable or rate limiting requests. Wait before retrying.', 'transient');
                await delay(350, undefined, { signal: deadline });
            }
            deadline.throwIfAborted();
            throw Error('Source page did not load.');
        }
        catch (e) {
            if (signal?.aborted || this.stopped.signal.aborted)
                throw e;
            if (deadline.aborted)
                throw new SourceError('ToonGod is waiting for verification in the visible source browser. Complete it there, then retry.', 'action_required');
            if (e instanceof SourceError)
                throw e;
            throw new SourceError('The installed source browser stopped responding. Retry to reconnect.', 'action_required');
        }
        finally {
            this.busy = false;
        }
    }
    private imageCall(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
        if (!this.owned)
            return Promise.reject(Error('Installed source browser is closed.'));
        return this.owned.client.send(method, params, this.imageSession, signal);
    }
    private async startImageTab() {
        if (this.imageSession)
            return;
        const client = this.owned!.client;
        const target = await client.send('Target.createTarget', { url: 'about:blank', background: true });
        const attached = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        this.imageSession = attached.sessionId;
        await this.imageCall('Page.enable');
        await this.imageCall('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }] });
    }
    private async imageRequest(event: any) {
        if (event.responseStatusCode === undefined) {
            await this.request(event, true);
            return;
        }
        const waiter = this.imageWaiter;
        if (!waiter || !waiter.requests.has(event.requestId)) {
            await this.imageCall('Fetch.continueRequest', { requestId: event.requestId }).catch(() => { });
            return;
        }
        const headers: {
            name: string;
            value: string;
        }[] = event.responseHeaders ?? [];
        const status = event.responseStatusCode;
        try {
            if ([301, 302, 303, 307, 308].includes(status)) {
                const location = headers.find(h => h.name.toLowerCase() === 'location')?.value;
                if (!location || waiter.urls.size >= 5)
                    throw new SourceError('Too many source image redirects.');
                const next = new URL(location, event.request.url);
                await this.guard(next.href, [next.hostname]);
                waiter.urls.add(next.href);
                await this.imageCall('Fetch.continueRequest', { requestId: event.requestId });
                return;
            }
            const type = headers.find(h => h.name.toLowerCase() === 'content-type')?.value ?? '';
            const length = Number(headers.find(h => h.name.toLowerCase() === 'content-length')?.value ?? 0);
            if (length > 32 * 1024 * 1024)
                throw new SourceError('Source image exceeds the size limit.');
            if (status !== 200 || !/^image\/(jpe?g|png|webp)(?:\s*;|$)/i.test(type.trim())) {
                await this.imageCall('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' });
                waiter.reject(new SourceError('ToonGod image access failed in the source browser. Check its window and retry.', [401, 403].includes(status) || /text\/html/i.test(type) ? 'action_required' : 'transient'));
                return;
            }
            const stream = await this.imageCall('Fetch.takeResponseBodyAsStream', { requestId: event.requestId });
            if (this.imageWaiter !== waiter) {
                await this.imageCall('IO.close', { handle: stream.stream }).catch(() => { });
                await this.imageCall('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' }).catch(() => { });
                return;
            }
            waiter.resolve({ id: event.requestId, status, headers, handle: stream.stream });
        }
        catch (e) {
            await this.imageCall('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' }).catch(() => { });
            waiter.reject(e as Error);
        }
    }
    async get(input: string, hosts: string[], signal?: AbortSignal, image = false, options: RequestOptions = {}) {
        if (options.bearer || options.form || !image)
            throw new SourceError('Installed browser transport supports public HTML navigation and image GET requests only.');
        await this.guard(input, hosts);
        await this.guard(input, this.imageHosts);
        const referrer = options.referer ? (await this.guard(options.referer, this.sourceHosts)).href : undefined;
        const locked = await this.lock(signal), deadline = AbortSignal.any([locked, AbortSignal.timeout(60000)]);
        let handle: string | undefined, requestId: string | undefined;
        const cancel = () => this.imageWaiter?.reject(deadline.reason);
        try {
            await this.start();
            await this.gate.wait(deadline);
            await this.startImageTab();
            deadline.throwIfAborted();
            const response = new Promise<{
                id: string;
                handle?: string;
            }>((resolve, reject) => { this.imageWaiter = { urls: new Set([input]), requests: new Set(), resolve, reject }; });
            const waiter = this.imageWaiter!;
            deadline.addEventListener('abort', cancel, { once: true });
            void this.imageCall('Page.navigate', { url: input, ...(referrer ? { referrer, referrerPolicy: 'strict-origin-when-cross-origin' } : {}) }, deadline).catch(e => waiter.reject(e));
            const imageResponse = await response;
            requestId = imageResponse.id;
            handle = imageResponse.handle;
            const chunks: Buffer[] = [];
            let size = 0;
            if (!handle)
                throw new SourceError('Source image stream unavailable.');
            for (;;) {
                const part = await this.imageCall('IO.read', { handle, size: 256 * 1024 }, deadline);
                const bytes = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
                size += bytes.length;
                if (size > 32 * 1024 * 1024)
                    throw new SourceError('Source image exceeds the size limit.');
                chunks.push(bytes);
                if (part.eof)
                    break;
            }
            const bytes = Buffer.concat(chunks);
            if (!bytes.length)
                throw new SourceError('Source returned an empty image.');
            return bytes;
        }
        catch (e) {
            if (signal?.aborted || this.stopped.signal.aborted || e instanceof SourceError)
                throw e;
            throw new SourceError('The installed source browser stopped responding. Retry the download to reconnect.', 'action_required');
        }
        finally {
            deadline.removeEventListener('abort', cancel);
            this.imageWaiter = undefined;
            if (handle)
                await this.imageCall('IO.close', { handle }).catch(() => { });
            if (requestId)
                await this.imageCall('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => { });
            await this.imageCall('Page.stopLoading').catch(() => { });
            this.busy = false;
        }
    }
    async close() {
        this.stopped.abort();
        await this.starting?.catch(() => { });
        const owned = this.owned;
        this.owned = undefined;
        await owned?.stop();
    }
}
