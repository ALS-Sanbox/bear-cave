import type { Readable, Writable } from 'node:stream';
export interface CdpConnection {
    readonly closed?: boolean;
    send(method: string, params?: Record<string, unknown>, sessionId?: string, signal?: AbortSignal): Promise<any>;
    onEvent(listener: (method: string, params: any, sessionId?: string) => void): () => void;
    close(): void;
}
// NUL-delimited CDP on inherited process pipes: no debugging TCP port is exposed.
export class CdpPipe implements CdpConnection {
    get closed() { return this.ended; }
    private id = 0;
    private buffer = Buffer.alloc(0);
    private ended = false;
    private listeners = new Set<(method: string, params: any, sessionId?: string) => void>();
    private pending = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        finish: () => void;
    }>();
    constructor(private writer: Writable, reader: Readable, private timeout = 30000) {
        reader.on('data', chunk => this.receive(Buffer.from(chunk)));
        reader.on('end', () => this.close());
        reader.on('error', () => this.close());
        writer.on('error', () => this.close());
    }
    private receive(chunk: Buffer) {
        if (this.ended)
            return;
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length > 24 * 1024 * 1024) {
            this.close();
            return;
        }
        for (;;) {
            const end = this.buffer.indexOf(0);
            if (end < 0)
                break;
            const raw = this.buffer.subarray(0, end).toString('utf8');
            this.buffer = this.buffer.subarray(end + 1);
            if (!raw)
                continue;
            let message: any;
            try {
                message = JSON.parse(raw);
            }
            catch {
                this.close();
                return;
            }
            if (typeof message.id === 'number') {
                const pending = this.pending.get(message.id);
                if (!pending)
                    continue;
                this.pending.delete(message.id);
                pending.finish();
                if (message.error)
                    pending.reject(Error('Installed browser command failed: ' + String(message.error.message).slice(0, 300)));
                else
                    pending.resolve(message.result ?? {});
            }
            else if (typeof message.method === 'string') {
                for (const listener of this.listeners)
                    listener(message.method, message.params ?? {}, message.sessionId);
            }
        }
    }
    async send(method: string, params: Record<string, unknown> = {}, sessionId?: string, signal?: AbortSignal): Promise<any> {
        if (this.ended)
            return Promise.reject(Error('Installed browser connection closed.'));
        signal?.throwIfAborted();
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const abort = () => { const p = this.pending.get(id); if (p) {
                this.pending.delete(id);
                p.finish();
                reject(signal?.reason ?? Error('Browser request cancelled.'));
            } };
            const timer = setTimeout(() => { this.pending.delete(id); signal?.removeEventListener('abort', abort); reject(Error('Installed browser command timed out.')); }, this.timeout);
            const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
            this.pending.set(id, { resolve, reject, finish });
            signal?.addEventListener('abort', abort, { once: true });
            this.writer.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => {
                if (error) {
                    this.pending.delete(id);
                    finish();
                    reject(Error('Installed browser connection closed.'));
                }
            });
        });
    }
    onEvent(listener: (method: string, params: any, sessionId?: string) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {
        if (this.ended)
            return;
        this.ended = true;
        for (const p of this.pending.values()) {
            p.finish();
            p.reject(Error('Installed browser connection closed.'));
        }
        this.pending.clear();
        this.listeners.clear();
        this.buffer = Buffer.alloc(0);
    }
}
