import { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, appendFile } from 'node:fs/promises';
import { z } from 'zod';
import { Store } from '../core/store.js';
import { defaults, settingsSchema, validateRoot } from '../core/settings.js';
import { Registry } from '../sources/registry.js';
import { Queue } from '../engine/queue.js';
import { createDashboard } from '../server/server.js';
import { hashPassword } from '../server/auth.js';
import { BrowserSessions } from './sessions.js';
import type { Settings } from '../shared/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let tray: Tray, settingsWindow: BrowserWindow | undefined, store: Store | undefined, queue: Queue | undefined;
let dashboard: ReturnType<typeof createDashboard> | undefined; let quitting = false; let settings: Settings; let localUrl = ''; let logFile = '';
const sessions = new BrowserSessions();
const uiFile = path.resolve(here,'../../ui/index.html');
async function log(event: string) { if (logFile) await appendFile(logFile,`${new Date().toISOString()} ${event}\n`).catch(()=>{}); }
async function showSettings() {
  if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); return; }
  const w = new BrowserWindow({ width: 790,height: 850,title: 'Bear Cave — Local settings',autoHideMenuBar: true,webPreferences: { preload: path.join(here,'preload.cjs'),nodeIntegration: false,contextIsolation: true,sandbox: true } });
  settingsWindow = w; w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate',event=>event.preventDefault()); w.on('close',event=> { if (!quitting) { event.preventDefault(); w.hide(); } });
  w.on('closed',()=> { settingsWindow = undefined; }); await w.loadFile(uiFile);
}
function icon() {
  const size = 32, pixels = Buffer.alloc(size*size*4);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) { const head = (x-16)**2+(y-18)**2 < 155; const ears = (x-6)**2+(y-6)**2 < 24 || (x-26)**2+(y-6)**2 < 24; const eye = (x-11)**2+(y-15)**2 < 3 || (x-21)**2+(y-15)**2 < 3; const nose = (x-16)**2+(y-23)**2 < 8; const i=(y*size+x)*4; if(head||ears) { pixels[i]=eye||nose?25:53; pixels[i+1]=eye||nose?35:97; pixels[i+2]=eye||nose?35:141; pixels[i+3]=255; } }
  return nativeImage.createFromBitmap(pixels,{ width:size,height:size });
}
async function shutdown() {
  if (quitting) return; quitting=true;
  try { sessions.close(); const closing = dashboard?.close(); await queue?.stop(); await closing; store?.close(); tray?.destroy(); await log('Clean shutdown'); app.quit(); }
  catch { await log('Shutdown failed'); dialog.showErrorBox('Bear Cave shutdown','Some cleanup failed. Interrupted downloads will recover on the next launch.'); app.exit(1); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=> { void showSettings(); });
  app.on('window-all-closed',()=>{});
  app.on('before-quit',event=> { if (!quitting) { event.preventDefault(); void shutdown(); } });
  app.whenReady().then(async()=> {
    const data = app.getPath('userData'); await mkdir(data,{ recursive:true }); logFile=path.join(data,'bear-cave.log');
    store = new Store(path.join(data,'bear-cave.sqlite'));
    settings = settingsSchema.parse(store.get<Settings>('settings') ?? defaults(path.join(app.getPath('documents'),'Bear Cave Downloads')));
    const forbidden = [app.getAppPath(),process.resourcesPath];
    // A missing/unwritable folder is fixable through local settings; don't lose the tray or queue.
    try { settings.downloadRoot = await validateRoot(settings.downloadRoot,forbidden); } catch { store.set('queue-paused',true); dialog.showErrorBox('Download folder unavailable','Downloads are paused. Choose a writable local folder in Settings. Existing jobs retain their original destinations.'); }
    const registry = new Registry(); queue = new Queue(store,registry,()=>settings);
    dashboard = createDashboard(store,queue,registry,()=>settings,path.dirname(uiFile));
    try { const port = await dashboard.listen(); localUrl=`http://127.0.0.1:${port}`; }
    catch(e) { const code=(e as NodeJS.ErrnoException).code; if(!['EADDRINUSE','EACCES'].includes(code??''))throw e; store.set('queue-paused',true); await log(`Dashboard listener unavailable: ${code}`); dialog.showErrorBox('Dashboard port unavailable',`Cannot listen on dashboard port ${settings.port}. Downloads are paused. Choose an unused port in local Settings, save, then Quit and reopen Bear Cave.`); }
    ipcMain.handle('local:read',event=> { trusted(event); return { settings,sources:registry.manifests(),adminConfigured: Boolean(store!.get('admin-hash')) }; });
    ipcMain.handle('local:folder',async event=> { trusted(event); const r=await dialog.showOpenDialog(settingsWindow!,{ properties:['openDirectory','createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
    ipcMain.handle('local:save',async(event,input: unknown)=> {
      trusted(event);
      try {
        const data=z.object({ settings:settingsSchema,password:z.string().max(256).optional() }).strict().parse(input);
        data.settings.downloadRoot=await validateRoot(data.settings.downloadRoot,forbidden);
        if (!store!.get('admin-hash') && !data.password) throw Error('Set an administrator password before using the dashboard.');
        const hash=data.password ? await hashPassword(data.password) : undefined;
        app.setLoginItemSettings({ openAtLogin:data.settings.startWithWindows, path:process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
        store!.db.exec('BEGIN IMMEDIATE');
        try { store!.set('settings',data.settings); if(hash) store!.set('admin-hash',hash); store!.db.exec('COMMIT'); } catch(e) { store!.db.exec('ROLLBACK'); throw e; }
        const restart=data.settings.port!==settings.port || !localUrl; settings=data.settings; if(hash) dashboard!.auth.clear();
        return { ok:true,restartRequired:restart };
      } catch(e) { return { ok:false,error:e instanceof z.ZodError ? e.issues.map(i=>i.message).join(' ') : (e as Error).message }; }
    });
    tray=new Tray(icon()); tray.setToolTip('Bear Cave — downloads continue when windows close');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label:'Open Dashboard',click:()=> { if(!localUrl) {void showSettings();return;} void shell.openExternal(localUrl).catch(()=>dialog.showErrorBox('Dashboard','Could not open the default browser.')); } },
      { label:'Settings',click:()=> { void showSettings(); } },{ type:'separator' },
      { label:'Pause All Downloads',click:()=>queue!.pauseAll() },{ label:'Resume Downloads',click:()=>queue!.resumeAll() },
      ...registry.manifests().filter(m=>m.status==='operational' && registry.get(m.id).account?.kind==='browser').map(m=>({ label:`Open ${m.name} session (local)`,click:()=> { void sessions.open(registry.get(m.id)).catch(()=>dialog.showErrorBox('Source session','The source session could not be opened.')); } })),
      { type:'separator' },{ label:'Quit',click:()=> { void shutdown(); } }
    ]));
    tray.on('double-click',()=> { if(localUrl)void shell.openExternal(localUrl);else void showSettings(); });
    queue.start(); await log('Started');
    if (!store.get('admin-hash') || !localUrl) await showSettings();
  }).catch(async()=> { await log('Startup failed'); dialog.showErrorBox('Bear Cave could not start','Check whether another app uses the dashboard port, the application data folder is writable, and this build supports your Windows version. Details: startup failed; no secrets were logged.'); app.exit(1); });
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (!settingsWindow || event.sender !== settingsWindow.webContents || event.senderFrame !== settingsWindow.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(uiFile).href) throw Error('Local settings access denied.');
}
