import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
// Reserved for optional adapter tokens. Administrator passwords use scrypt, never this vault.
export class SecretVault {
  constructor(private directory: string) {}
  private file(key: string) { if (!/^[a-z0-9-]{1,60}$/.test(key)) throw Error('Invalid secret key'); return path.join(this.directory,`${key}.dpapi`); }
  async put(key: string,value: string) { if (process.platform !== 'win32' || !safeStorage.isEncryptionAvailable()) throw Error('Windows secure storage is unavailable.'); await mkdir(this.directory,{ recursive: true }); await writeFile(this.file(key),safeStorage.encryptString(value)); }
  async get(key: string) { if (!safeStorage.isEncryptionAvailable()) throw Error('Windows secure storage is unavailable.'); return safeStorage.decryptString(await readFile(this.file(key))); }
}
