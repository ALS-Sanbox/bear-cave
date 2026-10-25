# Bear Cave 0.3.1

Comix cover images could return HTTP 404 from Bear Cave even though the source image existed. The Comix CDN serves valid JPEG bytes as `image/jpg`; the source transports only accepted `image/jpeg`. Both JPEG MIME names are now accepted, with MIME boundaries checked and existing image-byte, host, redirect and size validation retained. Chapter output formats are unchanged.

The dashboard login form now supplies a hidden administrator username for browser password managers and names its password field. Authentication still uses the existing administrator password.

Validation: 145 automated tests, typecheck and production build passed. A temporary-profile live check retrieved PNG thumbnails through the real Comix transport and cover cache for MIME, Wangan Midnight: C1 Runner and From the Dust. The live check can be repeated with `node scripts/run-electron.mjs scripts/comix-cover-smoke.cjs` after building. It does not modify the installed app profile or library.

ToonGod remains disabled. The installed-browser prototype has not resolved its verification loop.
