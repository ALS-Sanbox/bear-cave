# Architecture — 0.3.0

Bear Cave is independent of Lions Library. Electron owns SQLite, source transports, the queue, followed-series scheduler, authenticated HTTP server and tray. Only bundled local Settings has privileged IPC. Quit aborts work and drains HTTP handlers, follow checks, workers and maintenance before closing SQLite.

| Area | Responsibility |
| --- | --- |
| src/core/store.ts | Migrations, indexed jobs, folder mappings, follows, incremental group statistics |
| src/engine/queue.ts | FIFO source candidates, chapter/page concurrency, abortable controls, holds, maintenance coordination |
| archive.ts / files.ts | Streaming archives, staging v2, verified pages and atomic completion |
| folders.ts / verification.ts | Stable folder identity, legacy adoption, completed-file checks and safe copies |
| follows.ts / selection.ts | Scheduled checks, accurate previews, translation safeguards, transactional enqueue |
| maintenance.ts | Local scan and confirmed abandoned-staging cleanup |
| src/server | Authentication, bounded library API, controlled cover cache |
| src/ui | Views, components and dashboard composable |

## Persistence and efficient queries

Migration 1 creates indexed series/title columns, folder mappings and followed series. A consistent local .pre-v1.bak SQLite backup precedes upgrading a legacy file. Migration 2 adds derived series_stats and triggers without rewriting original records or paths. Reopening migrations is repeatable. Startup recovers running work only; explicit/global pauses, completed history and source holds persist.

Jobs are unique by source/chapter ID. The scheduler queries bounded FIFO candidates per queued source through indexes, orders candidates by rowid, and never deserializes completed history. A full source cannot block another source. Global/per-source chapter limits and the separate page semaphore remain authoritative.

Queue/history responses contain at most 100 jobs and bounded text, summary counts and group statistics. History search, source/status/verification filters and pagination run in SQLite. Trigger-maintained series totals avoid reparsing completed history on each poll. API responses omit filesystem roots, resolved series folders and previous output paths. Non-library views poll lightweight summaries instead of job pages. Browser polling does not overlap, pauses while hidden, and refreshes when visible. Expired sessions return to sign-in.

## Identity, recovery and streaming archives

Transport URLs remain in memory. Resolvers supply ordered revision and optional stable identities. MangaDex supplies its content hash and ordered filenames. Asura/Flame immutable-path policies discard only enumerated signing fields, preserving meaningful/unknown query fields. Other website schemes conservatively hash the complete URL. Persisted website identities are hashes rather than signed URLs. Changed order/count/revision invalidates staging. Sources without version information cannot reveal a content overwrite at an unchanged immutable path; recovered bytes still require their saved SHA-256.

Staging v2 records chapter/revision, ordered identities, page size/SHA-256 and final filename. V1 is upgraded only when revision/count match; otherwise untrusted bytes are downloaded again. Images are bounded at 32 MiB, chapters at 2,000 pages. There is no byte-range resume. Page checks verify framing and checksums rather than fully decoding pixels. Expired transport URLs allow two fresh resolutions and may not silently change revision/order.

CBZ uses asynchronous streams and bounded 64 KiB chunks with stored ZIP entries. Production no longer assembles/unpacks a whole chapter with zipSync/unzipSync. ZIP32 archives are limited below 4 GiB; image folders avoid the aggregate archive cap. The reader bounds directory size, entry count, packed/expanded bytes and metadata; rejects unsafe/duplicate entries; and streams stored or legacy deflated entries through CRC32 and SHA-256 checks. Names/order must match the manifest exactly.

Pause/cancel/shutdown signals reach writing and validation. SQLite completion follows verification and atomic rename only while the job is still running. Interrupted .part archives and verified staged pages remain recoverable. Existing output is validated, never silently replaced. A verified finalized output left by a crash is adopted without downloading its pages again; explicit Download again creates a new generation. Archive hashing and CRC remain chunk-bounded; no synchronous whole-chapter compression blocks Electron.

## Library folders, verification and cleanup

Persistent mappings key real download root plus source/series identity, with case-insensitive uniqueness. Sanitized/truncated readable names acquire stable suffixes only for collisions. Markers and chapter claims prevent unrelated titles, sources and case variants merging. Known unshared legacy output folders can be adopted; unfamiliar or ambiguous folders are left alone. Title changes do not relocate completed files. Covers share the chapter folder mapping.

History distinguishes verified, missing, damaged and inaccessible output. Download again retains the job identity: requeue known missing output or explicitly download a separate copy. The original file is never destroyed before another is validated. Previous paths remain private in SQLite; history represents the latest attempt for an identity.

Staging maintenance is local IPC only. A five-minute scan token and native confirmation identify recognizable abandoned data inside database-owned folders. Cleanup rescans, rejects links/unrecognized files, excludes queued/running/paused/followed recovery and completed output, and includes a matching interrupted CBZ .part. Queue starts/retries coordinate with cleanup; shutdown waits for it. Unknown legacy/untracked directories are intentionally not swept.

## Following and covers

Follow records persist source identity, title, stable cover key, language, preferred group, output format, schedule/download opt-ins, last attempt/success, next check and useful errors. Intervals are 1–168 hours (default six). One overdue series is selected every ten seconds, with at most one catch-up check per series after restart/sleep. Checks do not overlap, have a ten-minute deadline and honor source pacing/holds/global pause. Backoff grows after failures; three failed checks pause the schedule for review. Scheduling exists only while Bear Cave runs. Automatic downloading is opt-in and never silently adds extra translations.

Previews report total/completed/existing/new counts. Users confirm the new count. Enqueue rechecks counts, session-owned expiry, duplicate prevention and additional-translation consent in one transaction.

Cover URLs contain only source/series identity. Adapter search references avoid full-series fetches where possible. The controlled backend uses existing validated transports/cookie isolation, two concurrent fetches, bounded waiting, request coalescing, negative caching, and at most 128 images/32 MiB. UI covers have fixed dimensions, lazy loading, alt text and mark fallback. Full coverart.png conversion remains separate. No arbitrary URL proxy exists.

## Security and local boundaries

Salted scrypt permits at most two concurrent hashes. Only failed authentication counts toward five failures per fifteen minutes. Trusted password changes reset throttling and invalidate sessions plus old in-flight authentication. HttpOnly sessions last twelve hours. CSRF, exact Origin/Host, loopback-only binding and explicit HTTPS tunnel trust remain intact.

SafeHttp preserves HTTPS/443 allowlists, per-redirect validation, public IPv4 DNS checks pinned to TLS, response limits, deadlines, bounded retries and shared cooldowns. Browser sessions remain local-only, isolated and sandboxed; Chromium DNS is checked but not pinned like Node requests. No verification/payment/access bypass exists. DPAPI credentials and account settings remain local. No remote filesystem picker/browser, settings, cleanup or arbitrary-path verification control is added. The Windows user and tunnel daemon remain trusted; hostile same-user filesystem races are outside this boundary.
