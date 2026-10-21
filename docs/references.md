# References and license review

Version 0.2.0 additionally uses the current public Asura, Flame, ThunderScans and WEBTOON website markup, synthetic parser fixtures, [MangaDex personal-client documentation](https://api.mangadex.org/docs/02-authentication/personal-clients/), [Cheerio loading documentation](https://cheerio.js.org/docs/basics/loading/) and [Sharp resizing documentation](https://sharp.pixelplumbing.com/api-resize/). ToonGod returned a verification page and was not claimed live-validated. Logos were supplied by the repository owner; originals are preserved. Cheerio is MIT; Sharp is Apache-2.0 and is used only during asset generation. Installed dependencies retain their own notices.

Reviewed October 20, 2026. All implementation is original; no HakuNeko or mangadex-downloader source code was copied, vendored or imported.

| Reference | Use |
| --- | --- |
| [MangaDex API docs](https://api.mangadex.org/docs/) and [OpenAPI](https://api.mangadex.org/docs/api.yaml) | Directly fetched current 5.13.1 schema: chapter filtering/pagination, availability and at-home URL construction |
| [MangaDex limits](https://api.mangadex.org/docs/2-limitations/) | Directly fetched request limits, user-agent requirements and collection bounds |
| [MangaDex authentication](https://api.mangadex.org/docs/02-authentication/) | Directly fetched OAuth2/client availability; v0.2 adds the documented personal-client flow |
| [HakuNeko Developer Manual](https://github.com/manga-download/hakuneko/wiki/Developer-Manual) | Connector separation/design reference; repository declares Unlicense in UNLICENSE |
| [mansuf/mangadex-downloader](https://github.com/mansuf/mangadex-downloader) | Standalone source downloader design reference; LICENSE is MIT, copyright Rahman Yusuf |
| [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) | Sandboxing, isolation and remote-content boundaries |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | Windows DPAPI token vault, distinct from dashboard password hashes |
| [Node SQLite](https://nodejs.org/api/sqlite.html) | DatabaseSync and SQLite statements |
| [Vue quick start](https://vuejs.org/guide/quick-start.html), [Vite guide](https://vite.dev/guide/) | Vue/TypeScript compiled UI and production build |
| [electron-builder](https://www.electron.build/), [NSIS](https://www.electron.build/nsis/) | Stable npm electron-builder 26.15.3 and per-user Windows installer |
| [Cloudflare configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/) | Separate tunnel ingress/hostname configuration |

The web reader could not retrieve MangaDex documentation, but direct Node HTTPS fetches succeeded; the API spec and limitations/authentication pages were inspected locally. Dependency versions were checked through the npm registry, then pinned by package-lock.json (Electron 44.9.2, Vue 3.5.44, Vite 8.3.4, electron-builder 26.15.3).

No borrowed-code notices are required from the two design references because no code was reused. Their license terms must be rechecked and notices retained if future code is copied. npm dependency license files remain with installed/packaged dependencies; Electron's bundled LICENSE and Chromium third-party notices remain in the packaged application directory. The project does not claim ownership of downloaded manga or source content.
