// Electron Node mode only: inspect shipped modules without launching the app or opening user data.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve('release/win-unpacked/resources/app.asar');
const sharp=require(path.join(root,'node_modules/sharp'));
async function run(){
  assert.equal(require(path.join(root,'package.json')).version,'0.3.0');
  const [{Store},archive]=await Promise.all([
    import(pathToFileURL(path.join(root,'dist/main/core/store.js')).href),
    import(pathToFileURL(path.join(root,'dist/main/engine/archive.js')).href)
  ]);
  const store=new Store(':memory:');try{assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,2);}finally{store.close();}
  assert.equal(typeof archive.createArchive,'function');assert.equal(typeof archive.verifyArchive,'function');
  const jpeg=await sharp({create:{width:2,height:3,channels:3,background:'#a7470b'}}).jpeg().toBuffer();
  const png=await sharp(jpeg).png().toBuffer();assert.equal((await sharp(png).metadata()).format,'png');
  console.log('Packaged smoke passed: version 0.3.0, SQLite schema 2, streaming archive modules and shipped JPEG-to-PNG converter.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
