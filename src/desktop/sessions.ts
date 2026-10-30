import { renderSource, type RenderMode } from './rendered-source.js';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionHttp, assertPublicHost } from '../sources/session-http.js';
import path from 'node:path';
import { app } from 'electron';
import { InstalledBrowser } from './installed-browser.js';
import { BrowserAssistedTransport } from '../sources/browser-assisted.js';
import { BrowserWindow, session } from 'electron';
import type { SourceAdapter } from '../shared/types.js';
import { SafeHttp, validateUrl } from '../sources/http.js';
export class BrowserSessions {
    private installed = new Map<string, InstalledBrowser>();
    private renders = new Set<BrowserWindow>();
    private rendering = new Set<string>();
    private renderWindows = new Map<string, {
        window: BrowserWindow;
        mode: RenderMode;
        idle?: ReturnType<typeof setTimeout>;
    }>();
    private stopped = new AbortController();
    private dynamicImages = new Map<string, string[]>();
    private guarded = new Map<string, Set<string>>();
    constructor(private checkHost: (url: URL) => Promise<void> = assertPublicHost) {
    }
    private prepare(source: string, hosts: string[]) {
        if (!/^[a-z][a-z0-9-]{0,29}$/.test(source))
            throw Error('Invalid source session.');
        const partition = session.fromPartition(`persist:source-${source}`);
        const allowed = this.guarded.get(source) ?? new Set<string>();
        hosts.forEach(h => allowed.add(h));
        if (!this.guarded.has(source)) {
            this.guarded.set(source, allowed);
            partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
            partition.webRequest.onBeforeRequest((details, callback) => {
                void (async () => {
                    try {
                        const dynamic = this.dynamicImages.get(source);
                        if (dynamic && details.resourceType === 'image' && [...this.renders].some(w => !w.isDestroyed() && w.webContents.id === details.webContentsId) && new URL(details.url).protocol === 'https:') {
                            const candidate = new URL(details.url);
                            validateUrl(candidate.href, [candidate.hostname]);
                            await this.checkHost(candidate);
                            if (!allowed.has(candidate.hostname) && dynamic.length < 100) {
                                allowed.add(candidate.hostname);
                                dynamic.push(candidate.hostname);
                            }
                        }
                        const url = validateUrl(details.url, [...allowed]);
                        await this.checkHost(url);
                        callback({ cancel: false });
                    }
                    catch {
                        callback({ cancel: true });
                    }
                })();
            });
        }
        return partition;
    }
    transport(source: string, hosts: string[]) {
        const partition = this.prepare(source, [...hosts, 'challenges.cloudflare.com']);
        return new SessionHttp((input, init) => (this.prepare(source, hosts), partition.fetch(input, init)), async (url) => {
            validateUrl(url.href, hosts);
            await this.checkHost(url);
        });
    }
    assistedTransport(source: string, hosts: string[]) {
        const session = this.transport(source, hosts);
        let browser = this.installed.get(source);
        if (!browser) {
            browser = new InstalledBrowser(path.join(app.getPath('userData'), 'source-browsers', source), hosts, { sourceHosts: hosts.filter(h => !h.startsWith('*.')), generic: true });
            this.installed.set(source, browser);
        }
        return new BrowserAssistedTransport(new SafeHttp(1100), {
            get retryCount() {
                return session.retryCount;
            },
            html: (url, allowed, signal) => session.html(url, allowed, signal),
            get: (url, allowed, signal, image, options) => session.get(url, [...new Set([...allowed, ...hosts])], signal, image, options),
            getToFile: (url, allowed, file, signal, options) => session.getToFile(url, [...new Set([...allowed, ...hosts])], file, signal, options),
            configureDownloads: (...args) => session.configureDownloads(...args)
        }, (url, signal) => this.render(source, hosts, url, 'document', signal), browser);
    }
    async render(source: string, hosts: string[], url: string, mode: RenderMode, signal?: AbortSignal) {
        validateUrl(url, hosts);
        if (source !== 'comix' && mode !== 'document')
            throw Error('Unsupported rendered source.');
        const combined = AbortSignal.any([this.stopped.signal, ...(signal ? [signal] : [])]);
        while (this.rendering.has(source))
            await delay(25, undefined, { signal: combined });
        combined.throwIfAborted();
        this.rendering.add(source);
        if (source === 'comix')
            this.dynamicImages.set(source, hosts);
        const previous = this.renderWindows.get(source);
        if (previous?.idle)
            clearTimeout(previous.idle);
        const existing = previous && !previous.window.isDestroyed() ? previous.window : undefined;
        existing?.webContents.setBackgroundThrottling(false);
        // Only reuse a series document for its first complete chapter traversal.
        // A completed traversal is on its last page and must be navigated afresh.
        const reuseDocument = !!existing && previous?.mode === 'series' && mode === 'chapters' && existing.webContents.getURL() === url;
        try {
            return await renderSource(this.prepare(source, [...hosts, 'challenges.cloudflare.com']), url, mode, combined, window => {
                this.renders.add(window);
                this.renderWindows.set(source, { window, mode });
                window.on('closed', () => {
                    this.renders.delete(window);
                    const entry = this.renderWindows.get(source);
                    if (entry?.window === window) {
                        if (entry.idle)
                            clearTimeout(entry.idle);
                        this.renderWindows.delete(source);
                    }
                });
            }, existing, reuseDocument);
        }
        finally {
            const entry = this.renderWindows.get(source);
            if (entry && !entry.window.isDestroyed()) {
                entry.mode = mode;
                entry.window.webContents.setBackgroundThrottling(true);
                entry.idle = setTimeout(() => {
                    if (!entry.window.isDestroyed())
                        entry.window.destroy();
                }, 60000);
                entry.idle.unref();
            }
            this.rendering.delete(source);
        }
    }
    private windows = new Map<string, BrowserWindow>();
    async cookies(source: string, url: URL) {
        if (!/^[a-z][a-z0-9-]{0,29}$/.test(source))
            return '';
        const jar = session.fromPartition(`persist:source-${source}`);
        const cookies = await jar.cookies.get({ url: url.href });
        return cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    // Called only by a local tray action. No IPC or HTTP route exposes this operation.
    async open(adapter: SourceAdapter) {
        const account = adapter.account;
        if (!account || account.kind !== 'browser')
            throw Error('This source has no browser session integration.');
        const hosts = [new URL(adapter.manifest.website).hostname, ...(account.hosts ?? [])];
        validateUrl(account.loginUrl, hosts);
        const previous = this.windows.get(adapter.manifest.id);
        if (previous) {
            previous.show();
            return;
        }
        const partition = this.prepare(adapter.manifest.id, [...hosts, ...adapter.manifest.apiHosts, ...adapter.manifest.imageHosts, 'challenges.cloudflare.com']);
        const window = new BrowserWindow({
            width: 1000, height: 800, webPreferences: {
                session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true
            }
        });
        this.windows.set(adapter.manifest.id, window);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.on('closed', () => this.windows.delete(adapter.manifest.id));
        await window.loadURL(account.loginUrl);
    }
    async close() {
        this.stopped.abort();
        for (const entry of this.renderWindows.values())
            if (entry.idle)
                clearTimeout(entry.idle);
        for (const w of this.renders)
            w.destroy();
        for (const w of this.windows.values())
            w.destroy();
        this.windows.clear();
        await Promise.allSettled([...this.installed.values()].map(b => b.close()));
        this.installed.clear();
    }
}
