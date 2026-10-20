import { BrowserWindow, session } from 'electron';
import type { SourceAdapter } from '../shared/types.js';
import { validateUrl } from '../sources/http.js';
export class BrowserSessions {
  private windows = new Map<string,BrowserWindow>();
  // Called only by a local tray action. No IPC or HTTP route exposes this operation.
  async open(adapter: SourceAdapter) {
    const account = adapter.account;
    if (!account || account.kind !== 'browser') throw Error('This source has no browser session integration.');
    const hosts = [new URL(adapter.manifest.website).hostname]; validateUrl(account.loginUrl,hosts);
    const previous = this.windows.get(adapter.manifest.id); if (previous) { previous.show(); return; }
    const partition = session.fromPartition(`persist:source-${adapter.manifest.id}`);
    partition.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
    partition.webRequest.onBeforeRequest((details,callback) => { try { validateUrl(details.url,[...hosts,...adapter.manifest.apiHosts,...adapter.manifest.imageHosts]); callback({ cancel: false }); } catch { callback({ cancel: true }); } });
    const window = new BrowserWindow({ width: 1000,height: 800,webPreferences: { session: partition,nodeIntegration: false,contextIsolation: true,sandbox: true } });
    this.windows.set(adapter.manifest.id,window); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('closed',() => this.windows.delete(adapter.manifest.id)); await window.loadURL(account.loginUrl);
  }
  close() { for (const w of this.windows.values()) w.destroy(); this.windows.clear(); }
}
