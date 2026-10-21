import sharp from 'sharp';
import {mkdir,writeFile}from'node:fs/promises';
const mark='images/logo without text.png',full='images/Logo with text.png';
await Promise.all(['src/ui/assets','dist/branding','build/branding'].map(d=>mkdir(d,{recursive:true})));
await sharp(full).trim().resize({width:520}).png().toFile('src/ui/assets/logo-full.png');
await sharp(mark).trim().resize({width:256,height:256,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile('src/ui/assets/logo-mark.png');
await sharp(mark).trim().resize({width:256,height:256,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile('dist/branding/app.png');
await sharp(mark).trim().resize({width:32,height:32,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile('dist/branding/tray.png');
const sizes=[16,24,32,48,64,128,256],payloads=await Promise.all(sizes.map(size=>sharp(mark).trim().resize({width:size,height:size,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer()));
const header=Buffer.alloc(6+sizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
for(let i=0;i<sizes.length;i++){const start=6+i*16;header[start]=sizes[i]===256?0:sizes[i];header[start+1]=header[start];header.writeUInt16LE(1,start+4);header.writeUInt16LE(32,start+6);header.writeUInt32LE(payloads[i].length,start+8);header.writeUInt32LE(offset,start+12);offset+=payloads[i].length;}
await writeFile('build/branding/app.ico',Buffer.concat([header,...payloads]));
