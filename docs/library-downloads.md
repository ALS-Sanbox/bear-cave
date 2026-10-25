# Chapter selection, library records and replacement

Select All uses `{all:true, exclude:[stable chapter IDs]}`. The backend ignores display language/group/page filters for this mode and resolves the source's full public chapter collection; the browser retains only explicit IDs or exclusions. Select This Page adds the visible IDs without discarding earlier pages. The existing 10,000 chapter safety limit remains; sources fail explicitly rather than silently truncate. The original bug had two causes: the page checkbox assigned only the current page IDs, and loadChapters reset selected IDs on every page.

SQLite remains the sole database. Existing unique `(source,chapter_id)` job records hold canonical identities/URLs, destination, expected source page count, actual resolved page count, state, verification timestamp and successful completion timestamp. Folder manifests and CBZ `bear-cave.json` hold page size/hash information. Identity markers and folder mappings prevent title collisions; marker scanning recovers renamed folders without guessing titles. Legacy files are reconciled when opening a series or preparing a preview. Valid records can be imported after job history loss. Neither unknown files nor corrupt output are deleted. Files without trustworthy source/series/chapter identity are deliberately not imported.

Reconciliation checks containment/junctions, manifests, chapter identity, each page's size, SHA-256 and image signature, and ZIP structure for CBZ. A folder's existence alone never means completed. The active configured root controls detection; missing output may be queued again. Damaged output requires explicit Re-download. API series details include library state/counts, chapter lists include status/job ID, and library-status supplies refreshed queue counts without re-fetching the source. The series total is the full public collection, including translations.

Series metadata shares the existing folder mapping and SQLite job records. `Series.metadata` supplies optional normalized fields and additional source data; unavailable fields remain null/empty. MangaDex attributes, WordPress summary fields and available website metadata are retained. JSON updates preserve date_added and existing useful fields, serialize per series, and use a sibling temporary file plus rename. Chapter completion, series reconciliation and verification refresh counts. A valid PNG cover is reused; conversion uses existing sharp, retaining aspect ratio. Failed automatic cover and unavailable chapter-count requests are throttled for one hour; explicit Download cover art can retry immediately. Metadata/network/cover failures are logged and do not block chapter output. Existing series receive missing files on reconciliation when source information is available.

Replacement reuses the same job and queue concurrency/rate controls. A unique copy suffix stages fresh pages away from the original. The finished candidate is verified before moving the original to a recorded `.backup-*` sibling and renaming the replacement into place. A failed rename rolls the backup back where possible; backup paths are persisted before the swap for recovery after interruption. Backups remain available and are never swept by reconciliation. A crash may leave a recorded backup and a verified candidate; retry can recover the candidate and finish the swap. SQLite and filesystem changes are not a single transaction. History records the latest attempt, including failures, and keeps prior output paths locally; the API does not expose absolute paths.

Mobile chapter rows become stacked cards at widths <=700px, with 24px checkboxes, 44px action buttons and wrapping selection controls. Electron browser regression checks at 390px cover no horizontal overflow, page selection, page navigation, all-series selection and individual exclusions, in addition to actual queue output and History replacement.

## Verification

See tests/library.test.ts for all six requested list sizes (49, 50, 51, 100, 187, 1,000), duplicate submissions, 187 minus 86 completed chapters, folder/CBZ reconciliation, root changes, missing output, metadata preservation/conversion, unavailable metadata/covers, and successful/failed folder/CBZ replacements. Server tests exercise all-series exclusions and repeated submission through authenticated HTTP. ToonGod fixtures are synthetic and contain no source content or session tokens.

Live ToonGod on October 24, 2026: HTTP 403 Cloudflare human verification. Search smoke exits nonzero with actionable information. Public extraction success is unverified; no access-control bypass was attempted. Unidentified third-party downloads, more than 10,000 chapters, real phone hardware and live protected-reader markup remain limits.

## Completion record (October 24, 2026)

Checks: formatting, TypeScript/Vue typecheck, production build, and whitespace validation pass. Vitest: **104 tests pass across 12 files**, including 19 added regressions. Full Electron suite passes: secure storage/authentication, tray startup, IPC, single instance, port conflict recovery, queue/CBZ output, verification/replacement, follow workflow, and 390px mobile selection/navigation. No separate lint command is configured in package.json. Installer packaging and physical phone testing were not run.

Modified files:

- Persistence/engine: `src/core/store.ts`, `src/engine/folders.ts`, `src/engine/queue.ts`, `src/engine/selection.ts`, `src/engine/verification.ts`; added `src/engine/library.ts`.
- API/types: `src/server/server.ts`, `src/shared/types.ts`.
- Source adapters: `src/sources/asura.ts`, `src/sources/flame.ts`, `src/sources/mangadex.ts`, `src/sources/website.ts`, `src/sources/webtoon.ts`, `src/sources/wordpress.ts`.
- Dashboard/mobile: `src/ui/composables/useDashboard.ts`, `src/ui/views/DiscoverView.vue`, `src/ui/style.css`.
- Regressions: `scripts/download-ui-smoke.cjs`, `tests/server.test.ts`; added `tests/library.test.ts`, `tests/toongod.test.ts`.
- Documentation: `README.md`, `docs/source-status.md`; added this `docs/library-downloads.md` report.

No dependencies were added. Tray architecture, authentication, source sessions, queue uniqueness and existing library files are preserved. The root causes, detection rules, safe replacement procedure and remaining ToonGod limitation are described above.
