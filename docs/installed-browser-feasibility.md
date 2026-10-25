# Installed-browser feasibility review

Reviewed October 24, 2026 against elboletaire/manga-downloader commit `a4f68282ff4c05d47eb66417b1aa71a82d5679d0` (committed October 24, 2026). This is a source review, not a live validation of that downloader against ToonGod on this PC. No upstream code was copied and no source was re-enabled.

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
