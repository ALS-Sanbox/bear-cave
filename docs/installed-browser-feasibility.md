# Installed-browser feasibility review

Reviewed October 24, 2026 against elboletaire/manga-downloader commit `a4f68282ff4c05d47eb66417b1aa71a82d5679d0` (committed October 24, 2026). This review is not a live validation of that downloader against ToonGod on this PC. No upstream code was copied and no source was re-enabled. The original Bear Cave prototype and its live results are recorded below.

## What the other application actually does

- Locates an installed Chrome-family browser and drives it through chromedp/Chrome DevTools Protocol, rather than embedding Electron. Source: [browser/find.go](https://github.com/elboletaire/manga-downloader/blob/a4f68282ff4c05d47eb66417b1aa71a82d5679d0/browser/find.go), [browser/launch.go](https://github.com/elboletaire/manga-downloader/blob/a4f68282ff4c05d47eb66417b1aa71a82d5679d0/browser/launch.go).
- Explicitly marks ToonGod, DragonTea, ManhuaUS and some other sources as requiring a visible browser. Other sources can start headless and escalate to a visible window on a challenge timeout. The visible window is intentionally not minimized when the user may need to interact. Source: [grabber/plainhtmlbrowser.go](https://github.com/elboletaire/manga-downloader/blob/a4f68282ff4c05d47eb66417b1aa71a82d5679d0/grabber/plainhtmlbrowser.go), [browser/lifecycle.go](https://github.com/elboletaire/manga-downloader/blob/a4f68282ff4c05d47eb66417b1aa71a82d5679d0/browser/lifecycle.go).
- Includes a periodic detect-and-click attempt for a Cloudflare checkbox in a visible browser. This is not a general CAPTCHA solver. The application also notifies the user and waits for manual interaction when needed. Its launch code adjusts browser/automation identification signals. Source: [browser/browser.go](https://github.com/elboletaire/manga-downloader/blob/a4f68282ff4c05d47eb66417b1aa71a82d5679d0/browser/browser.go), [browser/visible.go](https://github.com/elboletaire/manga-downloader/blob/a4f68282ff4c05d47eb66417b1aa71a82d5679d0/browser/visible.go).
- Lets the site execute its own JavaScript, waits for chapter/reader selectors, and extracts rendered content. Some readers need scrolling, API-response capture or client-side navigation from a series page. The ToonGod/Madara entry waits for `li.wp-manga-chapter` and `div.reading-content`.
- Copies browser cookies and the real browser user agent into its plain HTTP downloader for subsequent image requests. This may be sufficient for some sites; the code is not proof that every protected request can be replayed outside the browser. Source: [http/session.go](https://github.com/elboletaire/manga-downloader/blob/a4f68282ff4c05d47eb66417b1aa71a82d5679d0/http/session.go).

## Comparison with Bear Cave

Bear Cave currently uses sandboxed Electron BrowserWindow instances and source-isolated Electron partitions. Comix already reads rendered browse cards, metadata, complete chapter pagination and lazy reader images. Images use that Electron session's fetch transport. A detected challenge currently stops with action_required. ToonGod remains removed from the active registry.

The main new component would be a second browser backend that can launch the installed Chrome or Edge executable and communicate through CDP. Both Chrome and Edge were found in their normal installation locations on this PC during this review. Finding them does not establish a successful ToonGod challenge or download.

## Feasible implementation

1. Add an optional installed-browser backend behind the existing render abstraction, using an application-owned profile for each protected source. Keep the user's ordinary Chrome profile separate.
2. Preserve URL/host/public-DNS checks, byte and page limits, cancellation, process ownership and clean shutdown. Keep debugging communication local and inaccessible through the public dashboard.
3. Support visible interaction, user notifications, time-bounded waits and automatic continuation when the real page becomes available. Background operation remains source dependent; ToonGod should not be assumed to work headless or minimized.
4. Prefer protected requests through the same browser context. Reusing only cookies and user agent outside that browser is an optimization to verify per site, rather than the default assumption.
5. Implement and test ToonGod's rendered search, complete chapter listing and ordered image extraction. Their series/reader selector entry is not itself a federated-search implementation. Existing folder mapping, verification, selection and queue/output logic can remain the integration points.
6. Re-enable ToonGod only after live search, metadata, complete chapter listing and an image download pass through this backend. Keep failures isolated in all-source search.

Checkbox automation is technically possible, as the inspected code demonstrates, but no universal unattended success follows from it. A live prototype should first establish whether an installed browser resolves the Electron-specific failure before deciding whether any additional interaction automation is useful.

The upstream repository is AGPL-3.0. This review records architecture and behavior; it does not incorporate its implementation or assess licensing obligations for a future code import.

## Installed-browser prototype and live results

An original TypeScript prototype now launches installed Chrome or Edge with a separate, application-owned profile. It communicates over inherited CDP process pipes, with no debugging TCP listener, and closes only the browser it owns. HTML navigation waits for rendered search, chapter or reader markup. Verification brings the dedicated window forward, allows bounded checkbox interaction and waits for the user. Cancellation leaves that window available until explicit browser shutdown.

Images travel through a separate background tab in the same browser profile. Fetch interception checks request destinations and redirect locations before continuing, then streams only supported image responses with a 32 MiB limit. HTML has an 8 MiB limit. Source HTML hosts, public-DNS checks, observed image-host admission limits, pacing, cancellation and shutdown are enforced. Browser cookies are neither read nor exported. No upstream fingerprint modifications or general CAPTCHA solver were added.

`Network.loadNetworkResource` was tested and rejected for this implementation: its requests bypassed Fetch interception in the installed Chrome probe. The retained transport instead intercepts the background tab's navigation and response body.

Validation on this PC:

- All 143 automated tests passed; nine specifically cover CDP framing, disconnects, cancellation, rendered HTML, streamed images, blocked redirects and response limits. Typecheck and production build passed.
- Installed Chrome downloaded and validated a real 13,504-byte PNG through the guarded image transport.
- The user reported that ToonGod loaded during the first visible test, but that test's timer expired before end-to-end validation completed. Reopening the same dedicated profile and searching for `swordmaster` produced another Cloudflare check. The search timed out after five minutes. No successful live ToonGod search, chapter list, reader or image download is claimed.

Consequently this remains a diagnostic prototype. The desktop source registry, default all-source search and released installer are unchanged. Restoring ToonGod still depends on passing its live search, series, chapter and image checks.

Explicit live commands (the ToonGod command opens a visible dedicated browser):

```powershell
npm.cmd run smoke:browser
npm.cmd run smoke:browser -- --toongod
```

The command prints its dedicated profile root. Set `BEAR_CAVE_LIVE_PROFILE_ROOT` to that same test root to reuse it on a later run. Do not point it at an ordinary personal Chrome profile. The ToonGod probe prints page title and selector counts to distinguish a verification page from changed site markup, and closes its own browser on completion or timeout.

### October 25 retry recovery

The user reported that search results appeared after manual verification. A follow-up live probe is required to validate extraction and downloads; that report alone does not establish either. Retrying an interrupted HTML request now preserves its unfinished page when the same URL is still open. Opening the source window also preserves that page instead of navigating home. A successful read clears this recovery state, so ordinary future reads still navigate afresh. The cancellation regression test verifies that reopening and retrying uses only one navigation.

For an interactive diagnostic session, `npm.cmd run smoke:browser -- --toongod --wait` keeps the same browser available and retries action-required reads for up to 30 minutes. Individual HTML waits remain bounded at five minutes. This prevents the smoke harness from closing the window at the first verification timeout; it does not solve verification or enable the source.

The subsequent interactive attempt remained on `Just a moment...`, with zero search-result, chapter and reader selectors observed. The user confirmed that verification kept repeating. The attempt was stopped rather than asking for further repetitions. Installed Chrome therefore has not resolved ToonGod access on this PC; the source remains disabled and no new installer was produced for this prototype.
