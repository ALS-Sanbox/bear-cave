import { BrowserWindow, type Session } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceError } from '../shared/types.js';
export type RenderMode = 'browse' | 'series' | 'chapters' | 'reader';
// Reads ordinary rendered site content. A challenge stops the request for local human interaction.
export async function renderSource(partition: Session, url: string, mode: RenderMode, signal: AbortSignal | undefined, register: (window: BrowserWindow) => void) {
    const deadline = AbortSignal.any([AbortSignal.timeout(mode === 'browse' ? 30000 : 180000), ...(signal ? [signal] : [])]);
    deadline.throwIfAborted();
    const window = new BrowserWindow({
        show: false, width: 1100, height: 900, webPreferences: {
            session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
        }
    });
    register(window);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const stop = () => {
        if (!window.isDestroyed())
            window.destroy();
    };
    deadline.addEventListener('abort', stop, { once: true });
    let navigationError: Error | undefined;
    void window.loadURL(url).catch(e => {
        if (!window.isDestroyed() && e.code !== 'ERR_ABORTED')
            navigationError = e;
    });
    async function evaluate<T>(script: string): Promise<T> {
        deadline.throwIfAborted();
        if (navigationError)
            throw new SourceError('Comix browser navigation failed. Open its local source window and retry.', 'action_required');
        return window.webContents.executeJavaScript(script, true);
    }
    async function wait<T>(script: string, ms = 30000): Promise<T> {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            deadline.throwIfAborted();
            try {
                const state = await evaluate<{
                    challenge: boolean;
                    value: T;
                }>(`(()=>({challenge:/just a moment|attention required/i.test(document.title)||!!document.querySelector('form#challenge-form'),value:(${script})}))()`);
                if (state.challenge)
                    throw new SourceError('Comix needs human verification. Open its local source window, complete the check, then retry.', 'action_required');
                if (state.value)
                    return state.value;
            }
            catch (e) {
                if (e instanceof SourceError || deadline.aborted || navigationError)
                    throw e;
                // Navigation can briefly destroy the previous JavaScript context.
            }
            await delay(150, undefined, { signal: deadline });
        }
        throw new SourceError('Comix did not finish loading this page. Open its local source window and check for a challenge or site error.', 'action_required');
    }
    try {
        if (mode === 'browse') {
            await wait(`document.querySelector('a[href^="/title/"]') || /0 items|no results|no titles|nothing found/i.test(document.body?.innerText || '')`);
            await delay(350, undefined, { signal: deadline });
        }
        else if (mode === 'series') {
            await wait(`document.querySelector('h1.mpage__title')`);
        }
        else if (mode === 'chapters') {
            await wait(`document.querySelector('.mchap-item')`);
            const rows = new Map<string, string>(), signatures = new Set<string>();
            for (let page = 0;; page++) {
                if (page >= 500)
                    throw new SourceError('Comix chapter list exceeds the page limit.');
                const snapshot = await evaluate<{
                    rows: {
                        id: string;
                        html: string;
                    }[];
                    signature: string;
                    next: boolean;
                }>(`(()=>{const rows=[...document.querySelectorAll('.mchap-item')].map(e=>({id:e.querySelector('a[href*="-chapter-"]')?.getAttribute('href')||'',html:e.outerHTML}));const next=document.querySelector('.npager button[aria-label="Next page"]');return{rows,signature:rows.map(r=>r.id).join('|'),next:!!next&&!next.disabled&&next.getAttribute('aria-disabled')!=='true'}})()`);
                if (!snapshot.rows.length || signatures.has(snapshot.signature))
                    throw new SourceError('Comix chapter pagination did not advance. Partial lists are not used.');
                signatures.add(snapshot.signature);
                snapshot.rows.forEach(r => {
                    if (r.id)
                        rows.set(r.id, r.html);
                });
                if (rows.size > 10000)
                    throw new SourceError('Comix chapter list exceeds 10,000 entries.');
                if (!snapshot.next)
                    break;
                await evaluate(`document.querySelector('.npager button[aria-label="Next page"]').click()`);
                await wait(`(()=>{const rows=[...document.querySelectorAll('.mchap-item a[href*="-chapter-"]')].map(e=>e.getAttribute('href'));return rows.length&&rows.join('|')!==${JSON.stringify(snapshot.signature)}&&!document.querySelector('.mchap-list[aria-busy="true"]')})()`);
                await delay(300, undefined, { signal: deadline });
            }
            return '<html><body><ul>' + [...rows.values()].join('') + '</ul></body></html>';
        }
        else {
            const count = await wait<number>(`document.querySelectorAll('.rpage-page[data-page]').length`);
            if (count > 2000)
                throw new SourceError('Comix reader exceeds the page limit.');
            const images: string[] = [];
            for (let page = 1; page <= count; page++) {
                await evaluate(`document.querySelector('.rpage-page[data-page="${page}"]').scrollIntoView({block:'center',behavior:'instant'})`);
                let image: string;
                try {
                    image = await wait<string>(`(()=>{const p=document.querySelector('.rpage-page[data-page="${page}"]');const main=p?.closest('.rpage-main');if(main){main.scrollTop+=p.getBoundingClientRect().top-main.getBoundingClientRect().top;main.dispatchEvent(new Event('scroll'));}const e=p?.querySelector('img.rpage-page__img');if(!e||!e.src.startsWith('https://'))return '';const copy=document.createElement('img');copy.setAttribute('data-bear-cave-page','${page}');copy.src=e.src;return copy.outerHTML})()`, 15000);
                }
                catch (e) {
                    deadline.throwIfAborted();
                    throw new SourceError(`Comix reader page ${page} of ${count} did not load. Open the local Comix window to check access, then retry.`, 'action_required');
                }
                images.push(image);
            }
            return '<html><body>' + images.join('') + '</body></html>';
        }
        const html = await evaluate<string>('document.documentElement.outerHTML');
        if (Buffer.byteLength(html) > 8 * 1024 * 1024)
            throw new SourceError('Comix page exceeds the size limit.');
        return html;
    }
    finally {
        deadline.removeEventListener('abort', stop);
        stop();
    }
}
