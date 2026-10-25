# Version 0.3.0 source status

All six adapters are enabled in the source selector and per-source concurrency settings. Enabled means connector code exists; it does not guarantee current website availability or authorized access to every chapter.

| Source | Implementation | Live validation on October 20, 2026 |
| --- | --- | --- |
| MangaDex | Public API; optional registered personal-client login | Public API and one real image previously passed; login/refresh verified with fixtures, real account login remains manual |
| Asura Scans | HTML/Astro public metadata and reader; premium/early-access excluded | Search, series, chapter list, resolution and one WebP passed |
| Flame Comics | HTML/Next data catalog, chapters and ordered images | Search, series, chapter list, resolution and one JPEG passed |
| ThunderScans | WordPress catalog/chapter list and parsed reader JSON | Search, series, chapter list, resolution and one JPEG passed |
| WEBTOON | English public website search, paginated episode list and reader | Search, series, multi-page episode listing, resolution and one JPEG passed |
| ToonGod | WordPress/Madara parser with isolated local session support | Website returned human verification; reader parsing has synthetic fixture coverage but remains unverified against the protected live site |

Website adapters use source-scoped pacing, bounded HTTP retries, Retry-After, fixed host rules, redirect/public-DNS validation, original page order and source-specific image requests. They use the same persistent queue and output validator as MangaDex. Page counts can be unknown until resolution and are displayed honestly; the matching chapter count still precedes enqueueing. Search/chapter collections are counted before dashboard pagination, cached briefly, and fail if a safety limit prevents counting rather than silently truncating bulk selection.

The supplied text logo is used for dashboard/login branding. The supplied mark generates the tray/window icons and multi-resolution Windows ICO during build. Originals in images/ are preserved; generated files are reproducible and ignored by Git.

## Checks and remaining manual work

Current verification is recorded in [the 0.3.0 release record](verification-0.3.0.md). Historical live checks in the table above are dated October 20, 2026; this coordinated release uses deterministic fixtures and does not claim new live-reader or real-account validation. Native checks use isolated temporary app data.

All adapters share streaming output/recovery, paginated library status, guarded previews and source holds. Search/detail covers use a controlled authenticated cache with mark fallback; full covers are now saved automatically with series metadata and can also be refreshed explicitly. MangaDex supplies content hashes/filenames. Asura/Flame immutable image paths can distinguish transport signing fields from image identity. Unknown schemes remain conservative and retain meaningful query information in hashed identities.

Known manual limits: ToonGod live-reader validation, changing third-party markup, English-only website adapters, paid/app-only access restrictions, real account sign-in, real reader rendering, tunnel deployment and unsigned installation. Account-library synchronization is not implemented; Followed Series is Bear Cave's own independent scheduler. No byte-range resume or automatic updater is implemented. Streaming CBZ replaces the old 512 MiB memory cap with a below-4-GiB ZIP32 bound.

```powershell
# Explicit live checks; ToonGod currently reports action_required and exits nonzero:
npm.cmd run smoke:sources -- asura flame thunder webtoon
npm.cmd run smoke:sources -- toongod
```

## October 24, 2026 ToonGod investigation

A direct HTTPS request to `https://www.toongod.org/` returned HTTP 403 with `Cf-Mitigated: challenge`. `npm.cmd run smoke:sources -- toongod` also returned the connector's source-specific action-required diagnostic at search. No live series, chapter list, reader or image success is claimed. No cookies, challenge tokens, CAPTCHA automation or bypass were added.

Synthetic fixtures cover search, series/author metadata, chapter discovery, reader JSON, lazy image attributes and denied-access diagnostics. Code inspection also found that chapter-to-series links only searched `/comics/`; `/manga/` and `/webtoon/` are now recognized. Advertised chapter-list pagination is traversed. Live markup and AJAX-only chapter loading remain unverified while the source is protected.
