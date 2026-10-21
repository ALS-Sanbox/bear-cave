import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../core/store.js';
import type { Queue } from '../engine/queue.js';
import type { Registry } from '../sources/registry.js';
import type { Settings, Chapter, Series } from '../shared/types.js';
import { SourceError } from '../shared/types.js';
import { Auth } from './auth.js';

class ApiError extends Error { constructor(public status: number,message: string) { super(message); } }
interface Preview { session: string; expires: number; series: Series; chapters: Chapter[]; multipleTranslations: number }
const opaqueId=z.string().min(1).max(1200).regex(/^[a-zA-Z0-9_-]+$/);
export function createDashboard(store: Store, queue: Queue, registry: Registry, settings: () => Settings, uiDir: string) {
  const auth = new Auth(store), previews = new Map<string,Preview>(); let busyPreviews = 0; let reads: number[] = [];
  const send = (res: ServerResponse,status: number,data: unknown) => { res.writeHead(status,{ 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  async function body(req: IncomingMessage): Promise<unknown> {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'JSON request required.');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 64*1024) throw new ApiError(413,'Request too large.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ApiError(400,'Invalid JSON.'); }
  }
  const server = createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"); res.setHeader('Cache-Control','no-store');
    const abort = new AbortController(); res.on('close',() => { if (!res.writableEnded) abort.abort(); });
    try {
      const s = settings(); const address = server.address(); const port = typeof address === 'object' && address ? address.port : s.port;
      const locals = [`http://127.0.0.1:${port}`,`http://localhost:${port}`];
      const host = req.headers.host ?? ''; const local = locals.includes(`http://${host}`);
      const remote = Boolean(s.publicUrl && s.trustTunnel && host === new URL(s.publicUrl).host && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-proto'] === 'https');
      if (!local && !remote) throw new ApiError(403,'Unrecognized dashboard host or proxy.');
      const expectedOrigin = remote ? s.publicUrl : `http://${host}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin) throw new ApiError(403,'Origin is not allowed.');
      if (remote) res.setHeader('Strict-Transport-Security','max-age=31536000');
      const url = new URL(req.url ?? '/',expectedOrigin), method = req.method ?? 'GET';
      const changing = !['GET','HEAD'].includes(method);
      if (changing && req.headers.origin !== expectedOrigin) throw new ApiError(403,'An exact Origin header is required.');
      const session = auth.session(req.headers.cookie);
      const cookie = (id: string,age: number) => `bc_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${remote ? '; Secure' : ''}`;
      if (url.pathname === '/api/login' && method === 'POST') {
        const data = z.object({ password: z.string().max(256) }).strict().parse(await body(req));
        try { const login = await auth.login(data.password); if (session) auth.sessions.delete(session.id); res.setHeader('Set-Cookie',cookie(login.id,43200)); return send(res,200,{ csrf: login.csrf }); }
        catch (e) { throw new ApiError((e as Error).message.startsWith('Too many') ? 429 : 401,(e as Error).message); }
      }
      if (url.pathname === '/api/session' && method === 'GET') return send(res,200,{ authenticated: Boolean(session), csrf: session?.csrf, setupRequired: !store.get('admin-hash') });
      if (url.pathname.startsWith('/api/')) {
        if (!session) throw new ApiError(401,'Please log in.');
        if (changing && req.headers['x-csrf-token'] !== session.csrf) throw new ApiError(403,'CSRF token is missing or invalid.');
        if (method === 'POST' && url.pathname === '/api/logout') { auth.sessions.delete(session.id); res.setHeader('Set-Cookie',cookie('',0)); return send(res,200,{ ok: true }); }
        if (method === 'GET' && url.pathname === '/api/sources') return send(res,200,registry.manifests());
        if (method === 'GET' && url.pathname === '/api/jobs') return send(res,200,{ paused: Boolean(store.get('queue-paused')), jobs: store.jobs().map(({ root,output,...job }) => ({ ...job, output: output ? path.basename(output) : null })) });
        if (method === 'POST' && url.pathname === '/api/queue') { const { action } = z.object({ action: z.enum(['pause','resume']) }).strict().parse(await body(req)); action === 'pause' ? queue.pauseAll() : queue.resumeAll(); return send(res,200,{ ok: true }); }
        const jobMatch = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);
        if (method === 'POST' && jobMatch) { const { action } = z.object({ action: z.enum(['pause','resume','cancel','retry']) }).strict().parse(await body(req)); queue.control(jobMatch[1],action); return send(res,200,{ ok: true }); }
        if (method === 'GET' && ['/api/search','/api/series','/api/chapters'].includes(url.pathname)) {
          reads = reads.filter(t => Date.now()-t < 60000); if (reads.length >= 90) throw new ApiError(429,'Too many source requests. Wait a minute.'); reads.push(Date.now());
          const adapter = registry.get(url.searchParams.get('source') ?? 'mangadex');
          const offset = z.coerce.number().int().min(0).max(9999).parse(url.searchParams.get('offset') ?? 0);
          if (url.pathname === '/api/search') return send(res,200,await adapter.search(z.string().min(1).max(200).parse(url.searchParams.get('q')),offset,abort.signal));
          const id = opaqueId.parse(url.searchParams.get('id'));
          if (url.pathname === '/api/series') return send(res,200,await adapter.series(id,abort.signal));
          return send(res,200,await adapter.chapters(id,{ language: url.searchParams.get('language') ?? 'en', group: url.searchParams.get('group') || undefined },offset,abort.signal));
        }
        if (method === 'POST' && url.pathname === '/api/preview') {
          const data = z.object({ source: z.string().max(30), seriesId: opaqueId, language: z.string().min(2).max(10), group: opaqueId.optional(), ids: z.array(opaqueId).min(1).max(10000).optional() }).strict().parse(await body(req));
          // The UI has one current confirmation per session; replacing/cancelling previews must not exhaust the cache.
          for (const [id,p] of previews) if (p.expires < Date.now() || p.session===session.id) previews.delete(id);
          if (busyPreviews >= 1 || previews.size >= 10) throw new ApiError(429,'A chapter preview is already in progress, or too many are pending.'); busyPreviews++;
          try {
            const adapter = registry.get(data.source), series = await adapter.series(data.seriesId,abort.signal); const chapters: Chapter[] = []; let offset = 0;
            do { const page = await adapter.chapters(data.seriesId,data,offset,abort.signal); chapters.push(...page.items); offset += page.limit; if (data.ids && data.ids.every(id=>chapters.some(c=>c.id===id)) || offset >= page.total) break; if (offset + page.limit > 10000) throw new ApiError(400,'Too many matching chapters. Narrow the language/group filter.'); } while (true);
            const unique = [...new Map(chapters.map(c => [c.id,c])).values()].filter(c => !c.external && c.pages !== 0 && c.source===data.source && c.seriesId===data.seriesId && (!data.ids || data.ids.includes(c.id)));
            if (data.ids && data.ids.some(id => !unique.some(c => c.id === id))) throw new ApiError(400,'Some selected chapters no longer match or are unavailable. Refresh the list.');
            const logical = new Set<string>(); let multipleTranslations = 0;
            for (const c of unique) { const key = `${c.volume}|${c.number}|${c.language}`; if (logical.has(key)) multipleTranslations++; logical.add(key); }
            const token = randomBytes(24).toString('hex'); previews.set(token,{ session: session.id, expires: Date.now()+5*60*1000, series,chapters: unique,multipleTranslations });
            return send(res,200,{ token,count: unique.length,multipleTranslations,expiresInSeconds: 300 });
          } finally { busyPreviews--; }
        }
        if (method === 'POST' && url.pathname === '/api/enqueue') {
          const data = z.object({ token: z.string(), confirmTranslations: z.boolean() }).strict().parse(await body(req)); const p = previews.get(data.token);
          if (!p || p.session !== session.id || p.expires < Date.now()) throw new ApiError(400,'Preview expired. Preview the matching chapters again.');
          if (p.multipleTranslations && !data.confirmTranslations) throw new ApiError(400,'Explicitly confirm multiple translations or select one translation group.');
          let added = 0, duplicates = 0;
          // One SQLite transaction prevents a partial bulk enqueue.
          store.db.exec('BEGIN IMMEDIATE');
          try { for (const c of p.chapters) store.enqueue(p.series,c,s).duplicate ? duplicates++ : added++; store.db.exec('COMMIT'); } catch (e) { store.db.exec('ROLLBACK'); throw e; }
          previews.delete(data.token); queue.tick(); return send(res,200,{ added,duplicates });
        }
        throw new ApiError(404,'Unknown API route.');
      }
      if (!['GET','HEAD'].includes(method)) throw new ApiError(405,'Method not allowed.');
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      // Serve only build assets; never fall back to arbitrary paths or application data.
      if (name !== 'index.html' && name !== 'favicon.ico' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|png)$/.test(name)) throw new ApiError(404,'Not found.');
      const file = await readFile(path.join(uiDir,name)); res.setHeader('Content-Type',name.endsWith('.ico') ? 'image/x-icon' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png')?'image/png':'text/html; charset=utf-8'); res.end(method === 'HEAD' ? undefined : file);
    } catch (e) {
      if (res.headersSent || res.destroyed) return;
      const status = e instanceof ApiError ? e.status : e instanceof z.ZodError ? 400 : e instanceof SourceError ? 502 : 400;
      send(res,status,{ error: e instanceof z.ZodError ? 'Invalid request parameters.' : e instanceof ApiError || e instanceof SourceError ? e.message : 'Request failed. Refresh and try again.' });
    }
  });
  server.requestTimeout = 120000; server.headersTimeout = 10000;
  return { server,auth, listen: (port = settings().port) => new Promise<number>((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',() => { server.removeListener('error',reject); const a = server.address(); resolve(typeof a === 'object' && a ? a.port : port); }); }), close: () => new Promise<void>((resolve,reject) => { auth.clear(); if(!server.listening)return resolve(); server.close(e => e ? reject(e) : resolve()); server.closeIdleConnections(); }) };
}
