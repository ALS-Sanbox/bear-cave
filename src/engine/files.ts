import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, realpath, rm } from 'node:fs/promises';
import { zipSync, unzipSync } from 'fflate';
import type { Job } from '../shared/types.js';

export function safeName(value: string, max = 55): string {
  let s = value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g,'').trim();
  if (!s || s === '.' || s === '..') s = 'Untitled';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)) s = `_${s}`;
  return s.slice(0,max).replace(/[. ]+$/g,'') || 'Untitled';
}
export function contained(root: string, ...parts: string[]): string {
  const result = path.resolve(root, ...parts), rel = path.relative(root, result);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error('Unsafe output path');
  if (result.length > 245) throw Error('Download path is too long. Choose a shorter download root.'); return result;
}
async function noLink(file: string) { try { if ((await lstat(file)).isSymbolicLink()) throw Error('Symbolic links and junctions are not allowed in download paths.'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
export function digest(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
export function chapterNumber(value: string): string { return /^\d+(?:\.\d+)?$/.test(value) ? value.replace(/^\d+/,n=>n.replace(/^0+(?=\d)/,'').padStart(3,'0')) : safeName(value,20); }
function fileId(value:string) { return /^[a-f0-9-]{36}$/i.test(value) ? value.toLowerCase() : digest(Buffer.from(value)).slice(0,32); }
export function imageExtension(data: Uint8Array): string {
  const b = Buffer.from(data);
  if (b.length >= 12 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.subarray(-8,-4).toString() === 'IEND') return 'png';
  if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[b.length-2] === 255 && b[b.length-1] === 217) return 'jpg';
  if (b.length >= 16 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length) return 'webp';
  throw Error('Downloaded page is not a complete PNG, JPEG or WebP image.');
}
interface PageRecord { name: string; hash: string; size: number }
interface Manifest { version: 1; chapter: string; revision: string; pages: (PageRecord | null)[] }
export class ChapterOutput {
  private dir = ''; private final = ''; private stage = ''; private manifest!: Manifest;
  constructor(private job: Job) {}
  async open(revision: string, count: number) {
    const root = await realpath(this.job.root);
    this.dir = contained(root, safeName(this.job.series.title,65)); await noLink(this.dir); await mkdir(this.dir, { recursive: true });
    const metadata=contained(this.dir,'.bear-cave');await noLink(metadata);await mkdir(metadata,{recursive:true});
    const identity=`${this.job.source}:${this.job.chapter.id}`;
    const base=`${safeName(this.job.series.title,65)} ${chapterNumber(this.job.chapter.number)}`;
    let stem=base;
    // Atomically claim a readable filename so translations and cross-source duplicates never overwrite each other.
    for(let attempt=0;attempt<2;attempt++){
      const claim=contained(metadata,`${digest(Buffer.from(stem)).slice(0,32)}.json`);await noLink(claim);
      try{await writeFile(claim,JSON.stringify(identity),{flag:'wx'});break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
      if(JSON.parse(await readFile(claim,'utf8'))===identity)break;
      if(attempt===1)throw Error('Chapter filename conflicts with another download.');
      stem=`${base} [${this.job.source}-${digest(Buffer.from(identity)).slice(0,8)}]`;
    }
    this.final = contained(this.dir, stem + (this.job.format === 'cbz' ? '.cbz' : ''));
    this.stage = contained(metadata, `${fileId(identity)}.incomplete`);
    await noLink(this.stage); await noLink(this.final); await mkdir(this.stage, { recursive: true });
    try { this.manifest = JSON.parse(await readFile(contained(this.stage,'manifest.json'),'utf8')) as Manifest; } catch { /* Missing or torn manifest is safely regenerated. */ }
    if (!this.manifest || this.manifest.version !== 1 || this.manifest.chapter !== this.job.chapter.id || this.manifest.revision !== revision || this.manifest.pages.length !== count) this.manifest = { version: 1, chapter: this.job.chapter.id, revision, pages: Array.from({ length: count }, () => null) };
    await this.save();
  }
  private async save() { const temp = contained(this.stage,'manifest.json.part'); await noLink(temp); await noLink(contained(this.stage,'manifest.json')); await writeFile(temp, JSON.stringify(this.manifest)); await rename(temp,contained(this.stage,'manifest.json')); }
  private validRecord(p: PageRecord): boolean { return /^\d{5}\.(png|jpg|webp)$/.test(p.name) && /^[a-f0-9]{64}$/.test(p.hash) && p.size > 0; }
  async has(index: number) {
    const p = this.manifest.pages[index]; if (!p || !this.validRecord(p)) return false;
    try { const file = contained(this.stage,p.name); await noLink(file); const b = await readFile(file); imageExtension(b); return b.length === p.size && digest(b) === p.hash; } catch { return false; }
  }
  async page(index: number, bytes: Buffer) {
    const ext = imageExtension(bytes), name = `${String(index+1).padStart(5,'0')}.${ext}`;
    const file = contained(this.stage,name), temp = file + '.part'; await noLink(temp); await noLink(file);
    await writeFile(temp, bytes); await rename(temp,file);
    this.manifest.pages[index] = { name, hash: digest(bytes), size: bytes.length }; await this.save();
  }
  async finish(): Promise<string> {
    for (let i = 0; i < this.manifest.pages.length; i++) if (!await this.has(i)) throw Error('Chapter output failed page validation.');
    await noLink(this.final);
    if (this.job.format === 'folders') {
      // Existing output is never silently overwritten; crash-after-rename recovery validates it.
      try { await lstat(this.final); await this.validateFolder(); return this.final; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      await rename(this.stage,this.final); await this.validateFolder();
    } else {
      const files: Record<string,Uint8Array> = {}; let size = 0;
      for (const p of this.manifest.pages) { if (!p) throw Error('Missing page'); size += p.size; if (size > 512 * 1024 * 1024) throw Error('Chapter exceeds Phase 1 CBZ memory limit (512 MiB). Use image folders.'); files[p.name] = await readFile(contained(this.stage,p.name)); }
      files['bear-cave.json'] = Buffer.from(JSON.stringify(this.manifest));
      try { await lstat(this.final); await this.validateZip(this.final); return this.final; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const temp = this.final + '.part'; await noLink(temp); await writeFile(temp,zipSync(files,{ level: 0 })); await this.validateZip(temp); await rename(temp,this.final);
      await rm(this.stage, { recursive: true, force: true });
    }
    return this.final;
  }
  private validatePages(files: Record<string,Uint8Array>) {
    const saved = JSON.parse(Buffer.from(files['bear-cave.json'] ?? []).toString()) as Manifest;
    if (saved.chapter !== this.manifest.chapter || saved.revision !== this.manifest.revision || JSON.stringify(saved.pages) !== JSON.stringify(this.manifest.pages)) throw Error('Existing output has conflicting metadata. Move it before retrying.');
    for (const p of this.manifest.pages) { if (!p || !files[p.name] || digest(files[p.name]) !== p.hash) throw Error('CBZ page integrity validation failed.'); imageExtension(files[p.name]); }
  }
  private async validateZip(file: string) { this.validatePages(unzipSync(await readFile(file))); }
  private async validateFolder() {
    const saved = JSON.parse(await readFile(contained(this.final,'manifest.json'),'utf8')) as Manifest;
    if (saved.chapter !== this.manifest.chapter || saved.revision !== this.manifest.revision || JSON.stringify(saved.pages) !== JSON.stringify(this.manifest.pages)) throw Error('Existing folder conflicts with this chapter.');
    for (const p of saved.pages) { if (!p || !this.validRecord(p)) throw Error('Invalid output manifest'); const file = contained(this.final,p.name); await noLink(file); const bytes = await readFile(file); if (digest(bytes) !== p.hash) throw Error('Output page checksum failed'); imageExtension(bytes); }
  }
}
