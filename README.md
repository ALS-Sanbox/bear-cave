# Bear Cave

A standalone Windows tray manga downloader with an authenticated Vue web dashboard. Windows owns the server, queue, SQLite database, sessions and downloads. No Lions Library, Docker or Linux server is needed.

MangaDex works in Phase 1. ToonGod, Asura Scans, Flame Comics, WEBTOON and ThunderScans are planned and disabled.

## Windows development

Use Windows 10/11 x64, Node.js 24 LTS (24.15+ in the 24.x line), and npm. The lockfile is included. `.cmd` avoids PowerShell's npm.ps1 execution-policy restriction.

```powershell
cd C:\Users\Ford\Desktop\Projects\bear-cave
npm.cmd ci
npm.cmd run dev
```

First launch opens Local settings. Choose a download folder and set an administrator password (12+ characters). Save, then choose Open Dashboard from the tray and log in at `http://127.0.0.1:43110`. `npm.cmd start` launches an existing build. `dev` builds both TypeScript and Vue first; no separate Vite server is required.

Closing Settings hides its window. Closing the browser leaves the engine running. Tray actions: Open Dashboard, Settings, Pause All Downloads, Resume Downloads, Quit. Quit aborts work safely and closes HTTP/SQLite. Start with Windows is optional, runs at user login, and is not a Windows service.

## Check and build

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:electron
npm.cmd run dist:win
```

Installer: `release\Bear Cave Setup 0.1.0.exe`. NSIS supports per-user installation and a selectable folder. The build downloads tooling but does not publish or install. It is unsigned and uses the default Electron application icon. Signing needs your certificate; automatic updates are deferred.

Explicit live check (not part of automated fixture tests):

```powershell
npm.cmd run smoke:mangadex
npm.cmd run smoke:mangadex -- "Azumanga"
```

This checks up to five search results and one real image in memory. It does not download a whole chapter.

## Try one chapter before bulk downloading

1. Search and open a series. Select language and apply filters. Groups appear as you load chapter pages.
2. Click Download on one chapter, review its count and confirm.
3. Watch Download queue, then History. Open the actual CBZ/folder in Explorer and your reader.
4. Only then use selected chapters or Preview all matching. Additional translations require explicit confirmation. Existing source/chapter IDs are skipped, including failed/cancelled jobs: use Retry for those.

## Data and remote access

SQLite (`bear-cave.sqlite` plus WAL/SHM), generic `bear-cave.log`, Chromium data and future isolated profiles live in Electron `userData`: usually `%APPDATA%\Bear Cave` packaged, possibly `%APPDATA%\bear-cave` in development. Downloads default to `Bear Cave Downloads` inside Windows Documents. Local Settings shows the configured folder. Data remains outside the repository/resources; UNC download shares are rejected.

Passwords use salted scrypt hashes. Future adapter secrets use Windows-backed Electron safeStorage; Phase 1 collects no source credentials. Logs omit passwords, bodies and temporary page URLs. No remote settings export or filesystem browser exists. Replace a forgotten password using local Settings. Quit before backing up SQLite. Jobs retain the root/format selected at enqueue time; changed settings affect new jobs.

The HTTP server binds only to `127.0.0.1`. For remote access, set the exact HTTPS public URL and enable tunnel trust locally, then configure Cloudflare Tunnel separately. No external services are configured automatically.

- [Architecture](docs/architecture.md)
- [Source development](docs/source-development.md)
- [Remote access](docs/remote-access.md)
- [Manual checklist](docs/manual-test-checklist.md)
- [Phase status and limits](docs/phase-status.md)
- [Official docs and licenses](docs/references.md)
