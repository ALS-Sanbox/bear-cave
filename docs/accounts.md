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

Windows are sandboxed, have Node integration disabled, use context isolation, have no privileged preload, and deny popups/permissions and unrelated destinations. The browser guard checks destination hosts/public DNS; Node source fetches additionally pin validated DNS addresses. Browser sessions cannot promise successful access to protected sources. ToonGod currently returns a verification page, and cookie reuse alone may not satisfy its protection. No CAPTCHA solving, fingerprint spoofing or universal challenge bypass is implemented. Paid/app-only content is not unlocked.
