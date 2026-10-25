import { it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { CdpPipe } from '../src/desktop/cdp-pipe.js';
function fixture(timeout = 2000) { const writer = new PassThrough(), reader = new PassThrough(), commands: any[] = []; writer.on('data', b => commands.push(JSON.parse(b.toString().slice(0, -1)))); const client = new CdpPipe(writer, reader, timeout); return { client, reader, commands }; }
it('frames fragmented Unicode, correlates out-of-order replies, and routes session events', async () => {
    const f = fixture();
    const events: any[] = [];
    const unsubscribe = f.client.onEvent((method, params, session) => events.push({ method, params, session }));
    const a = f.client.send('First', {}, 'tab-a'), b = f.client.send('Second', {}, 'tab-b');
    const bytes = Buffer.from(JSON.stringify({ id: f.commands[1].id, result: { text: 'Manga \u65e5\u672c' } }) + '\0' + JSON.stringify({ method: 'Page.ready', params: { ok: true }, sessionId: 'tab-b' }) + '\0' + JSON.stringify({ id: f.commands[0].id, result: { number: 1 } }) + '\0');
    for (let i = 0; i < bytes.length; i += 3)
        f.reader.write(bytes.subarray(i, i + 3));
    expect(await a).toEqual({ number: 1 });
    expect(await b).toEqual({ text: 'Manga \u65e5\u672c' });
    expect(events[0].session).toBe('tab-b');
    unsubscribe();
    f.client.close();
});
it('cancels a pending command without accepting its late response', async () => { const f = fixture(), controller = new AbortController(); const a = f.client.send('Slow', {}, 'tab', controller.signal); controller.abort(); await expect(a).rejects.toThrow(); f.reader.write(JSON.stringify({ id: 1, result: { stale: true } }) + '\0'); const b = f.client.send('Next'); f.reader.write(JSON.stringify({ id: 2, result: { ok: true } }) + '\0'); expect(await b).toEqual({ ok: true }); f.client.close(); });
it('bounds command waits and rejects pending calls on disconnect', async () => { const f = fixture(20); await expect(f.client.send('No reply')).rejects.toThrow('timed out'); const next = f.client.send('Pending'); f.reader.end(); await expect(next).rejects.toThrow('closed'); await expect(f.client.send('After disconnect')).rejects.toThrow('closed'); });
it('rejects malformed/oversized protocol input and command errors', async () => { const f = fixture(); const failed = f.client.send('Invalid'); f.reader.write(JSON.stringify({ id: 1, error: { message: 'Unsupported command' } }) + '\0'); await expect(failed).rejects.toThrow('Unsupported command'); const pending = f.client.send('Waiting'); f.reader.write('invalid json\0'); await expect(pending).rejects.toThrow('closed'); const big = fixture(); const request = big.client.send('Huge'); big.reader.write(Buffer.alloc(24 * 1024 * 1024 + 1, 32)); await expect(request).rejects.toThrow('closed'); });
