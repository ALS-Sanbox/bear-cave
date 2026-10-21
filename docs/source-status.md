# Version 0.2.0 source status

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

Type checking, 47 offline fixture/security/queue tests, production compilation and hidden Electron checks are run locally. The Electron checks cover encrypted vault storage/removal, source-cookie isolation, branding asset loading, the local-only account bridge and desktop lifecycle. The live website checks fetch one image into memory; they do not download full chapters. Use the manual checklist to install the app, enter your own MangaDex credentials locally, test source-session interaction, read one full chapter per source, and test your Cloudflare Tunnel. No external accounts, releases, tunnels or Windows login items were configured during implementation.

Known limits: ToonGod's live reader is not yet validated; third-party markup may change; English-only website adapters; paid/app-only/unavailable content is not unlocked; source account-library synchronization is absent; no byte-range page resume; CBZ memory cap remains 512 MiB; installer is unsigned; no automatic updater. See accounts.md for exact login behavior and phase-status.md for historical Phase 1 checks.

```powershell
# Explicit live checks; ToonGod currently reports action_required and exits nonzero:
npm.cmd run smoke:sources -- asura flame thunder webtoon
npm.cmd run smoke:sources -- toongod
```
