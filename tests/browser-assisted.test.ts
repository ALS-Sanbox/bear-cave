import { it, expect } from 'vitest';
import { BrowserAssistedTransport } from '../src/sources/browser-assisted.js';
import { SafeHttp } from '../src/sources/http.js';
import { SourceError } from '../src/shared/types.js';
import { defaults } from '../src/core/settings.js';

it('prefers HTTP, reuses a cleared session, and stops fallback when disabled',async()=>{
    let normal=0,session=0,render=0,denied=false;
    const http=new SafeHttp(0);http.html=async()=>{normal++;if(denied)throw new SourceError('Check','action_required');return 'normal';};
    const transport=new BrowserAssistedTransport(http,{html:async()=>{session++;return 'session';},get:async()=>Buffer.alloc(0)},async()=>{render++;return 'render';});
    expect(await transport.html('https://fixture.example/',['fixture.example'])).toBe('normal');
    denied=true;expect(await transport.html('https://fixture.example/',['fixture.example'])).toBe('session');
    expect(await transport.html('https://fixture.example/',['fixture.example'])).toBe('session');
    expect({normal,session,render}).toEqual({normal:2,session:2,render:0});
    transport.configureDownloads({...defaults('C:/test'),browserAssisted:false});
    await expect(transport.html('https://fixture.example/',['fixture.example'])).rejects.toMatchObject({kind:'action_required'});
    expect(session).toBe(2);
});
it('uses rendering for a JavaScript shell and preserves human-action errors',async()=>{
    const normal=new SafeHttp(0);normal.html=async()=>'<div id="root"></div><script src="app.js"></script>';
    const transport=new BrowserAssistedTransport(normal,{html:async()=>'',get:async()=>Buffer.alloc(0)},async()=>'<h1>Rendered</h1>');
    expect(await transport.html('https://fixture.example/',['fixture.example'])).toContain('Rendered');
    normal.html=async()=>{throw new SourceError('Check','action_required');};
    const denied=new BrowserAssistedTransport(normal,{html:async()=>{throw new SourceError('Check','action_required');},get:async()=>Buffer.alloc(0)},async()=>{throw new SourceError('Complete verification on Windows','action_required');});
    await expect(denied.html('https://fixture.example/',['fixture.example'])).rejects.toThrow('Complete verification');
});
it('does not send denied destinations or permanent errors to the browser',async()=>{
    let calls=0;const normal=new SafeHttp(0);normal.html=async()=>{throw new SourceError('Host not allowed');};
    const transport=new BrowserAssistedTransport(normal,{html:async()=>{calls++;return '';},get:async()=>Buffer.alloc(0)},async()=>{calls++;return '';});
    await expect(transport.html('https://evil.example/',['fixture.example'])).rejects.toThrow('not allowed');expect(calls).toBe(0);
});
