import { renderSource, type RenderMode } from './rendered-source.js';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionHttp, assertPublicHost } from '../sources/session-http.js';
import { BrowserWindow, session } from 'electron';
import type { SourceAdapter } from '../shared/types.js';
import { validateUrl } from '../sources/http.js';
export class BrowserSessions {
    private renders = new Set<BrowserWindow>();
    private rendering = new Set<string>();
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
    async render(source: string, hosts: string[], url: string, mode: RenderMode, signal?: AbortSignal) {
        validateUrl(url, ['comix.to']);
        if (source !== 'comix')
            throw Error('Unsupported rendered source.');
        while (this.rendering.has(source))
            await delay(100, undefined, { signal });
        signal?.throwIfAborted();
        this.rendering.add(source);
        this.dynamicImages.set(source, hosts);
        try {
            return await renderSource(this.prepare(source, [...hosts, 'challenges.cloudflare.com']), url, mode, signal, window => {
                this.renders.add(window);
                window.on('closed', () => this.renders.delete(window));
            });
        }
        finally {
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
    close() {
        for (const w of this.renders)
            w.destroy();
        for (const w of this.windows.values())
            w.destroy();
        this.windows.clear();
    }
}
