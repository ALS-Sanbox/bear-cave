import { InstalledBrowser } from '../src/desktop/installed-browser.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=await mkdtemp(path.join(os.tmpdir(),'bear-cave-toongod-probe-'));
const browser=new InstalledBrowser(root,['www.toongod.org','toongod.org'],{generic:true,attention:()=>console.log('Human verification required on the Windows host. No automated interaction is attempted.')});
try {const html=await browser.html('https://www.toongod.org/?s=swordmaster&post_type=wp-manga',['www.toongod.org','toongod.org'],AbortSignal.timeout(20000));console.log('Browser HTML received:',Buffer.byteLength(html),'bytes. Reader/download verification still required.');}
catch(e){console.log('ToonGod installed-browser probe:',(e as Error).message);process.exitCode=1;}
finally {await browser.close();if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('bear-cave-toongod-probe-'))throw Error('Invalid test path');await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
