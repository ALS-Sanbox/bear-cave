# Verification — Bear Cave 0.3.0

Verified on Windows x64, October 22, 2026. Node.js v24.21.0; Electron 44.9.2; Windows build 10.0.19045. Application source is frozen at commit 76a274e.

## Results

| Check | Actual result |
| --- | --- |
| npm.cmd run typecheck | Passed: server/engine TypeScript and Vue templates |
| npm.cmd test | **85 tests passed in 10 test files** |
| npm.cmd run build | Passed: production TypeScript, Vue/Vite, assets and preload |
| npm.cmd run test:electron | Passed: all four native command runs |
| npm.cmd run dist:win | Passed: final x64 NSIS installer built with publish disabled |
| Packaged smoke in Electron Node mode | Passed: shipped version 0.3.0, in-memory SQLite schema 2, streaming archive modules and JPEG-to-PNG conversion |
| Desktop/mobile fixture review | Grouped queue, history and followed-series previews inspected; no real library data used |
| Git whitespace check | Passed |

Final installer: **release/Bear Cave Setup 0.3.0.exe**

- Length: 121,886,206 bytes.
- SHA-256: 44E5AA5DCF28A0AFA5092E202A6FC915F611DF23A840EB83A59C7D780E72811E
- Authenticode status: NotSigned.
- The application was not installed or launched against the real library.

Native runs cover encrypted fixture vault storage/removal, source-cookie isolation, sandboxed preload/local-only Settings, source buttons, login/error/session recovery, desktop/tray/single-instance/port-conflict lifecycle, local maintenance IPC cancellation, actual click-to-CBZ output, grouped queue, source cover endpoint/full PNG saving, accurate confirmation counts, history verification/missing-file recovery/separate copies, follow/unfollow/manual checks and retained unsaved preferences.

The packaged smoke explicitly uses ELECTRON_RUN_AS_NODE=1. It loads the shipped modules, creates SQLite only in memory, and converts a generated image buffer. It does not start the engine, touch userData, change startup settings, or install the app.

## Scope traceability

| Requested scope | Implementation and evidence |
| --- | --- |
| 1. Stable page identity/recovery | Website/MangaDex identities, hashed transport-independent paths where justified, conservative unknown schemes, staging v2; token/query/revision/interruption regressions |
| 2. Streaming CBZ | Async bounded chunks, stored ZIP writing, bounded stored/deflated validation, CRC/SHA/order checks, abortable finalization; legacy archives, mid-write cancellation/retry and finalized-file crash recovery tested |
| 3. Completed verification/redownload | History actions and ID-only APIs; missing/damaged/inaccessible/verified states, separate-copy consent, original file retention and old-layout recovery tested |
| 4. Queue/history performance | Repeatable schema 1/2 migrations, local backup, indexed FIFO queries and incremental group statistics; 12,000-history-row fixture, bounded pages, search/status filters, no scheduler history deserialization |
| 5. Source challenge recovery | Explicit Retry affected downloads, reason/count in Sources and Queue, stale-hold reset; held/queued state and source cooldown behavior retained |
| 6. Real covers | Optional search references, authenticated source/series endpoint, bounded/coalesced cache, size/format guards, existing host/DNS/cookie rules, lazy fixed-size images/fallback, mapped coverart.png |
| 7. Status/accurate previews | Chapter-state endpoint, verification-aware labels, total/completed/existing/new counts, transactional recheck and translation safeguards; queue-change tests |
| 8. Series groups | Collapsible summaries and progress, individual/group controls, pagination/mobile layout; group isolation, eligible retry and completed-file preservation tested |
| 9. Filters/preferences | English-only source messaging, supported MangaDex language/group controls, friendly language names, remembered non-sensitive source preferences |
| 10. Followed series | Persisted identity/cover key/translation/output preferences, manual checks/previews, opt-in schedules/downloads; injected-clock catch-up, no overlap, holds, pause, backoff/three-failure suspension, preference-change cancellation |
| 11. Authentication | Failures-only throttle, two concurrent hashes, local reset/session/in-flight invalidation; repeated successes, actual failures, concurrency and reset tests |
| 12. Stable folders | Persistent root/identity mapping, case/sanitization/title/cross-source handling, conservative legacy adoption, shared cover mapping; collision, changed marker and legacy missing-folder tests |
| 13. Explicit cleanup | Local scan/native confirmation, fresh token/rescan, owned staging/part recognition, recovery exclusions, worker/shutdown coordination; cleanup and maintenance race/lifecycle tests |
| 14. Maintainability/docs | Cohesive Vue views/components/composable, formatted production source, reusable parser-based formatting script, current docs/release notes and historical-phase separation |

“MangaDex” is the connector name; no source account library synchronization was added. Followed Series belongs entirely to Bear Cave.

## Checks intentionally not performed

- No installer installation, uninstall, Windows login-item change or test-user logon cycle. The NSIS artifact is built and remains ready for user-controlled testing.
- No real MangaDex credentials were read or submitted, and no external accounts were modified.
- No Cloudflare/DNS/tunnel configuration was read or changed; remote deployment testing remains manual.
- No bulk live-site downloads. This release uses deterministic fixture sources and generated images.
- No new live-reader claim for ToonGod or fresh live-site availability claim for the other connectors. Source-status live evidence remains explicitly dated October 20, 2026.

There is no remaining implementation blocker for the coordinated scope. Real-account access, protected-site reader validation, reader rendering and deployment/install behavior require the user's own authorized environment. Unknown identity schemes remain deliberately conservative, and sources without a version/hash cannot expose an overwrite at an unchanged identity.

## Short Windows test sequence

1. Quit the old tray app, install the new artifact manually, and confirm existing history/folders/settings and the migration backup.
2. Download one small authorized chapter; pause/restart, verify output, then try missing-file recovery and a separate-copy download. Check grouped queue actions and saved-file preservation.
3. Follow a series, check missing chapters, opt into a schedule only if desired, then test source-hold recovery and confirmed staging cleanup in disposable data. Test the existing HTTPS tunnel separately if used.

See [the full checklist](manual-test-checklist.md), [release notes](release-0.3.0.md), [architecture](architecture.md), and [source status](source-status.md).

## Local commits

- 6e3287f — recovery, streaming archives and indexed library foundation.
- ba25aff — coordinated library/follow/maintenance UI, migrations, documentation and regression coverage.
- 76a274e — reviewed cover-format and in-flight cache hardening.
- The final verification-only commit records this report and additional test evidence; its ID is included in the handoff.

No push, publication, application installation or real-library mutation was performed.
