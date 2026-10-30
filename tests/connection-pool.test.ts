import { it, expect } from 'vitest';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { PinnedAgent, retryDelay } from '../src/sources/http.js';

it('reuses TLS connections only within a hostname and validated-IP pool',async()=>{
    // Public test-only certificate; never loaded by application transports.
    const key=await readFile(new URL('./fixtures/localhost-key.pem',import.meta.url));
    const cert=await readFile(new URL('./fixtures/localhost-cert.pem',import.meta.url));
    const server=https.createServer({key,cert},(_req,res)=>{res.writeHead(200);res.end('fixture');});
    let connections=0;server.on('secureConnection',()=>connections++);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=(server.address() as {port:number}).port;
    const agent=new PinnedAgent({keepAlive:true,maxSockets:2,maxFreeSockets:2});
    const get=(validatedAddress:string)=>new Promise<string>((resolve,reject)=>{
        // Loopback is intentionally limited to this agent test. SafeHttp rejects it.
        const options={agent,ca:cert,family:4,validatedAddress,lookup:(_h:string,_o:unknown,cb:Function)=>cb(null,'127.0.0.1',4)};
        const req=https.get(`https://localhost:${port}/`,options,res=>{const parts:Buffer[]=[];res.on('data',b=>parts.push(b));res.on('end',()=>resolve(Buffer.concat(parts).toString()));});req.on('error',reject);
    });
    try {
        expect(await get('validated-one')).toBe('fixture');
        expect(await get('validated-one')).toBe('fixture');
        expect(connections).toBe(1);
        await get('validated-two');expect(connections).toBe(2);
        const name=agent.getName({host:'localhost',port,validatedAddress:'one'});
        expect(name).not.toBe(agent.getName({host:'localhost',port,validatedAddress:'two'}));
    } finally {agent.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('bounds exponential jitter and never shortens a Retry-After delay',()=>{
    expect(retryDelay(0,1000,0,()=>0)).toBe(800);
    expect(retryDelay(2,1000,0,()=>1)).toBeCloseTo(4800);
    expect(retryDelay(0,1000,30000,()=>0)).toBe(30000);
    expect(retryDelay(100,1000,0,()=>1)).toBeCloseTo(72000);
});
