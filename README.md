# Bear Cave

A standalone Windows tray manga downloader with an authenticated Vue dashboard. Electron, TypeScript and SQLite own the server, queue, history and files. No Lions Library, Docker, Linux server or external scheduler is required.

Version **0.3.0** adds streaming recovery, verified history and safe redownload, grouped queues, indexed/paginated library queries, source-level challenge recovery, actual cover images, followed series and local staging maintenance. See [release notes](docs/release-0.3.0.md) and [source status](docs/source-status.md). Enabled does not mean live access is healthy; ToonGod has been removed. Search defaults to all eight enabled sources, including Comix, MangaPill and Weeb Central; source failures are shown separately.

## Windows development

Use Windows 10/11 x64 and Node.js 24 LTS (24.15+ within 24.x). The lockfile is included; .cmd avoids PowerShell's npm.ps1 restriction.

~~~powershell
npm.cmd ci
npm.cmd run dev
~~~

First launch opens local Settings. Choose a writable root and set an administrator password of at least 12 characters. Save, then Open Dashboard from the tray at http://127.0.0.1:43110. npm.cmd start runs an existing build. Closing Settings/browser leaves the engine running; tray Quit stops it safely. Start with Windows remains an optional local login item.

## Using the library

Searching, viewing a series, previews and paused queue entries do not create series folders. The folder is created when a chapter download starts or when you explicitly download cover art. Existing library folders remain available for status checks.

- Discover a series. **Select All N Chapters** selects the entire source series across pages and filters, using server resolution and stable ID exclusions. **Select This Page** selects visible chapters. Individual checkboxes and selections survive paging. All languages/translations are included by Select All; additional translations still require confirmation. Previews show the actual missing count and skip existing identities.
- **One folder across sources:** identical recorded titles (case and whitespace ignored) share a library folder. Switching sources queues only chapter numbers/languages not already downloaded or queued from the other source. Existing source-suffixed folders are combined at startup before downloads resume, preserving conflicting files and source provenance. See [shared series folders](docs/shared-series-folders.md).
- Queue chapters appear in collapsible series groups with aggregate progress and individual/group controls. Removing entries keeps files. History is paginated, searchable and filtered by source/status.
- **Verify downloaded file** distinguishes missing, damaged and inaccessible output. **Re-download** (also History ? **Download again**) explicitly replaces a chapter only after the staged replacement passes verification. Original output is kept on failure; successful replacements retain a `.backup-*` recovery copy. Source/chapter uniqueness prevents simultaneous jobs.
- Covers load through an authenticated controlled endpoint with the mark as fallback. Saved library coverart.png is preferred, so artwork remains visible when the source is offline; explicitly downloading a cover refreshes the series image immediately. Downloads automatically save PNG-converted **coverart.png** and atomic UTF-8 **metadata.json** beside chapters. Valid covers are reused; **Download cover art** explicitly refreshes one. Cover/metadata failures are logged without stopping chapter downloads.
- **Follow series** retains source, language/group and download preferences. Followed Series provides Check now, Download missing chapters and optional schedules. Checks run **only while Bear Cave is running**, at 1–168-hour intervals. Global pause suspends automatic work; repeated failures back off and pause for review. Automatic downloading is opt-in, and extra translations still need consent.
- Complete source interaction in its local browser, then use **Retry affected downloads** to release eligible source holds, including stale holds whose original jobs were deleted. Website login and personal-client API login remain separate.
- Local Settings → Staging maintenance scans recognizable abandoned recovery data. A fresh scan and native confirmation precede cleanup. Active, queued, paused, followed recovery and completed output are excluded. Unknown/untracked folders are not swept.

New files use Download root/Series Name/Series Name 001.cbz, or the equivalent chapter image folder. Decimal chapters retain decimals; large numbers are not truncated. Persistent folder mappings handle title changes, Windows case/sanitization collisions and cross-source collisions. Series details show backend download status and counts. Opening a series or previewing downloads reconciles identity-marked folders/CBZ manifests and verifies image signatures, sizes and SHA-256 checksums, including output whose job history was lost. A changed download root is checked independently. Unmarked folders are preserved rather than guessed from titles. Covers share the same mapping; .bear-cave metadata supports recovery and claims.

## Verification and packaging

~~~powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:electron
npm.cmd run dist:win
~~~

The unsigned per-user x64 installer is release/Bear Cave Setup 0.3.0.exe. Packaging does not publish or install. Rebuilding this checkout does not update an already installed copy: quit Bear Cave from its tray menu, then run the newly generated installer to apply changes to that copy. Signing requires your certificate; automatic updates are not implemented. Supplied logos/icons are preserved. [Windows manual checklist](docs/manual-test-checklist.md) covers install/reader checks, real account sign-in and tunnels.

Offline fixtures cover migration compatibility, token/revision changes, streaming/cancelled archives, large history, follow scheduling, translation safeguards, authentication and filesystem security. Electron tests use isolated temporary application data. See [release verification](docs/verification-0.3.0.md) for exact counts and checks not run; historical Phase 1 counts are not current results.

Live checks remain explicit, minimal and separate:

~~~powershell
npm.cmd run smoke:sources -- asura flame thunder webtoon
~~~

## Data and practical limits

SQLite/settings/logs/source profiles live in Electron userData (normally %APPDATA%/Bear Cave). Downloads default to Bear Cave Downloads under Documents. A local SQLite backup precedes legacy schema migration. Original records/paths and Windows-protected secrets are retained.

Images are capped at 32 MiB and chapters at 2,000 pages. Streaming CBZ uses a below-4-GiB ZIP32 limit; image folders avoid that aggregate cap. Recovery verifies complete pages, without byte-range resume. Unknown URL identity schemes stay conservative; an unchanged source path without version/hash information cannot reveal an upstream overwrite. Website sources are English-only. Access restrictions, Comix browser-session availability, manual real-account verification and unsigned installation remain practical limits.

[Architecture](docs/architecture.md) · [Source development](docs/source-development.md) · [Remote access](docs/remote-access.md) · [Accounts](docs/accounts.md) · [Historical phase records](docs/phase-status.md)

Implementation and current verification: [selection, library metadata and safe replacement](docs/library-downloads.md).

### Search across sources

Discover defaults to **All sources**. Results appear as each source responds; unavailable sources have their own retry control. Load more titles separately for each source, or use the dropdown to search one source. Opening a title preserves the result list and uses that title?s original source. Comix uses rendered pages in its isolated desktop Chromium session, including chapter pagination and lazy reader images. A new human check pauses access for local interaction. Comix therefore requires the desktop application rather than the Node-only source smoke.
