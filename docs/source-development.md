# Source development

Implement SourceAdapter v1 in `src/shared/types.ts`: manifest, search, series, filtered chapter pagination, chapter metadata, ordered page resolution, optional account/session support. Register in `src/sources/registry.ts` and add fixture tests. The queue, API and source selector consume the contract without connector-specific changes. See [template](adapter-template.ts.txt).

IDs are opaque identities, not arbitrary URLs: alphanumeric/underscore/hyphen, up to 1,200 characters. MangaDex uses UUIDs; website adapters encode fixed-host canonical relative paths and validate the decoded destination again. Chapter source/series must match. Preserve translation IDs and language/group metadata. Totals must reflect filters before pagination, never just a filtered returned page. A null page count means unknown until resolution, not an empty/unavailable chapter. Optional readPage lets an adapter apply its own scoped pacing, session and Referer rules through SafeHttp; the queue still enforces the shared page semaphore.

Declare a stable source ID (`[a-z][a-z0-9-]{0,29}`), name, website, interface version/status, capabilities, verified API/image host rules and recommended limits. Never allow arbitrary domains. Use shared HTTP for validated initial URLs, redirects, DNS and final destinations. Return a stable revision/hash and URLs in source order; do not alphabetically sort page filenames. Expiring URLs must not be persisted or logged.

Use SourceError permanent/transient/expired/action_required. Challenges require human action, not endless retries. Share `sharedHttp` so rate limits/cooldowns cover all requests. A source with other request rules should add source-scoped gates to the helper, preserving validation; no queue special cases. Chapter concurrency is separate from request pacing.

## MangaDex verification

Checked October 20, 2026 against official API 5.13.1 from `https://api.mangadex.org/docs/api.yaml`:

- Search uses GET /manga, limit 20. Chapter lists use GET /chapter, manga, translatedLanguage[], optional groups[], expanded group metadata, limit 100. The manga feed does not declare groups[].
- Offset + limit cannot exceed 10,000; narrow filters rather than silently truncate. Listings exclude future, empty, unavailable and external chapters. Individual external/empty resolution fails explicitly.
- General allowance is approximately five requests/second/IP; at-home is forty/minute. Client minimum spacing: API 300 ms, at-home 1600 ms, images 500 ms. Honor Retry-After and X-RateLimit-Retry-After; other software shares your IP allowance.
- GET /at-home/server/{id}?forcePort443=true returns original chapter.data pages. Preserve token paths in baseUrl, documented as chapter-specific and valid fifteen minutes. Image hosts are uploads.mangadex.org or subdomains of mangadex.network; unfamiliar hosts fail closed.
- Public downloads need no account. Never send authorization to image hosts. Optional personal-client login is now implemented separately from public downloads; see accounts.md. Public authorization-code clients are documented as not yet available. Recheck current documentation before changing the supported flow.

## Local browser sessions

BrowserSessions supplies isolated persist:source-ID partitions for the website adapters. Local tray/Settings actions open them, never HTTP. The profile's URL-scoped cookies can be used by its own website transport, with unrelated CDN hosts excluded. Keep sandbox/context isolation, Node disabled, no preload and denied popups/permissions. Browser/DNS behavior needs connector-specific testing; browser cookie reuse does not guarantee access to protected sites. No CAPTCHA solving, proxy rotation or fingerprint spoofing is implemented.

Tests must cover fixtures for parsing, pagination, filters, translation identity, unavailable/external chapters, expiry refresh, page order and URL/challenge errors. Automated tests stay offline; live smoke checks are separate. Review licenses/access rules before copying source code.

## 0.3.0 optional contracts and recovery

ResolvedPages may include ordered identities separate from transport URLs. Revision/identities must change on additions, removals, reorderings and content changes detectable from source metadata. Prefer hashes/page IDs/immutable paths. WebsiteSource hashes identities before staging; never persist signing URLs. Only explicitly supported immutable image schemes may ignore enumerated authentication fields; unknown parameters and image selectors remain significant. Unknown schemes conservatively use the full URL's hash. Refresh must preserve revision/order/count or fail for explicit retry.

Series may carry a coverRef obtained from search metadata. The server keeps transport references private and uses its controlled source/id endpoint, bounded cache and existing SafeHttp restrictions. Optional cover(id, signal, reference) may reuse a validated reference without fetching every full series page. Validate reference destinations against image allowlists; do not accept arbitrary dashboard URLs. Persist followed covers by stable source/series key rather than signed URLs.

Staging v2 supports v1 conservatively. Streaming archive metadata keeps five-digit page order, checksums and bounded entry sizes. Source additions should test token-only changes, meaningful query changes, reordered/changed revisions, interrupted recovery, source holds and cover failures. Existing adapter v1 methods remain compatible; new fields are optional.
