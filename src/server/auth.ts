import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Store } from '../core/store.js';
function derive(password: string,salt: string): Promise<Buffer> { return new Promise((resolve,reject)=>scrypt(password,salt,64,{ N:32768,r:8,p:1,maxmem:64*1024*1024 },(err,key)=>err?reject(err):resolve(key))); }
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) throw Error('Administrator password must contain 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password,salt);
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm,n,r,p,salt,hash] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(hash ?? '') || password.length > 256) return false;
  const key = await derive(password,salt); return timingSafeEqual(key,Buffer.from(hash,'hex'));
}
export interface Session { id: string; csrf: string; expires: number }
export class Auth {
  sessions = new Map<string,Session>(); private failures: number[] = []; private pending = 0;
  constructor(private store: Store) {}
  async login(password: string): Promise<Session> {
    this.failures = this.failures.filter(t => Date.now()-t < 15*60*1000);
    if (this.failures.length >= 5 || this.pending >= 2) throw Error('Too many login attempts. Wait 15 minutes.');
    this.pending++;
    try {
      const hash = this.store.get<string>('admin-hash');
      if (!hash || !await verifyPassword(password,hash)) { this.failures.push(Date.now()); throw Error('Dashboard sign-in failed. Use the administrator password set in Bear Cave tray Settings. To set a new password, open Settings, enter a new administrator password and Save.'); }
      for (const [id,s] of this.sessions) if (s.expires <= Date.now()) this.sessions.delete(id);
      if (this.sessions.size >= 32) this.sessions.delete(this.sessions.keys().next().value!);
      const s = { id: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), expires: Date.now()+12*60*60*1000 };
      this.sessions.set(s.id,s); return s;
    } finally { this.pending--; }
  }
  session(cookie: string | undefined) { const id = cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('bc_session='))?.slice(11); const s = id ? this.sessions.get(id) : undefined; if (s && s.expires > Date.now()) return s; if (id) this.sessions.delete(id); return undefined; }
  clear() { this.sessions.clear(); }
}
