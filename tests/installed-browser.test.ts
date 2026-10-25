import { it, expect } from 'vitest';
import { InstalledBrowser } from '../src/desktop/installed-browser.js';
import type { CdpConnection } from '../src/desktop/cdp-pipe.js';
class FakeCdp implements CdpConnection {
    closed = false;
    calls: {
        method: string;
        params: any;
        session?: string;
    }[] = [];
    listeners = new Set<(method: string, params: any, session?: string) => void>();
    targets = 0;
    url = 'https://www.toongod.org/';
    challenge = false;
    imageType = 'image/png';
    redirect = '';
    length = 4;
    private stages = new Set<string>();
    emit(method: string, params: any, session?: string) { for (const fn of this.listeners)
        fn(method, params, session); }
    async send(method: string, params: any = {}, session?: string) {
        this.calls.push({ method, params, session });
        if (method === 'Target.createTarget')
            return { targetId: String(++this.targets) };
        if (method === 'Target.attachToTarget')
            return { sessionId: 's' + params.targetId };
        if (method === 'Page.navigate') {
            if (session === 's1')
                this.url = params.url;
            else
                queueMicrotask(() => this.emit('Fetch.requestPaused', { requestId: 'image', request: { url: params.url }, resourceType: 'Document' }, session));
            return {};
        }
        if (method === 'Fetch.continueRequest' && session === 's2') {
            if (!this.stages.has(params.requestId)) {
                this.stages.add(params.requestId);
                queueMicrotask(() => this.emit('Fetch.requestPaused', { requestId: params.requestId, request: { url: 'https://images.example/page.png' }, resourceType: 'Document', responseStatusCode: this.redirect ? 302 : 200, responseHeaders: this.redirect ? [{ name: 'location', value: this.redirect }] : [{ name: 'content-type', value: this.imageType }, { name: 'content-length', value: String(this.length) }] }, session));
            }
            return {};
        }
        if (method === 'Runtime.evaluate') {
            if (params.expression === 'location.href')
                return { result: { value: this.url } };
            if (params.expression === 'document.documentElement.outerHTML')
                return { result: { value: '<html><h1>Fixture</h1><li class="wp-manga-chapter"><a href="/webtoon/fixture/chapter-1/">Chapter 1</a></li></html>' } };
            if (params.expression.startsWith('[...document.images]'))
                return { result: { value: ['https://images.example/page.png'] } };
            if (params.expression.includes('const challenge='))
                return { result: { value: { url: this.url, challenge: this.challenge, ready: !this.challenge, signature: 'complete', count: 1 } } };
            return { result: { value: null } };
        }
        if (method === 'Fetch.takeResponseBodyAsStream')
            return { stream: 'fixture-stream' };
        if (method === 'IO.read')
            return { data: Buffer.from('page').toString('base64'), base64Encoded: true, eof: true };
        return {};
    }
    onEvent(listener: (method: string, params: any, session?: string) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() { this.closed = true; }
}
function fixture() { const client = new FakeCdp(), hosts = ['www.toongod.org', 'toongod.org', 'images.example']; let stopped = false; const browser = new InstalledBrowser('unused-fixture-profile', hosts, { launch: async () => ({ client, stop: async () => { stopped = true; client.close(); } }), guard: async (url) => { if (url.hostname === 'private.example')
        throw Error('Private DNS'); } }); return { browser, client, hosts, stopped: () => stopped }; }
it('returns rendered source HTML and streams images through guarded browser requests', async () => { const f = fixture(); try {
    expect(await f.browser.html('https://www.toongod.org/?s=fixture', ['www.toongod.org'])).toContain('wp-manga-chapter');
    expect((await f.browser.get('https://images.example/page.png', f.hosts, undefined, true, { referer: 'https://www.toongod.org/' })).toString()).toBe('page');
    expect(f.client.calls.find(c => c.method === 'Page.navigate' && c.session === 's2')?.params.referrer).toBe('https://www.toongod.org/');
    expect(f.client.calls.some(c => c.method === 'Network.loadNetworkResource')).toBe(false);
    expect(f.client.calls.some(c => c.method === 'IO.close')).toBe(true);
    expect(f.client.calls.some(c => c.method === 'Fetch.failRequest')).toBe(true);
}
finally {
    await f.browser.close();
} expect(f.stopped()).toBe(true); });
it('rejects private redirects before any image body is read', async () => { const f = fixture(); f.client.redirect = 'https://127.0.0.1/private'; try {
    await expect(f.browser.get('https://images.example/page.png', f.hosts, undefined, true)).rejects.toThrow('not allowed');
    expect(f.client.calls.some(c => c.method === 'IO.read')).toBe(false);
}
finally {
    await f.browser.close();
} });
it('rejects HTML and oversized images without reading them', async () => { for (const mode of ['html', 'large']) {
    const f = fixture();
    if (mode === 'html')
        f.client.imageType = 'text/html';
    else
        f.client.length = 33 * 1024 * 1024;
    try {
        await expect(f.browser.get('https://images.example/page.png', f.hosts, undefined, true)).rejects.toThrow(mode === 'html' ? 'image access failed' : 'size limit');
        expect(f.client.calls.some(c => c.method === 'IO.read')).toBe(false);
    }
    finally {
        await f.browser.close();
    }
} });
it('keeps a challenge available for human interaction and cancels the wait', async () => { const f = fixture(), controller = new AbortController(); f.client.challenge = true; const pending = f.browser.html('https://www.toongod.org/?s=fixture', ['www.toongod.org'], controller.signal); const timer = setTimeout(() => controller.abort(), 80); try {
    await expect(pending).rejects.toThrow();
    expect(f.client.calls.some(c => c.method === 'Page.bringToFront')).toBe(true);
    expect(f.stopped()).toBe(false);
    await f.browser.open();
    f.client.challenge = false;
    await expect(f.browser.html('https://www.toongod.org/?s=fixture', ['www.toongod.org'])).resolves.toContain('wp-manga-chapter');
    expect(f.client.calls.filter(c => c.method === 'Page.navigate')).toHaveLength(1);
}
finally {
    clearTimeout(timer);
    await f.browser.close();
} });
it('refuses foreign HTML destinations and unobserved image hosts before browser startup', async () => { const f = fixture(); try {
    await expect(f.browser.html('https://evil.example/private', ['evil.example'])).rejects.toThrow('not allowed');
    await expect(f.browser.get('https://other.example/private', ['other.example'], undefined, true)).rejects.toThrow('not allowed');
    expect(f.client.calls).toHaveLength(0);
}
finally {
    await f.browser.close();
} });
