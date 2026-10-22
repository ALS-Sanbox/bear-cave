# Bear Cave 0.3.0

Coordinated library/recovery release, October 22, 2026.

- Stable ordered page identities are separated from expiring transports. Staging v2 verifies reusable pages; unknown identity schemes remain conservative.
- CBZ writing and validation stream data instead of buffering entire chapters. Legacy deflated archives remain readable; cancellation preserves recovery data.
- History gains integrity checks, missing-file recovery and explicit separate-copy downloads without discarding a good original.
- Indexed SQLite queries, trigger-maintained series totals, bounded pagination/search/filters, and non-overlapping visibility-aware polling support large libraries.
- Source-level Retry affected downloads releases eligible holds, including stale holds with no remaining original jobs.
- Actual covers use an authenticated bounded cache, source allowlists and graceful mark fallback. Full coverart.png uses the same collision-safe folder mapping as chapters.
- Chapter rows show local state. Previews count completed/existing/new chapters separately and recheck translations/duplicates inside the enqueue transaction.
- Queue entries are collapsible series groups with covers, counts, progress and per-series/per-chapter actions.
- Language/group controls match source support, with friendly language names and remembered source preferences.
- Followed Series persists translation/output preferences, manual checks, guarded missing-chapter previews and opt-in schedules/downloads. Checks are staggered, cancelable, bounded and paused after repeated failures.
- Login throttling counts only failures. Trusted password replacement also invalidates old in-flight authentication.
- Persistent folder identity handles case, truncation, title and cross-source collisions while retaining existing paths.
- Local staging maintenance estimates eligible abandoned data and requires native confirmation; recovery still needed by active/queued/paused/followed work and completed output is excluded.
- Vue is split into views/components/composables; source is formatted using existing project parsers.

## Compatibility and limits

The SQLite migration backs up legacy data before adding schema. Derived statistics do not rewrite original records. Existing archives/folders remain in place. History represents the latest attempt per source/chapter; separate copies remain on disk and previous paths stay private in SQLite. Unknown legacy/untracked folders are not automatically cleaned or merged.

Archive limits are 32 MiB per image, 2,000 pages and a below-4-GiB streaming ZIP32 archive. Folder output has no aggregate CBZ cap. Sources without stable content/version information cannot reveal overwritten bytes at the same unchanged identity. Website sources are English-only. Website sessions remain distinct from MangaDex personal-client API tokens.

ToonGod's protected live reader, real-account sign-in, a reader's rendering of real chapters, Cloudflare deployment and installer installation remain manual checks. No verification/payment bypass is implemented. The installer remains unsigned and there is no automatic updater.

See [verification](verification-0.3.0.md), [manual checklist](manual-test-checklist.md), [architecture](architecture.md) and [source status](source-status.md).
