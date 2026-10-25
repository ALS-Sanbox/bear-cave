# MangaDex account login

MangaDex login is optional. Public search and downloads do not use stored account authorization and continue working if the account is signed out or needs attention.

1. Sign into your own account at [MangaDex settings](https://mangadex.org/settings).
2. Open its API client section and register a **personal client**. It must be approved/active, and only the account that owns it can use it.
3. Open Bear Cave's **local tray Settings**, then MangaDex account. Enter the personal-client ID, client secret, username and password **there**, not in chat or the remote dashboard.
4. Click Sign in to MangaDex. Bear Cave exchanges a form at the supported OAuth2 token endpoint, verifies `/user/me`, and displays the verified username.

The password is never saved. Client credentials and access/refresh tokens live in a DPAPI-encrypted file under `userData/secrets/mangadex-account.dpapi`, outside the repository. Expired sessions are refreshed when account status is requested. Remove saved account deletes the local token record; it does not revoke every session on MangaDex. Dashboard logout is separate from this source account. Token values/client secrets are never returned to either UI.

Current account functionality is sign-in, verified account status, secure persistence, refresh and local removal. Bookmarks/follows/reading-list synchronization are not implemented. Automated tests use fake tokens and deterministic responses. A real account login was not performed during implementation because no personal-client credentials were supplied.

MangaDex currently documents registered personal clients for this flow; public authorization-code clients remain documented as unavailable. See the [official personal-client instructions](https://api.mangadex.org/docs/02-authentication/personal-clients/). Recheck those instructions if registration or sign-in requirements change.

# Other source sessions

Use the tray's Open [source] session action or the Local source sessions buttons in Settings. Each has an isolated persistent Chromium profile. Complete normal site interaction manually, then retry the search/job. Session cookies are obtained only from that source's local profile and scoped by URL; credentials are not exposed to HTTP API callers or unrelated CDN hosts.

Windows are sandboxed, have Node integration disabled, use context isolation, have no privileged preload, and deny popups/permissions and unrelated destinations. The browser guard checks destination hosts/public DNS; Node source fetches additionally pin validated DNS addresses. Browser sessions cannot promise successful access to protected sources. ToonGod desktop requests now use Electron session.fetch in the exact persistent Chromium session used by its local window, retaining native cookie handling and the genuine session user agent. It no longer copies ToonGod clearance cookies into Node HTTP requests. Canonical www/apex redirects are validated explicitly. A fresh challenge still requires manual interaction; the connector never executes or automatically clears challenge pages. No CAPTCHA solving, fingerprint spoofing or universal challenge bypass is implemented. Paid/app-only content is not unlocked.

## Source holds in 0.3.0

After completing local interaction, use Retry affected downloads in Sources or Queue. It releases eligible held jobs and can clear stale holds even after their original jobs were removed. Global pause and source request cooldowns still apply. The button does not verify login success or label the connector healthy. Followed Series preferences and schedules are local application data, not synchronization with a source account library.

## Removed source

ToonGod is no longer registered or offered in local-session actions. The earlier ToonGod transport description is historical. Its saved profile is retained without being used. Comix now uses rendered pages in its own persistent desktop Chromium session. The Native Comix section below supersedes the earlier unavailable catalog entry.

## Native Comix session

Comix is enabled for desktop search and downloads using its ordinary rendered browse, series, chapter-list and reader pages. The source session button opens Comix in the same profile. Human checks require manual completion; the renderer stops on a detected challenge. No cookies are exported to Node. Image requests use the same session, and rendered image destinations are HTTPS/public-DNS checked before use.
