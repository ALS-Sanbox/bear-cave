import { BrowserWindow, session } from 'electron';
import type { SourceAdapter } from '../shared/types.js';
import { validateUrl } from '../sources/http.js';
import { lookup } from 'node:dns/promises';
import { publicIPv4 } from '../sources/http.js';
export class BrowserSessions {
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
        const partition = session.fromPartition(`persist:source-${adapter.manifest.id}`);
        partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        partition.webRequest.onBeforeRequest((details, callback) => {
            void (async () => {
                try {
                    const u = validateUrl(details.url, [...hosts, ...adapter.manifest.apiHosts, ...adapter.manifest.imageHosts, 'challenges.cloudflare.com']);
                    const records = await lookup(u.hostname, { all: true, family: 4 });
                    callback({ cancel: !records.length || records.some(r => !publicIPv4(r.address)) });
                }
                catch {
                    callback({ cancel: true });
                }
            })();
        });
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
        for (const w of this.windows.values())
            w.destroy();
        this.windows.clear();
    }
}
