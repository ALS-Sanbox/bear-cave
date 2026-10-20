# Architecture

Electron owns the SQLite store, registry, scheduler, HTTP server and tray. Only local Settings has a privileged preload bridge. The dashboard opens in the default browser. Closing Settings hides it; Quit stops work and exits.

| Module | Responsibility |
| --- | --- |
| src/desktop | Tray, single instance, local IPC, future sessions, DPAPI vault |
| src/core | SQLite and settings validation |
| src/server | HTTP API/assets, password/session/CSRF, host/origin checks, count previews |
| src/engine | Chapter scheduler, page semaphore, output staging/validation |
| src/sources | Versioned registry, safe HTTP, MangaDex |
| src/shared | Adapter, job and settings contracts |
| src/ui | Vue dashboard and local settings, built by Vite |

Jobs persist before scheduling. `(source, chapter_id)` is unique in every state; bulk enqueue is transactional. Root/format are snapshots. Limits are read when jobs start: global and per-source counts are active chapters; a separate semaphore limits image requests. Lower limits do not forcibly terminate current work.

State flow: queued → running → completed/failed/action_required. Pause/cancel persists state before aborting work. Explicit resume/retry returns eligible jobs to queued. Global pause survives restart. Startup recovers running jobs as queued; explicit pauses and terminal states stay unchanged. Quit requeues running work, aborts and awaits workers, closes HTTP and SQLite. Failed jobs never automatically retry forever.

HTTP allows four attempts/request, exponential backoff, Retry-After and MangaDex reset headers. Shared cooldowns also block subsequent source traffic. Authentication/challenges hold affected source jobs as action_required without retries. Explicit Retry clears the source hold for that attempt. Expired page URLs permit two fresh resolutions/job; changed page revisions fail safely for explicit retry. An occupied dashboard port pauses downloads but leaves local Settings available to choose another port.

Output uses safe readable prefixes plus UUIDs/hashes, containment checks, conservative Windows path lengths and junction/symlink rejection. Revision-bound staging manifests record page size and SHA-256. Each page is downloaded fully, checked for image framing, written as `.part`, renamed, then recorded. Recovery reuses only verified pages; incomplete pages restart, without HTTP byte-range resume. Staging remains after pause/cancel/failure for retry.

Completion requires revalidating every page. Folders are renamed and checked. CBZ pages have five-digit ordered names and a metadata manifest; the archive is unpacked for checksum comparison before final rename/SQLite completion. Conflicting outputs are never silently overwritten. Crash-after-rename recovery may download pages again before validating existing output. Validation checks framing/checksums, not full pixel decoding. CBZ assembly caps uncompressed chapter content at 512 MiB; folder mode avoids the chapter-wide cap. Pages within each chapter are sequential, while concurrent chapters share the page semaphore.

HTTP exposes no setup/settings/folder-picker/browser-control/arbitrary-fetch endpoint. Local IPC checks window, sender, main frame and exact bundled file URL. Remote windows have sandboxing, context isolation, Node disabled and no preload. Passwords use scrypt N=32768/r=8/p=1, 16-byte salt and 64-byte key. Memory-only random sessions expire in twelve hours and are revoked on password change/restart. Login limits are global: five attempts/fifteen minutes, at most two concurrent hash operations.

Source fetches allow declared HTTPS hosts/443 only. Every redirect and DNS result is checked. Public IPv4 addresses are pinned in actual TLS connections; private, local, link-local, multicast and special-use ranges are blocked. IPv6 is conservatively disabled. No authorization/cookies are forwarded to image hosts. Response size/socket timeouts and AbortSignal bound work. Browser sessions are a future scaffold requiring dedicated security/transport validation before a browser source ships.

The local Windows account and loopback tunnel daemon are trusted. DPAPI protects against other Windows users, not same-user malware. Hostile same-user filesystem races and compromised local processes are outside this threat boundary.
