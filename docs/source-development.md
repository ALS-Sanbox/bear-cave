# Source development

Implement SourceAdapter v1 in `src/shared/types.ts`: manifest, search, series, filtered chapter pagination, chapter metadata, ordered page resolution, optional account/session support. Register in `src/sources/registry.ts` and add fixture tests. The queue, API and source selector consume the contract without connector-specific changes. See [template](adapter-template.ts.txt).

IDs are opaque identities, not URLs: alphanumeric/underscore/hyphen, 1–200 characters. Adapters may validate more narrowly; MangaDex uses UUIDs. Chapter source/series must match. Preserve distinct translation IDs and language/group metadata. Totals must reflect filters before pagination, never just a filtered returned page.

Declare a stable source ID (`[a-z][a-z0-9-]{0,29}`), name, website, interface version/status, capabilities, verified API/image host rules and recommended limits. Never allow arbitrary domains. Use shared HTTP for validated initial URLs, redirects, DNS and final destinations. Return a stable revision/hash and URLs in source order; do not alphabetically sort page filenames. Expiring URLs must not be persisted or logged.

Use SourceError permanent/transient/expired/action_required. Challenges require human action, not endless retries. Share `sharedHttp` so rate limits/cooldowns cover all requests. A source with other request rules should add source-scoped gates to the helper, preserving validation; no queue special cases. Chapter concurrency is separate from request pacing.

## MangaDex verification

Checked October 20, 2026 against official API 5.13.1 from `https://api.mangadex.org/docs/api.yaml`:

- Search uses GET /manga, limit 20. Chapter lists use GET /chapter, manga, translatedLanguage[], optional groups[], expanded group metadata, limit 100. The manga feed does not declare groups[].
- Offset + limit cannot exceed 10,000; narrow filters rather than silently truncate. Listings exclude future, empty, unavailable and external chapters. Individual external/empty resolution fails explicitly.
- General allowance is approximately five requests/second/IP; at-home is forty/minute. Client minimum spacing: API 300 ms, at-home 1600 ms, images 500 ms. Honor Retry-After and X-RateLimit-Retry-After; other software shares your IP allowance.
- GET /at-home/server/{id}?forcePort443=true returns original chapter.data pages. Preserve token paths in baseUrl, documented as chapter-specific and valid fifteen minutes. Image hosts are uploads.mangadex.org or subdomains of mangadex.network; unfamiliar hosts fail closed.
- Public downloads need no account. Never send authorization to image hosts. Account support is deferred: current docs describe registered OAuth2 personal clients tied to their owner; public authorization-code clients are documented as not yet available. Recheck docs before implementation; do not invent a legacy password endpoint.

## Future browser sessions

BrowserSessions prepares isolated persist:source-ID partitions and optional browser account login URLs. No shipped adapter uses it. A registered browser account can expose a local tray action, never HTTP. Keep sandbox/context isolation, disable Node, omit preload, deny popups/permissions. A browser window alone is not working account support: future integrations need session-to-adapter contracts and navigation/DNS/isolation tests. No CAPTCHA solving, proxy rotation or fingerprint spoofing is implemented.

Tests must cover fixtures for parsing, pagination, filters, translation identity, unavailable/external chapters, expiry refresh, page order and URL/challenge errors. Automated tests stay offline; live smoke checks are separate. Review licenses/access rules before copying source code.
