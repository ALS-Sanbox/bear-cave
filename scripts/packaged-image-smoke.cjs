// Run with Electron in Node mode after dist:win. Checks the shipped native converter, without launching the app.
const assert=require('node:assert/strict');
const path=require('node:path');
const sharp=require(path.resolve('release/win-unpacked/resources/app.asar/node_modules/sharp'));
sharp({create:{width:2,height:3,channels:3,background:'#a7470b'}}).jpeg().toBuffer()
  .then(bytes=>sharp(bytes).png().toBuffer())
  .then(async bytes=>{assert.equal((await sharp(bytes).metadata()).format,'png');console.log('Packaged image converter passed: shipped Sharp loads and converts JPEG cover art to PNG.');})
  .catch(error=>{console.error(error);process.exitCode=1;});
