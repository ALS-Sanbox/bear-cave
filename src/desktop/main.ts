import { syncSeries } from '../engine/library.js';
import { consolidateLibrary } from '../engine/consolidation.js';
import { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, appendFile } from 'node:fs/promises';
import { z } from 'zod';
import { Store } from '../core/store.js';
import { defaults, settingsSchema, validateRoot } from '../core/settings.js';
import { Registry, websiteAdapters } from '../sources/registry.js';
import { MangaDex } from '../sources/mangadex.js';
import { sharedHttp } from '../sources/http.js';
import { MangaDexAccount } from '../sources/mangadex-account.js';
import { SecretVault } from './secrets.js';
import { Queue } from '../engine/queue.js';
import { createDashboard } from '../server/server.js';
import { hashPassword } from '../server/auth.js';
import { BrowserSessions } from './sessions.js';
import { StagingMaintenance } from '../engine/maintenance.js';
import type { Settings } from '../shared/types.js';
const here = path.dirname(fileURLToPath(import.meta.url));
let tray: Tray, settingsWindow: BrowserWindow | undefined, store: Store | undefined, queue: Queue | undefined;
let dashboard: ReturnType<typeof createDashboard> | undefined;
let quitting = false;
let settings: Settings;
let localUrl = '';
let logFile = '';
const sessions = new BrowserSessions();
const uiFile = path.resolve(here, '../../ui/index.html');
async function log(event: string) {
    if (logFile)
        await appendFile(logFile, `${new Date().toISOString()} ${event}\n`).catch(() => {
        });
}
async function showSettings() {
    if (settingsWindow) {
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }
    const w = new BrowserWindow({
        width: 790, height: 850, title: 'Bear Cave — Local settings', icon: path.resolve(here, '../../branding/app.png'), autoHideMenuBar: true, webPreferences: {
            preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true
        }
    });
    settingsWindow = w;
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', event => event.preventDefault());
    w.on('close', event => {
        if (!quitting) {
            event.preventDefault();
            w.hide();
        }
    });
    w.on('closed', () => {
        settingsWindow = undefined;
    });
    await w.loadFile(uiFile);
}
function icon() {
    const image = nativeImage.createFromPath(path.resolve(here, '../../branding/tray.png'));
    if (image.isEmpty())
        throw Error('Tray branding asset is missing. Run the build first.');
    return image;
}
async function shutdown() {
    if (quitting)
        return;
    quitting = true;
    try {
        sessions.close();
        const closing = dashboard?.close();
        await queue?.stop();
        await closing;
        store?.close();
        tray?.destroy();
        await log('Clean shutdown');
        app.quit();
    }
    catch {
        await log('Shutdown failed');
        dialog.showErrorBox('Bear Cave shutdown', 'Some cleanup failed. Interrupted downloads will recover on the next launch.');
        app.exit(1);
    }
}
if (!app.requestSingleInstanceLock())
    app.quit();
else {
    app.on('second-instance', () => {
        void showSettings();
    });
    app.on('window-all-closed', () => {
    });
    app.on('before-quit', event => {
        if (!quitting) {
            event.preventDefault();
            void shutdown();
        }
    });
    app.whenReady().then(async () => {
        const data = app.getPath('userData');
        await mkdir(data, { recursive: true });
        logFile = path.join(data, 'bear-cave.log');
        store = new Store(path.join(data, 'bear-cave.sqlite'));
        settings = settingsSchema.parse(store.get<Settings>('settings') ?? defaults(path.join(app.getPath('documents'), 'Bear Cave Downloads')));
        const forbidden = [app.getAppPath(), process.resourcesPath];
        // A missing/unwritable folder is fixable through local settings; don't lose the tray or queue.
        try {
            settings.downloadRoot = await validateRoot(settings.downloadRoot, forbidden);
        }
        catch {
            store.set('queue-paused', true);
            dialog.showErrorBox('Download folder unavailable', 'Downloads are paused. Choose a writable local folder in Settings. Existing jobs retain their original destinations.');
        }
        let combinedFolders = 0;
        try {
            const result = await consolidateLibrary(store, settings.downloadRoot);
            combinedFolders = result.merged + result.linked;
            if (combinedFolders)
                await log(`Combined ${result.merged} cross-source folder(s); linked ${result.linked} source identities.`);
        }
        catch (e) {
            store.set('queue-paused', true);
            await log(`Library consolidation incomplete; downloads paused: ${(e as Error).message}`);
        }
        const comixHosts = ['comix.to', 'static.comix.to'];
        const registry = new Registry([new MangaDex(sharedHttp), ...websiteAdapters((id, url) => sessions.cookies(id, url), {
                hosts: comixHosts, transport: sessions.transport('comix', comixHosts), render: (url, mode, signal) => sessions.render('comix', comixHosts, url, mode, signal)
            })]);
        if (combinedFolders) {
            const series = new Map(store.jobs().filter(j => path.resolve(j.root) === path.resolve(settings.downloadRoot)).map(j => [`${j.source}:${j.series.id}`, j.series]));
            for (const s of series.values()) {
                if (!registry.manifests().some(m => m.id === s.source && m.status === 'operational'))
                    continue;
                if (!store.libraryJobs(s.source, s.id, settings.downloadRoot).some(j => j.source !== s.source))
                    continue;
                await syncSeries(store, registry.get(s.source), s, settings.downloadRoot, undefined, undefined, { offline: true, create: false }).catch(e => log(`Library metadata: ${(e as Error).message}`));
            }
        }
        queue = new Queue(store, registry, () => settings);
        const maintenance = new StagingMaintenance(store, queue);
        const mangaAccount = new MangaDexAccount(new SecretVault(path.join(data, 'secrets')));
        dashboard = createDashboard(store, queue, registry, () => settings, path.dirname(uiFile));
        try {
            const port = await dashboard.listen();
            localUrl = `http://127.0.0.1:${port}`;
        }
        catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            if (!['EADDRINUSE', 'EACCES'].includes(code ?? ''))
                throw e;
            store.set('queue-paused', true);
            await log(`Dashboard listener unavailable: ${code}`);
            dialog.showErrorBox('Dashboard port unavailable', `Cannot listen on dashboard port ${settings.port}. Downloads are paused. Choose an unused port in local Settings, save, then Quit and reopen Bear Cave.`);
        }
        ipcMain.handle('local:read', async (event) => {
            trusted(event);
            return {
                settings, sources: registry.manifests(), mangaAccount: await mangaAccount.status(), adminConfigured: Boolean(store!.get('admin-hash'))
            };
        });
        ipcMain.handle('local:staging-scan', async (event) => {
            trusted(event);
            return maintenance.scan();
        });
        ipcMain.handle('local:staging-clean', async (event, token: unknown) => {
            trusted(event);
            const id = z.string().regex(/^[a-f0-9]{48}$/).parse(token);
            const confirm = await dialog.showMessageBox(settingsWindow!, {
                type: 'warning', buttons: ['Keep recoverable files', 'Delete eligible staging'], defaultId: 0, cancelId: 0, message: 'Delete eligible abandoned staging files?', detail: 'Queued, active, paused and followed-series recovery files and completed downloads are excluded. This cannot be undone.'
            });
            if (confirm.response !== 1)
                return { removed: 0 };
            return maintenance.clean(id);
        });
        ipcMain.handle('local:manga-connect', async (event, input: unknown) => {
            trusted(event);
            try {
                return { ok: true, status: await mangaAccount.connect(input) };
            }
            catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : 'MangaDex login failed.' };
            }
        });
        ipcMain.handle('local:manga-disconnect', async (event) => {
            trusted(event);
            try {
                return { ok: true, status: await mangaAccount.disconnect() };
            }
            catch {
                return { ok: false, error: 'Account is busy or secure storage is unavailable. Try again.' };
            }
        });
        ipcMain.handle('local:source-session', async (event, id: unknown) => {
            trusted(event);
            await sessions.open(registry.get(z.string().regex(/^[a-z][a-z0-9-]{0,29}$/).parse(id)));
            return { ok: true };
        });
        ipcMain.handle('local:folder', async (event) => {
            trusted(event);
            const r = await dialog.showOpenDialog(settingsWindow!, { properties: ['openDirectory', 'createDirectory'] });
            return r.canceled ? null : r.filePaths[0];
        });
        ipcMain.handle('local:save', async (event, input: unknown) => {
            trusted(event);
            try {
                const data = z.object({ settings: settingsSchema, password: z.string().max(256).optional() }).strict().parse(input);
                data.settings.downloadRoot = await validateRoot(data.settings.downloadRoot, forbidden);
                if (!store!.get('admin-hash') && !data.password)
                    throw Error('Set an administrator password before using the dashboard.');
                const hash = data.password ? await hashPassword(data.password) : undefined;
                app.setLoginItemSettings({
                    openAtLogin: data.settings.startWithWindows, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()]
                });
                store!.db.exec('BEGIN IMMEDIATE');
                try {
                    store!.set('settings', data.settings);
                    if (hash)
                        store!.set('admin-hash', hash);
                    store!.db.exec('COMMIT');
                }
                catch (e) {
                    store!.db.exec('ROLLBACK');
                    throw e;
                }
                const restart = data.settings.port !== settings.port || !localUrl;
                settings = data.settings;
                if (hash)
                    dashboard!.auth.clear();
                return { ok: true, restartRequired: restart };
            }
            catch (e) {
                return { ok: false, error: e instanceof z.ZodError ? e.issues.map(i => i.message).join(' ') : (e as Error).message };
            }
        });
        tray = new Tray(icon());
        tray.setToolTip('Bear Cave — downloads continue when windows close');
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Open Dashboard', click: () => {
                    if (!localUrl) {
                        void showSettings();
                        return;
                    }
                    void shell.openExternal(localUrl).catch(() => dialog.showErrorBox('Dashboard', 'Could not open the default browser.'));
                } },
            { label: 'Settings', click: () => {
                    void showSettings();
                } }, { type: 'separator' },
            { label: 'Pause All Downloads', click: () => queue!.pauseAll() }, { label: 'Resume Downloads', click: () => queue!.resumeAll() },
            ...registry.manifests().filter(m => m.status === 'operational' && registry.get(m.id).account?.kind === 'browser').map(m => ({ label: `Open ${m.name} session (local)`, click: () => {
                    void sessions.open(registry.get(m.id)).catch(() => dialog.showErrorBox('Source session', 'The source session could not be opened.'));
                } })),
            { type: 'separator' }, { label: 'Quit', click: () => {
                    void shutdown();
                } }
        ]));
        tray.on('double-click', () => {
            if (localUrl)
                void shell.openExternal(localUrl);
            else
                void showSettings();
        });
        queue.start();
        dashboard.follows.start();
        await log('Started');
        if (!store.get('admin-hash') || !localUrl)
            await showSettings();
    }).catch(async () => {
        await log('Startup failed');
        dialog.showErrorBox('Bear Cave could not start', 'Check whether another app uses the dashboard port, the application data folder is writable, and this build supports your Windows version. Details: startup failed; no secrets were logged.');
        app.exit(1);
    });
}
function trusted(event: Electron.IpcMainInvokeEvent) {
    if (quitting || !settingsWindow || event.sender !== settingsWindow.webContents || event.senderFrame !== settingsWindow.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(uiFile).href)
        throw Error('Local settings access denied.');
}
