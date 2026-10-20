# Phase 1 status

Implemented: Electron tray/single-instance lifecycle, local Vue settings and native folder dialog, optional Windows login item, SQLite settings/jobs/history, administrator password hashing, authenticated loopback HTTP/Vue dashboard, explicit HTTPS proxy configuration, CSRF/session/host/origin protections, MangaDex public search/details/filtered chapter pagination/downloads, transactional count previews, explicit multiple-translation confirmation, queue controls/progress/history, active chapter/page limits, bounded retry/cooldown/expiry behavior, safe ordered image-folder/CBZ output, revision/checksum recovery, and disabled planned sources.

Other connectors are not operational. Browser sessions and DPAPI adapter-token storage are scaffolding; no browser-dependent connector or MangaDex account support ships. MangaDex public work does not depend on these deferred features.

## Validation performed on Windows, October 20, 2026

- TypeScript and Vue type checking.
- Deterministic Vitest suite (32 tests): queue persistence/restart, per-source/global/page concurrency, duplicate prevention, cancellation/retry/challenges, safe filenames/paths/junctions, protected APIs/login/CSRF/proxy cookies, source URL/DNS/redirect safety, fixture MangaDex parsing/pagination, real-worker interrupted-page recovery and CBZ integrity.
- Vite and main-process production compilation.
- Hidden Electron smoke: native SQLite, DPAPI roundtrip, sandboxed preload/local-settings rendering, no remote bridge, HTTP login and dashboard/source rendering. Temporary profiles are cleaned after process exit.
- Actual desktop-entry smoke: tray creation/startup, sender-validated settings IPC, second-instance window reuse, close-to-tray, clean Quit and local-settings recovery when the dashboard port is occupied.
- Explicit live MangaDex smoke: API 5.13.1 search/details/chapter pagination/resolution and one real PNG in memory (chapter f286bcd0-f6d7-47ce-8084-30a0bfdbc451, 52 resolved pages; one page fetched).
- Windows x64 NSIS installer generation. Installer signature check: unsigned.
- Production dependency audit: zero reported vulnerabilities at validation time.

See manual-test-checklist.md for deployment checks not performed. The live test is one image, not a full live chapter download. Windows CI is supplied but has not been run on GitHub; nothing was pushed or published.

## Limits

- No optional MangaDex account/OAuth integration or browser challenge completion is implemented end to end. Human-action jobs require explicit retry; no challenge bypass is promised.
- No HTTP byte-range resume. Incomplete pages restart; verified complete pages can be reused. Staging for cancelled/failed work remains on disk for retry; no automatic retention cleanup or remote file browser.
- CBZ assembly uses memory and rejects chapters over 512 MiB uncompressed; choose folders for large chapters. Image validation checks framing/checksums, not full pixel decoding.
- API pagination stops at the documented 10,000-result boundary with an error for oversized bulk previews. Narrow language/group filters. Groups are discovered as chapter pages load; language entry uses MangaDex codes.
- Selection is per visible chapter page. All matching uses a server-side complete preview; preview tokens expire after five minutes.
- Existing jobs retain their output destination/format. Completed identity records are skipped even if files were manually moved/deleted. No history purge or redownload-completed control yet.
- IPv4-only source fetching; unfamiliar image domains fail closed. No arbitrary URLs, network-share download destinations or dynamic third-party plugin loading.
- Port changes require restart. One administrator, twelve-hour in-memory sessions, global login throttle; no user roles or persistent sign-in. Local processes and tunnel daemon are trusted.
- Windows x64 is the installer target. Installer is unsigned with default Electron icon; no auto-update/release publication. Interactive installation/logon/tray/tunnel checks remain manual.
