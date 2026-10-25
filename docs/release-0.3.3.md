# Bear Cave 0.3.3

- Download queue series can be collapsed individually or with Collapse all / Expand all. Collapsed preferences persist across refreshes and navigation, and hidden chapter cards are removed from the rendered page.
- Opening a series checks its existing library folder in the background. Recheck series folder repeats the check; Stop folder check cancels it. Valid existing chapters appear as Completed and are excluded from ordinary download selections. Missing or damaged known files update their status.
- Checks recognize Bear Cave manifests and other downloaders' numbered CBZ/ZIP archives or chapter image folders. A uniquely matching series folder and chapter number are required; conflicting translations, volumes or ComicInfo metadata are skipped. Supported external archives contain PNG, JPG or WebP pages, optionally ComicInfo.xml, with one image directory. RAR, PDF, encrypted ZIPs and volume/range bundles are not imported. Checks validate the image data and archive checksums, retain a content fingerprint, and leave chapter files unchanged. They do not create series folders.
- Cover art can be saved as real PNG or JPG. Set the default in local settings or choose a format on a series page. Existing artwork in the other format is retained; saved JPG and PNG covers can supply offline thumbnails.

Validation includes API and archive tests, desktop checks for automatic recognition of both downloaders' files, manual missing-file detection, persistent queue collapsing, and JPG output. All automated checks use temporary profiles and libraries. A separate read-only check validated the existing HunterXHunter ZIP without modifying it.

All 158 automated tests, typecheck, the production build and eight native Electron checks passed. External chapters with a page count that disagrees with the source's known count are skipped.
