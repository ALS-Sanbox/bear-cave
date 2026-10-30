import { spawn } from 'node:child_process';
import electron from 'electron';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// Some developer shells set this globally. It must never turn the desktop app into Node mode.
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const smoke=['scripts/browser-download-benchmark.cjs','scripts/comix-image-diagnostic.cjs','scripts/performance-ui-smoke.cjs','scripts/electron-smoke.cjs','scripts/main-smoke.cjs','scripts/download-ui-smoke.cjs','scripts/comix-live-smoke.cjs','scripts/comix-cover-smoke.cjs','scripts/search-ui-smoke.cjs','scripts/browsing-ui-smoke.cjs','scripts/library-scan-ui-smoke.cjs','scripts/rendered-source-smoke.cjs'].includes(process.argv[2]);
const temp=smoke?await mkdtemp(path.join(os.tmpdir(),'bear-cave-electron-')):undefined;
if(temp)env.BEAR_CAVE_SMOKE_DATA=temp;
const child=spawn(electron,process.argv.slice(2),{stdio:'inherit',windowsHide:true,env});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',async code=>{process.exitCode=code??1;if(temp){if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('bear-cave-electron-'))throw Error('Invalid smoke cleanup path');await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{console.error('Temporary Chromium profile could not be removed:',temp);process.exitCode=1;});}});
