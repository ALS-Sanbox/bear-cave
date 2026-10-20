import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceError } from '../shared/types.js';

// IPv6 is deliberately rejected: public IPv4-only resolution also excludes IPv4-mapped tricks.
export function publicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function validateUrl(input: string, hosts: string[]): URL {
  const u = new URL(input);
  if (u.protocol !== 'https:' || u.port && u.port !== '443' || u.username || u.password || u.hash || isIP(u.hostname)) throw new SourceError('Source URL is not allowed.');
  if (!hosts.some(rule => rule.startsWith('*.') ? u.hostname.endsWith(rule.slice(1)) && u.hostname !== rule.slice(2) : u.hostname === rule)) throw new SourceError('Source host is not allowed.');
  return u;
}
export class Gate {
  private tail = Promise.resolve(); private next = 0; private blockedUntil = 0;
  constructor(private interval: number) {}
  block(ms: number) { this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms); }
  async wait(signal?: AbortSignal) {
    let release!: () => void; const prior = this.tail; this.tail = new Promise<void>(r => { release = r; });
    await prior;
    try { do { await delay(Math.max(0, this.next - Date.now(), this.blockedUntil - Date.now()), undefined, { signal }); } while (this.blockedUntil > Date.now()); this.next = Date.now() + this.interval; } finally { release(); }
  }
}
export function retryAfter(value: string | undefined): number {
  if (!value) return 0; const seconds = Number(value); return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()) || 0;
}
export class SafeHttp {
  private api = new Gate(300); private atHome = new Gate(1600); private images = new Gate(500);
  async get(input: string, hosts: string[], signal?: AbortSignal, image = false): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.request(input, hosts, signal, image); }
      catch (e) {
        if (signal?.aborted) throw e;
        if (!(e instanceof SourceError) || e.kind !== 'transient' || attempt >= 3) throw e;
        await delay(Math.max(e.retryAfterMs, 1000 * 2 ** attempt), undefined, { signal });
      }
    }
  }
  private async request(input: string, hosts: string[], signal?: AbortSignal, image = false, redirects = 0): Promise<Buffer> {
    const u = validateUrl(input, hosts); await (image ? this.images : this.api).wait(signal);
    if (u.pathname.startsWith('/at-home/server/')) await this.atHome.wait(signal);
    const records = await lookup(u.hostname, { all: true, family: 4 });
    if (!records.length || records.some(r => !publicIPv4(r.address))) throw new SourceError('Source DNS resolved to a blocked address.');
    const address = records[0].address;
    // Pin the validated DNS result in the actual socket connection, preventing DNS rebinding.
    const response = await new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const req = https.get(u, { signal, agent: false, family: 4, lookup: (_host, _options, cb) => cb(null, address, 4), headers: { 'User-Agent': 'BearCave/0.1 (personal manga downloader)', Accept: image ? 'image/*' : 'application/json', 'Accept-Encoding': 'identity' } }, res => {
        const chunks: Buffer[] = []; let size = 0; const max = image ? 32 * 1024 * 1024 : 8 * 1024 * 1024;
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > max) { req.destroy(new SourceError('Source response exceeds size limit.')); } else chunks.push(chunk); });
        res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode ?? 500, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.setTimeout(30_000, () => req.destroy(new SourceError('Source request timed out.', 'transient')));
      req.on('error', e => reject(e instanceof SourceError || signal?.aborted ? e : new SourceError('Source network request failed.', 'transient')));
    });
    const { status, headers, body } = response;
    if ([301,302,303,307,308].includes(status)) { if (!headers.location || redirects >= 4) throw new SourceError('Too many source redirects.'); return this.request(new URL(headers.location, u).href, hosts, signal, image, redirects + 1); }
    if (image && status === 403 && !/text\/html/.test(String(headers['content-type']))) throw new SourceError('Page access denied or temporary page URL expired.', 'expired');
    if (status === 401 || status === 403 || /text\/html/.test(String(headers['content-type']))) throw new SourceError('Source requires local human action or denied this request. No automatic challenge bypass is available.', 'action_required');
    if (status === 404 || status === 410) throw new SourceError(image ? 'Page URL expired or page unavailable.' : 'Chapter or series is unavailable.', image ? 'expired' : 'permanent');
    if (status === 429 || status === 503) { const ms = Math.max(retryAfter(headers['retry-after']),Number(headers['x-ratelimit-retry-after'] ?? 0)*1000-Date.now(),5000); this.api.block(ms); this.images.block(ms); this.atHome.block(ms); throw new SourceError('Source is rate limiting requests. Try again later.', 'transient', ms); }
    if (status >= 500) throw new SourceError('Source is temporarily unavailable.', 'transient');
    if (status !== 200) throw new SourceError(`Source returned HTTP ${status}.`);
    if (image && !/^image\/(jpeg|png|webp)/i.test(String(headers['content-type']))) throw new SourceError('Source did not return a supported image.');
    return body;
  }
  async json<T>(url: string, hosts: string[], signal?: AbortSignal): Promise<T> { try { return JSON.parse((await this.get(url, hosts, signal)).toString()) as T; } catch (e) { if (e instanceof SyntaxError) throw new SourceError('Source returned invalid JSON.'); throw e; } }
}
export const sharedHttp = new SafeHttp();
