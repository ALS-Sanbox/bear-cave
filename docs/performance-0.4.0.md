# Bear Cave 0.4.0 implementation and verification

Implemented October 28-29, 2026. Final Windows build details and SHA-256 values are recorded in `release/verification/build-manifest.json` after packaging. Nothing was pushed or published.

## Download engine and storage

The sequential page loop is replaced with up to 16 bounded workers per chapter, a dynamically enforced global page semaphore (maximum 40), and a shared source semaphore. Workers claim each page index once. Completion order cannot alter image filenames or archive order. Concurrent expiry failures share one resolution promise; a refresh must retain revision, count and identities. A failed image leaves verified successful staging pages available for explicit retry. Pause/cancel/stop await in-flight workers before retry or removal.

Manifest commits are serialized to avoid racing the same temporary manifest. Node HTTPS and Chromium-session images stream to staging files with response byte caps and backpressure. Files are checked for complete supported image signatures, hashed, and renamed before recording completion. Four slots bound legacy buffered transports. Images retain original PNG/JPEG/WebP bytes; only covers use the existing requested PNG/JPG conversion. Existing streaming ZIP creation and verification remain intact; the archive is created once per finalization. No naming, user-file, SQLite history or staging identity migration was introduced.

Series metadata work is coalesced across concurrent chapters and refreshed online no more than once per five minutes per queue series. It runs alongside image workers. Final metadata count updates are serialized, offline and do not occupy chapter worker slots, preserving `metadata.json`, cover downloading and current verified chapter counts. Local count-only updates no longer decode covers.

## HTTP and scheduling

Keep-alive HTTPS sockets are pooled by TLS hostname/options **and the validated destination IP**. Every request and redirect still validates its URL and current public IPv4 DNS answers; a pooled socket cannot bypass a newly blocked DNS result or be borrowed for another IP. TLS verification remains enabled. Pool bounds are 20 sockets per pool key, 40 total and four idle sockets per key. Idle connections expire after 30 seconds. Request cancellation, size caps, scoped cookies and authorization restrictions remain in place. A real local TLS fixture verifies reuse and separate IP pool keys; test certificates never enter the packaged application.

Image pacing is source-scoped and configurable, including zero delay. HTML/API pacing remains separate. MangaDex retains a 500ms image minimum and its existing at-home/API gates. Other website sources default to 200ms image spacing; MangaFreak defaults to zero. All current operational sources cap image requests at six per source. Conservative/Balanced/Fast configure 1/3/5 chapters, 2/6/10 per-chapter workers and 2/18/30 global page slots. Source restrictions win over profile targets; ten workers need not mean ten active requests. Unknown/buffered transports remain bounded. Profiles only apply when selected. Existing stored chapter/page preferences survive upgrade, with a missing global page limit retaining the old effective page limit.

Retries are bounded and use exponential delays with jitter. HTTP 429/503 and Retry-After block the relevant source transport. Connection timeout, request deadline, retry count and base delay are validated and configurable. Progress increments only after a successful staging commit. Dashboard telemetry reports completed-page throughput, session average, active chapters/requests, saved/failed images and retry activity at the existing poll cadence.

## Browser compatibility and ToonGod

Normal HTTP is preferred. Protected requests can reuse the source-isolated Chromium session, rendered JavaScript documents, and a dedicated installed Chrome/Edge profile. Browser windows/processes and profiles are reused; closed browser connections can reconnect on explicit retry. Host/redirect/DNS checks, sandbox isolation, denied popups/permissions and cancellation remain. Image headers are source-specific: ordinary website adapters supply Referer, while Comix intentionally omits Referer and Origin because its current CDN rejects both. The latter was verified with actual HTTP/session requests and protected by a regression test. Explicit Origin remains available where required. Browsers run on the Windows host. Turning browser assistance off prevents fallback. Cookies are scoped to their source or kept inside its native session. Shutdown closes owned browser resources.

Removed the pre-existing automatic checkbox-click attempts from the installed-browser helper. Human verification is exclusively manual. The reference downloader's documented concurrent downloads/retries and browser-session architecture were reviewed: [project](https://github.com/elboletaire/manga-downloader/), [request implementation](https://github.com/elboletaire/manga-downloader/blob/master/http/request.go), [session design](https://github.com/elboletaire/manga-downloader/blob/master/http/session.go). It is AGPL-3.0. No implementation was copied, no dependencies were added, and its user-agent/cookie harvesting and automated verification behavior were not adopted. A direct timed comparison against that binary was not run.

ToonGod was previously removed from active registration after denied public requests. Current direct HTTPS returns a Cloudflare human-verification page. A dedicated installed-browser probe also reached verification and returned `action_required`, without automated interaction. Its experimental WordPress parser remains fixture-tested, but live search, series, covers, complete chapters, reader and image downloads could not be verified. ToonGod therefore has an accurate unavailable card and no download/explore action. Existing jobs/files/history remain intact. No live success is claimed.

## Benchmarks

Captured on Windows x64 / Node 24.21.0 before changing the queue and after implementation. The queue before optimization corresponds to repository HEAD `ad2bfd27d372eea53ab47dd3c3a089a012af1e80` (the MangaFreak addition was already uncommitted). Deterministic transport uses complete ~128KiB PNG images with 40ms request latency. Both runs exercise SQLite, real temporary-file staging, checksums, original-format CBZ output and final verification. The baseline had a configured limit of ten but issued only one image request per chapter. Optimized runs reached ten per chapter and thirty across three chapters using an explicitly capable fixture source. Current production source caps are lower.

| Images x chapters | Before s | After s | Speedup | Images/s before / after | MiB/s before / after | CPU ms before / after | Peak RSS MiB before / after | Staging+verification ms before / after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 x 1 | 0.745 | 0.283 | 2.64x | 13.4 / 35.4 | 1.68 / 4.42 | 312 / 266 | 121.8 / 127.1 | 209 / 513 |
| 50 x 1 | 3.380 | 0.806 | 4.19x | 14.8 / 62.0 | 1.85 / 7.75 | 939 / 890 | 152.8 / 158.1 | 1037 / 1763 |
| 100 x 1 | 6.641 | 1.658 | 4.01x | 15.1 / 60.3 | 1.88 / 7.54 | 1843 / 1906 | 132.8 / 139.8 | 1946 / 3456 |
| 50 x 3 | 3.912 | 1.481 | 2.64x | 38.3 / 101.3 | 4.79 / 12.66 | 2329 / 2593 | 153.0 / 142.7 | 4327 / 12581 |

Every workload had zero retries and exactly one successful request per image. CPU is total process CPU used during the workload. RSS is sampled at 10ms. Disk figures are cumulative staging and verification elapsed times across workers, excluding simulated transport; they include serialization waits and overlap, and can exceed wall time. They are not isolated hardware I/O times. This is one run per workload, not a statistical claim about arbitrary websites. Raw data: [baseline](benchmark-baseline.json), [optimized](benchmark-optimized.json). The benchmark script now measures the optimized implementation; the saved baseline was captured before edits.

A live MangaFreak One Piece chapter 1 check downloaded 54 pages (9,703,375 bytes) in 4.753 seconds including finalization, with zero failed pages or retries. The final CBZ was independently verified. It used temporary isolated storage which was removed afterwards. No live before/after speedup is claimed. ToonGod's browser benchmark is blocked by manual verification. An actual Comix Overgeared chapter 345 benchmark succeeded after correcting the image headers: 101 pages, 81.904 seconds including reader resolution/download/finalization, 1.233 images/s, 0.308 MiB/s, six source transport retries, zero failed images and six peak concurrent image requests. Archive finalization took 2.159 seconds. Electron main-process CPU was 10,095ms and sampled peak RSS was 264.5MiB; browser subprocess CPU/memory were not measured. Series metadata was loaded before timing. The chapter archive was independently verified and temporary data was removed. Raw report: `release/verification/browser-download-benchmark.json`. No before/after browser speedup is claimed.

## Validation and remaining limits

TypeScript and Vue checks pass. The 26-file automated suite passes 180 tests. New coverage includes ten parallel page requests, no duplicate indexes, ordered ZIPs, failure recovery, pause/resume/cancel, shared expiry refresh, changed revisions, source/global limits, metadata counts/covers, streaming, real TLS reuse, DNS rebinding rejection, jitter, profile migration and authenticated preference updates. Existing completed-file detection, forced redownload, archive integrity, browser/session reuse and ToonGod diagnostics remain covered.

Native Windows checks cover actual Electron startup and port-conflict recovery, SQLite/DPAPI, trusted local settings, remote authentication, download dialogs and click-to-CBZ, history/copies, federated search, rendered chapter pagination/lazy-image order, cancellation, library scanning, and mobile/desktop performance controls. The mobile fixture verifies a 390px viewport without horizontal overflow and saves a screenshot under `release/verification/`. Both the unpacked packaged executable and the actual portable launcher passed startup, isolated database/settings loading, authenticated dashboard/source/performance/telemetry checks and clean shutdown on Windows. These checks are repeated against the final corrected artifacts. Installer execution/installation is not performed against the user profile. Packaging/runtime verification results and exact sizes/hashes are recorded under `release/verification/`.

No standalone lint command exists. The repository formatter now supports selected files and `--check`; modified source files are formatted and checked without reformatting unrelated files. `git diff --check` passes. Signing credentials are not configured; output signature status is measured after packaging. Website access, paid content, future markup changes and real human verification remain source-dependent. No user downloads, preferences, history or database were deleted or reset.

## Files changed

- README.md
- docs/benchmark-baseline.json
- docs/benchmark-optimized.json
- docs/performance-0.4.0.md
- docs/source-status.md
- package-lock.json
- package.json
- scripts/benchmark-downloads.ts
- scripts/browser-download-benchmark.cjs
- scripts/comix-image-diagnostic.cjs
- scripts/comix-live-smoke.cjs
- scripts/electron-smoke.cjs
- scripts/format-source.mjs
- scripts/live-download-smoke.ts
- scripts/main-smoke.cjs
- scripts/packaged-smoke.mjs
- scripts/performance-ui-smoke.cjs
- scripts/probe-toongod.ts
- scripts/run-electron.mjs
- scripts/smoke-sources.ts
- scripts/verify-build.mjs
- src/core/settings.ts
- src/desktop/installed-browser.ts
- src/desktop/main.ts
- src/desktop/rendered-source.ts
- src/desktop/sessions.ts
- src/engine/files.ts
- src/engine/image-types.ts
- src/engine/library.ts
- src/engine/queue.ts
- src/server/server.ts
- src/shared/performance.ts
- src/shared/types.ts
- src/sources/browser-assisted.ts
- src/sources/comix.ts
- src/sources/http.ts
- src/sources/mangadex.ts
- src/sources/mangafreak.ts
- src/sources/registry.ts
- src/sources/session-http.ts
- src/sources/website.ts
- src/ui/components/PerformanceSettings.vue
- src/ui/composables/useDashboard.ts
- src/ui/style.css
- src/ui/views/LocalSettings.vue
- src/ui/views/QueueView.vue
- tests/additional-sources.test.ts
- tests/browser-assisted.test.ts
- tests/concurrent-downloads.test.ts
- tests/connection-pool.test.ts
- tests/fixtures/localhost-cert.pem
- tests/fixtures/localhost-key.pem
- tests/helpers.ts
- tests/http.test.ts
- tests/mangafreak.test.ts
- tests/performance-settings.test.ts
- tests/server.test.ts
- tests/websites.test.ts
