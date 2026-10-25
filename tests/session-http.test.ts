import { describe,it,expect,vi } from 'vitest';
import { SessionHttp } from '../src/sources/session-http.js';
const hosts=['www.toongod.org','toongod.org'];
const guard=async()=>{};
const response=(body:string,status=200,headers:Record<string,string>={})=>new Response(body,{status,headers:{'Content-Type':'text/html',...headers}});
describe('source Chromium session transport',()=>{
 it('uses session credentials and the genuine browser user agent, without exporting or forging cookies',async()=>{
    let init:RequestInit|undefined;
    const http=new SessionHttp(async(_url,options)=>{init=options;return response('<h1>Public result</h1>');},guard,0);
    expect(await http.html('https://www.toongod.org/?s=fixture',hosts)).toContain('Public result');
    expect(init?.credentials).toBe('include');expect(init?.redirect).toBe('manual');expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);expect(new Headers(init?.headers).has('User-Agent')).toBe(false);
 });
 it('validates every redirect and permits the canonical www/apex transition',async()=>{
    const urls:string[]=[];
    const http=new SessionHttp(async url=>{urls.push(url);return urls.length===1?response('',302,{Location:'https://toongod.org/?s=fixture'}):response('<h1>Found</h1>');},guard,0);
    expect(await http.html('https://www.toongod.org/?s=fixture',hosts)).toContain('Found');expect(urls).toHaveLength(2);
    const blocked=new SessionHttp(async()=>response('',302,{Location:'https://127.0.0.1/private'}),guard,0);
    await expect(blocked.html('https://www.toongod.org/',hosts)).rejects.toThrow('not allowed');
 });
 it('never retries or executes a challenge returned inside the saved session',async()=>{
    const fetch=vi.fn(async()=>response('<title>Just a moment</title><script src="/cdn-cgi/challenge-platform/"></script>',403));
    await expect(new SessionHttp(fetch,guard,0).html('https://www.toongod.org/',hosts)).rejects.toMatchObject({kind:'action_required'});
    expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('retains referer for images, rejects login POST and unsupported images',async()=>{
    let init:RequestInit|undefined;const http=new SessionHttp(async(_url,options)=>{init=options;return response('image',200,{'Content-Type':'image/png'});},guard,0);
    await http.get('https://www.toongod.org/1.png',hosts,undefined,true,{referer:'https://www.toongod.org/'});
    expect(new Headers(init?.headers).get('Referer')).toBe('https://www.toongod.org/');
    await expect(http.get('https://www.toongod.org/login',hosts,undefined,false,{form:new URLSearchParams({password:'not-a-real-password'})})).rejects.toThrow('public GET');
    await expect(new SessionHttp(async()=>response('svg',200,{'Content-Type':'image/svg+xml'}),guard,0).get('https://www.toongod.org/1.svg',hosts,undefined,true)).rejects.toThrow('supported image');
 });
 it('bounds response bytes and respects cancellation and private-DNS rejection',async()=>{
    const large=new SessionHttp(async()=>response('x'.repeat(8*1024*1024+1)),guard,0);
    await expect(large.html('https://www.toongod.org/',hosts)).rejects.toThrow('size limit');
    const abort=new AbortController();abort.abort();const fetch=vi.fn(async()=>response('never'));
    await expect(new SessionHttp(fetch,guard,0).html('https://www.toongod.org/',hosts,abort.signal)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
    await expect(new SessionHttp(fetch,async()=>{throw Error('private DNS');},0).html('https://www.toongod.org/',hosts)).rejects.toThrow('private DNS');
 });
});
