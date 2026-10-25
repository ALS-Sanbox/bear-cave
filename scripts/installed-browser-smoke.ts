import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InstalledBrowser, launchInstalledBrowser, type OwnedBrowser } from '../src/desktop/installed-browser.js';
import { WordPressSource } from '../src/sources/wordpress.js';
import { imageExtension } from '../src/engine/files.js';
import { SourceError } from '../src/shared/types.js';
import { setTimeout as delay } from 'node:timers/promises';
// Explicit live probe. Its dedicated profile never uses the user's ordinary Chrome profile.
const toongod = process.argv.includes('--toongod');
const waitForVerification = process.argv.includes('--wait');
const root = process.env.BEAR_CAVE_LIVE_PROFILE_ROOT || await mkdtemp(path.join(os.tmpdir(), 'bear-cave-browser-smoke-'));
const hosts = toongod ? ['www.toongod.org', 'toongod.org', '*.toongod.org'] : ['www.google.com'];
let owned: OwnedBrowser | undefined, inspecting = false, lastStatus = '';
const browser = new InstalledBrowser(path.join(root, 'profile'), hosts, {
    launch: async (profile) => { owned = await launchInstalledBrowser(profile); return owned; },
    attention: () => console.log('Complete verification in the dedicated Chrome window; this test will continue automatically.')
});
console.log('Dedicated test profile root:', root);
const status = setInterval(() => {
    if (!toongod || !owned || inspecting || owned.client.closed)
        return;
    inspecting = true;
    void (async () => {
        const client = owned!.client;
        const targets = await client.send('Target.getTargets');
        const target = targets.targetInfos.find((t: any) => t.type === 'page' && /^https:\/\/(www\.)?toongod\.org\//.test(t.url));
        if (!target)
            return;
        const attached = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        try {
            const result = await client.send('Runtime.evaluate', {
                expression: `JSON.stringify({title:document.title,path:location.pathname,searchResults:document.querySelectorAll('.c-tabs-item__content,.bsx').length,chapters:document.querySelectorAll('.wp-manga-chapter a[href]').length,readerImages:document.querySelectorAll('.reading-content img').length})`, returnByValue: true
            }, attached.sessionId);
            const message = result.result?.value;
            if (message && message !== lastStatus) {
                lastStatus = message;
                console.log('Visible source page:', message);
            }
        }
        finally {
            await client.send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => { });
        }
    })().catch(() => { }).finally(() => { inspecting = false; });
}, 15000);
try {
    if (!toongod) {
        const bytes = await browser.get('https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png', hosts, AbortSignal.timeout(60000), true);
        console.log('Guarded installed-browser image:', bytes.length, imageExtension(bytes));
    }
    else {
        const source = new WordPressSource('toongod', browser);
        source.manifest.imageHosts = hosts;
        const signal = AbortSignal.timeout((waitForVerification ? 30 : 10) * 60 * 1000);
        async function step<T>(read: () => Promise<T>): Promise<T> {
            for (;;) {
                signal.throwIfAborted();
                try { return await read(); }
                catch (error) {
                    if (!waitForVerification || signal.aborted || !(error instanceof SourceError) || error.kind !== 'action_required' || owned?.client.closed) throw error;
                    console.log('Still waiting for verification; keeping the same window and page available for retry.');
                    await delay(1000, undefined, { signal });
                }
            }
        }
        const search = await step(() => source.search('swordmaster', 0, signal));
        console.log('ToonGod search:', search.items.map(s => s.title));
        if (!search.items.length)
            throw Error('No matching titles');
        const series = await step(() => source.series(search.items[0].id, signal));
        console.log('ToonGod series:', series.title);
        const chapters = await step(() => source.chapters(series.id, { language: 'en' }, 0, signal));
        console.log('ToonGod chapters:', chapters.total);
        if (!chapters.items.length)
            throw Error('No chapters');
        const pages = await step(() => source.resolve(chapters.items[0].id, signal));
        console.log('ToonGod reader:', pages.urls.length, 'pages');
        const bytes = await source.readPage(pages.urls[0], signal);
        console.log('ToonGod image:', bytes.length, imageExtension(bytes));
    }
}
finally {
    clearInterval(status);
    await browser.close();
}
