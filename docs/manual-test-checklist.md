# Windows manual test checklist — 0.3.0

Automated checks use temporary data and offline fixtures. These user-controlled deployment checks remain separate. Use a small available chapter, not bulk live downloads. Do not install over an actively running engine; Quit from the tray first.

## Installation and existing data

- [ ] In a test Windows account, install the unsigned x64 NSIS artifact; verify launch, uninstall and preservation of app data/downloads.
- [ ] Upgrade a copy of an older library. Check the local .pre-v1.bak, original history/paths, running-job recovery and explicit/global pause persistence. Keep your normal library backup.
- [ ] Start a second instance: reuse the existing engine and Settings. Close browser/Settings; downloads continue. Quit releases the listener and aborts/drains work.
- [ ] Choose a short writable local root, format and sensible concurrency. Invalid/UNC/application paths fail. Port changes require restart. Change Start with Windows only intentionally, then test login/logout separately.

## Authentication and source access

- [ ] Successful dashboard sign-ins do not cause lockout. Repeated wrong passwords throttle. Local password replacement revokes browser sessions and permits the new password.
- [ ] Open MangaDex locally and try website sign-in. Independently test personal-client API login if you have an approved client. Check inline success/failure and encrypted storage; never share credentials or logs containing secrets.
- [ ] Complete normal local verification for a held source, then Retry affected downloads. Check held count/reason in Queue and Sources; reset a stale hold after removing the original jobs.
- [ ] Treat enabled connectors as enabled code, not proof of current access. ToonGod is removed. Comix uses a local browser renderer; pause for human checks and verify complete chapter pagination and lazy image collection.

## Downloads, identity and history

- [ ] Search a title, inspect lazy-loaded covers and fallback, choose language/group where supported, and check English-only source messaging. Reopen the browser and confirm preferences.
- [ ] Mix completed, queued and new chapters; confirmation reports all counts but asks only for new downloads. Change the queue in another tab before confirming and verify honest added/skipped results.
- [ ] Read one real CBZ and one image-folder chapter in a reader. Check every page and ordering. New output uses readable series/three-digit chapter names.
- [ ] Pause/cancel/Quit during a sufficiently long finalization, then retry. No partial output appears as completed; verified staged pages are reused.
- [ ] In a disposable download, remove or damage an output/page, then Verify downloaded file. Missing/damaged/inaccessible states differ. Requeue missing output; verify an explicit separate copy leaves a good original intact.
- [ ] Use two colliding sanitized titles/case variants from distinct identities, download covers, and rename source metadata in a fixture. Mapping and covers remain separate; existing paths do not move.

## Queue and following

- [ ] Expand/collapse series groups with keyboard and on mobile. Check aggregate progress, active chapter, counts, group pause/resume/retry/removal and individual actions.
- [ ] Remove an active entry and delete the entire queue. Work stops, completed history and saved files remain, and removed identities can be queued again.
- [ ] Page/search/filter a large history and queue. Hidden browser tabs stop polling; returning reconnects without overlapping refreshes.
- [ ] Follow/unfollow a series with a preferred translation. Check now persists attempt/success/next/error information. Download missing chapters uses the normal guarded preview.
- [ ] Opt into a schedule/output format and separately opt into automatic downloads. Checks run only while Bear Cave runs. Global pause suspends automatic checks, including an in-flight scheduled check.
- [ ] Resume after sleep/restart: one catch-up check per overdue series, staggered. Source errors back off and eventually pause the schedule. Additional translations never silently download.
- [ ] Change follow preferences while polling/checking; edits are retained and an old check cannot overwrite the new choices.

## Maintenance and remote access

- [ ] In a disposable library, cancel a staged download. Scan local staging storage and compare estimated bytes/entries. Paused/queued/active/followed recovery and completed files are excluded.
- [ ] Cancel the native cleanup confirmation; nothing is removed. Confirm a fresh scan; only eligible recognized staging and its interrupted CBZ .part are removed. Unrelated folders/files/junctions remain untouched.
- [ ] Follow the separate remote-access guide with your own tunnel. Test HTTPS host trust, Secure/HttpOnly/SameSite cookie, CSRF/origin rejection, covers, history, follows and controls on another device.
- [ ] Confirm there is no remote settings, filesystem picker/browser, staging cleanup, credential-management or arbitrary URL proxy endpoint.

Automated verification is recorded in verification-0.3.0.md. Real-account credentials, tunnel configuration and actual installer installation are intentionally left to you.
