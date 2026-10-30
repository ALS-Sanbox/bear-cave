import { SourceError, type Settings } from '../shared/types.js';
import { SafeHttp, type RequestOptions } from './http.js';
import type { WebsiteTransport } from './website.js';
// HTTP remains the fast path. Only the source's own isolated browser profile is reused.
export class BrowserAssistedTransport implements WebsiteTransport {
    private browserUntil = 0;
    private enabled = true;
    private useInstalled = false;
    constructor(private normal: SafeHttp, private session: WebsiteTransport, private render: (url: string, signal?: AbortSignal) => Promise<string>, private installed?: WebsiteTransport) {
    }
    configureDownloads(settings: Settings, source?: string, minimum?: number, fallback?: number) {
        this.enabled = settings.browserAssisted !== false;
        this.normal.configureDownloads(settings, source, minimum, fallback);
        this.session.configureDownloads?.(settings, source, minimum, fallback);
    }
    get retryCount() {
        return this.normal.retryCount + ((this.session as {
            retryCount?: number;
        }).retryCount ?? 0);
    }
    private async retrieve<T>(normal: () => Promise<T>, browser: () => Promise<T>): Promise<T> {
        if (this.enabled && this.browserUntil > Date.now())
            return browser();
        try {
            return await normal();
        }
        catch (e) {
            if (!this.enabled || !(e instanceof SourceError) || e.kind !== 'action_required')
                throw e;
            const value = await browser();
            this.browserUntil = Date.now() + 10 * 60 * 1000;
            return value;
        }
    }
    async html(url: string, hosts: string[], signal?: AbortSignal, cookies?: RequestOptions['cookies']) {
        const browser = async () => {
            if (this.useInstalled && this.installed)
                return this.installed.html(url, hosts, signal);
            try {
                return await this.session.html(url, hosts, signal);
            }
            catch (e) {
                if (!(e instanceof SourceError) || e.kind !== 'action_required')
                    throw e;
                try {
                    return await this.render(url, signal);
                }
                catch (renderError) {
                    if (!this.installed || !(renderError instanceof SourceError) || renderError.kind !== 'action_required')
                        throw renderError;
                    this.useInstalled = true;
                    return this.installed.html(url, hosts, signal);
                }
            }
        };
        const html = await this.retrieve(() => this.normal.html(url, hosts, signal, cookies), browser);
        if (this.enabled && /id=["'](?:root|app|__next)["']/i.test(html) && !/<(?:h1|a)\b/i.test(html))
            return this.render(url, signal);
        return html;
    }
    get(url: string, hosts: string[], signal?: AbortSignal, image = false, options: RequestOptions = {}) {
        return this.retrieve(() => this.normal.get(url, hosts, signal, image, options), () => (this.useInstalled && this.installed ? this.installed : this.session).get(url, hosts, signal, image, options));
    }
    async getToFile(url: string, hosts: string[], file: string, signal?: AbortSignal, options: RequestOptions = {}) {
        await this.retrieve(() => this.normal.getToFile(url, hosts, file, signal, options), async () => {
            const session = this.useInstalled && this.installed ? this.installed : this.session;
            if (session.getToFile)
                return session.getToFile(url, hosts, file, signal, options);
            const { writeFile } = await import('node:fs/promises');
            await writeFile(file, await session.get(url, hosts, signal, true, options));
        });
    }
}
