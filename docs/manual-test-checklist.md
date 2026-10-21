# Windows manual test checklist

Automated checks do not replace these deployment checks. Use a small available chapter before bulk work; never fill your normal system disk intentionally.

- [ ] Install the unsigned x64 NSIS build in a test user account; verify launch, uninstall and preservation of data/downloads. SmartScreen behavior depends on Windows policy and signing.
- [ ] First launch: Settings opens; no remote account claim exists. Save a long password and a short, writable local download root; verify persistence after Quit/reopen.
- [ ] Launch a second instance: only one engine/server remains and existing Settings opens. Close Settings and browser; tray/server continue. Quit releases the port and stops requests.
- [ ] Choose folder opens a native local dialog. Invalid/UNC/resource/repository paths and invalid numeric settings are rejected. A port change takes effect after restart.
- [ ] Toggle Start with Windows; log out/in and verify the packaged application starts as the same user. Disable and repeat.
- [ ] Login/logout/password replacement invalidate sessions correctly. Try queue/history before login. Confirm no password/hash/token appears in API data, settings responses or lifecycle logs.
- [ ] Search a real title, navigate result pages, open details, change language and translation group, navigate chapter pages. Empty/unavailable results should be useful.
- [ ] Download one real chapter to CBZ, open it in your reader and verify every page/order. Repeat with image folders. Confirm History only follows validated completion.
- [ ] Preview selected/all matching chapters. Count matches filters. Multiple translations require explicit confirmation. Enqueueing a completed source/chapter ID is skipped; Retry restarts a failed/cancelled job.
- [ ] Pause/resume/cancel during page transfer. Quit or terminate during a test chapter, restart and confirm verified pages are reused while incomplete pages restart.
- [ ] Check chapter concurrency globally/per-source and page request limits. Lower a limit during work; current jobs may finish but no excess new jobs start.
- [ ] Use a disposable small test volume to check disk-full behavior; restore space then Retry. Separately test loss/restoration of download-folder permissions. Staging should remain recoverable.
- [ ] Stop network access during a chapter, restore it and Retry. Authentication/challenge responses should hold affected source jobs as action_required; no endless retries.
- [ ] Configure your own Cloudflare Tunnel using remote-access.md. Visit from another device at HTTPS. Inspect Secure/HttpOnly/SameSite cookies, verify remote login/search/download/control and local-only functions remain unavailable.
- [ ] Test phone-width dashboard, keyboard navigation, errors and empty states. All six connectors appear; ToonGod's verification/unvalidated-reader notice remains visible.
- [ ] In local Settings sign into MangaDex using your approved personal client and owner credentials. Verify username, restart persistence, refresh and Remove saved account. Confirm no password is saved and no token/client secret is returned to the UI/API.
- [ ] Open isolated source windows from the tray/local Settings, complete legitimate interaction manually and retry. Confirm profiles stay distinct and remote callers cannot open/control them. ToonGod's live reader remains an outstanding manual validation.
- [ ] Verify supplied branding in dashboard/login, local window, tray and installed application/shortcut. Use one real public chapter from each source before bulk downloading; never assume paid/app-only episodes are available.

The implementation session built an installer and exercised hidden Electron windows, SQLite, DPAPI, actual main startup/IPC, close-to-tray, second-instance reuse, port-conflict recovery and clean Quit on Windows. It did not install the app, exercise interactive tray/dialog clicks or Windows login, deploy a tunnel, or download/read a whole live chapter. Mark these items only after actually performing them.
