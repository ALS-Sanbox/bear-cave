# Version 0.3.0 source status

All eight adapters are enabled in the source selector and per-source concurrency settings. Enabled means connector code exists; it does not guarantee current website availability or authorized access to every chapter.

| Source | Implementation | Live validation on October 20, 2026 |
| --- | --- | --- |
| MangaDex | Public API; optional registered personal-client login | Public API and one real image previously passed; login/refresh verified with fixtures, real account login remains manual |
| Asura Scans | HTML/Astro public metadata and reader; premium/early-access excluded | Search, series, chapter list, resolution and one WebP passed |
| Flame Comics | HTML/Next data catalog, chapters and ordered images | Search, series, chapter list, resolution and one JPEG passed |
| ThunderScans | WordPress catalog/chapter list and parsed reader JSON | Search, series, chapter list, resolution and one JPEG passed |
| WEBTOON | English public website search, paginated episode list and reader | Search, series, multi-page episode listing, resolution and one JPEG passed |
| Comix | Rendered Chromium search, complete chapter pagination, and lazy reader extraction | Live search, series and complete 1,300-entry chapter list passed for Overgeared. A 101-page reader was resolved in order and its first WebP image downloaded successfully. |
| MangaPill | Public HTML search, chapter list and reader | Live One Piece search, 1,212 chapters, 57-page resolution and one JPEG passed. |
| Weeb Central | Public search fragments, full chapter list and long-strip reader | Live Overgeared search, 346 chapters, 62-page resolution and one JPEG passed. |

Website adapters use source-scoped pacing, bounded HTTP retries, Retry-After, fixed host rules, redirect/public-DNS validation, original page order and source-specific image requests. They use the same persistent queue and output validator as MangaDex. Page counts can be unknown until resolution and are displayed honestly; the matching chapter count still precedes enqueueing. Search/chapter collections are counted before dashboard pagination, cached briefly, and fail if a safety limit prevents counting rather than silently truncating bulk selection.

The supplied text logo is used for dashboard/login branding. The supplied mark generates the tray/window icons and multi-resolution Windows ICO during build. Originals in images/ are preserved; generated files are reproducible and ignored by Git.

## Checks and remaining manual work

Current verification is recorded in [the 0.3.0 release record](verification-0.3.0.md). Historical live checks in the table above are dated October 20, 2026; this coordinated release uses deterministic fixtures and does not claim new live-reader or real-account validation. Native checks use isolated temporary app data.

All adapters share streaming output/recovery, paginated library status, guarded previews and source holds. Search/detail covers use a controlled authenticated cache with mark fallback; full covers are now saved automatically with series metadata and can also be refreshed explicitly. MangaDex supplies content hashes/filenames. Asura/Flame immutable image paths can distinguish transport signing fields from image identity. Unknown schemes remain conservative and retain meaningful query information in hashed identities.

Known manual limits: future site challenges, changing third-party markup, English-only website adapters, paid/app-only access restrictions, real account sign-in, real reader rendering, tunnel deployment and unsigned installation. Account-library synchronization is not implemented; Followed Series is Bear Cave's own independent scheduler. No byte-range resume or automatic updater is implemented. Streaming CBZ replaces the old 512 MiB memory cap with a below-4-GiB ZIP32 bound.

```powershell
# Explicit live checks for enabled website connectors:
npm.cmd run smoke:sources -- asura flame thunder webtoon
npm.cmd run smoke:sources -- asura flame thunder webtoon
```

## October 24, 2026 ToonGod investigation

A direct HTTPS request to `https://www.toongod.org/` returned HTTP 403 with `Cf-Mitigated: challenge`. `npm.cmd run smoke:sources -- asura flame thunder webtoon` also returned the connector's source-specific action-required diagnostic at search. No live series, chapter list, reader or image success is claimed. No cookies, challenge tokens, CAPTCHA automation or bypass were added.

Synthetic fixtures cover search, series/author metadata, chapter discovery, reader JSON, lazy image attributes and denied-access diagnostics. Code inspection also found that chapter-to-series links only searched `/comics/`; `/manga/` and `/webtoon/` are now recognized. Advertised chapter-list pagination is traversed. Live markup and AJAX-only chapter loading remain unverified while the source is protected.

## ToonGod desktop session transport update

The previous connector copied local-session cookies into Node HTTPS requests identifying as BearCave. That differs from the Chromium context in which the user completed verification. Desktop ToonGod HTML, cover and page-image requests now use the same isolated `persist:source-toongod` Chromium session through `Session.fetch`, without changing its user agent or exporting clearance cookies. Other source transports are unchanged. Both `www.toongod.org` and the apex host are permitted for canonical redirects. Destination host/public-DNS guards, byte limits, bounded retries, cancellation and source pacing still apply. Challenge responses stop with action_required rather than executing challenge code.

The command-line source smoke uses Node and has no access to desktop session state; it is not a test of an already cleared desktop session. An unauthenticated direct probe still returned HTTP 403 / Cloudflare challenge on October 24, 2026. Cleared-session live search/reader behavior remains unverified in this development session. Offline parser fixtures, transport tests and native isolated-session fixtures verify the integration; the user must retry live search after installing this update.

## Source replacement, October 24, 2026

ToonGod was removed from registration, dashboard search and local session actions at the user?s request. Existing files, jobs, history and source identities are not renamed or deleted. Retrying an old ToonGod job reports that the source was removed. At that point Comix was listed as unavailable, with a normal browser link. Direct browse and API probes returned HTTP 403. The rendered-browser integration described below supersedes that earlier unavailable entry. Earlier ToonGod sections above are historical investigation notes.

## Federated search and rendered Comix integration

Discover now defaults to all eight registered sources, with three concurrent source searches, a 35-second deadline per source, incremental results, individual errors/retry, and per-source pagination. An obsolete query is cancelled and cannot overwrite the current results. Source identity remains part of every result key and subsequent series/chapter/download request. Disabled sources are excluded.

Comix uses ordinary page JavaScript in a sandboxed, isolated Chromium partition without a privileged preload. It reads rendered browse cards, metadata, every advertised chapter-list page, and every numbered lazy reader image; an incomplete list or reader fails instead of being used for a bulk download. Chapter translations remain distinct and can be filtered by group. It neither decodes the signed API itself nor automates human challenges. Native fixtures exercise pagination, lazy images, cancellation and session image requests.

Image destinations observed in the Comix rendering window are admitted as exact HTTPS hosts only after public-DNS validation, with a 100-host cap. They are reused by the source-isolated session transport, which still enforces response sizes, redirects and cancellation. HTML uses no-store; image requests may use the Chromium cache. No arbitrary image host is accepted from dashboard callers. The Node-only registry has no browser renderer and reports that desktop Comix is required.

Live commands: `npm.cmd run smoke:sources -- mangapill weebcentral` and, after building, `node scripts/run-electron.mjs scripts/comix-live-smoke.cjs`. The Comix smoke uses a temporary profile and cannot complete a human challenge. Historical ToonGod notes above do not indicate an enabled connector.
