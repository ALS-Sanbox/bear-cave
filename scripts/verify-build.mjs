import { open, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { extractFile, listPackage } from '@electron/asar';
const pkg=JSON.parse(await readFile('package.json','utf8')),dir=pkg.build.directories.output;
const files=[`Bear Cave Setup ${pkg.version} x64.exe`,`Bear Cave Portable ${pkg.version} x64.exe`];
const outputs=[];
for(const name of files){
    const file=path.resolve(dir,name),info=await stat(file);assert(info.size>1000000);
    const handle=await open(file,'r'),header=Buffer.alloc(64),pe=Buffer.alloc(24);
    try{await handle.read(header,0,64,0);assert.equal(header.toString('ascii',0,2),'MZ');await handle.read(pe,0,24,header.readUInt32LE(60));assert.equal(pe.toString('ascii',0,4),'PE\0\0');}finally{await handle.close();}
    const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
    outputs.push({file,bytes:info.size,MiB:Number((info.size/1048576).toFixed(2)),sha256:hash.digest('hex'),PE:true,bootstrapMachine:`0x${pe.readUInt16LE(4).toString(16)}`,modified:info.mtime.toISOString()});
}
const archive=path.join(dir,'win-unpacked/resources/app.asar');
const runtime=path.join(dir,'win-unpacked/Bear Cave.exe'),runtimeHandle=await open(runtime,'r'),runtimeHeader=Buffer.alloc(64),runtimePE=Buffer.alloc(24);
try{await runtimeHandle.read(runtimeHeader,0,64,0);await runtimeHandle.read(runtimePE,0,24,runtimeHeader.readUInt32LE(60));assert.equal(runtimePE.toString('ascii',0,4),'PE\0\0');assert.equal(runtimePE.readUInt16LE(4),0x8664);}finally{await runtimeHandle.close();}
assert.equal(JSON.parse(extractFile(archive,'package.json').toString()).version,pkg.version);
for(const [name,marker] of [['engine/queue.js','sourcePools'],['engine/queue.js','metadataFinals'],['sources/comix.js','getToFile(url, this.manifest.imageHosts, file, signal)'],['sources/http.js','validatedAddress'],['sources/mangafreak.js','images.mangafreak.me'],['sources/browser-assisted.js','BrowserAssistedTransport'],['shared/performance.js','balanced']])assert(extractFile(archive,path.join('dist/main',name)).toString().includes(marker),name);
assert(!listPackage(archive).some(f=>/localhost-key|localhost-cert/.test(f)));
const manifest={version:pkg.version,builtAt:new Date().toISOString(),environment:{platform:process.platform,arch:process.arch,os:os.version(),node:process.version,electron:JSON.parse(await readFile('node_modules/electron/package.json','utf8')).version,electronBuilder:JSON.parse(await readFile('node_modules/electron-builder/package.json','utf8')).version},outputs,checks:{PE:true,x64Runtime:true,bundledVersion:true,optimizedQueue:true,metadataWorkers:true,comixHeaders:true,ipKeyedPool:true,mangafreak:true,browserAssistance:true,profiles:true,noTestCertificates:true},signature:'See signatures.json; no signing credentials configured.'};
await mkdir('release/verification',{recursive:true});
await writeFile('release/verification/build-manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(dir,'SHA256SUMS.txt'),outputs.map(o=>`${o.sha256}  ${path.basename(o.file)}`).join('\n')+'\n');
console.log(JSON.stringify(manifest,null,2));
