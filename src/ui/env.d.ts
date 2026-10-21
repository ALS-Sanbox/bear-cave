import type { Settings, SourceManifest } from '../shared/types';
interface AccountStatus{connected:boolean;username?:string;message?:string}
declare global { interface Window { bearCaveLocal?: { read(): Promise<{ settings:Settings;sources:SourceManifest[];mangaAccount:AccountStatus;adminConfigured:boolean }>; save(settings:Settings,password?:string): Promise<{ ok:boolean;error?:string;restartRequired?:boolean }>; pickFolder(): Promise<string|null>;mangaConnect(credentials:{clientId:string;clientSecret:string;username:string;password:string}):Promise<{ok:boolean;status?:AccountStatus;error?:string}>;mangaDisconnect():Promise<{ok:boolean;status?:AccountStatus;error?:string}>;sourceSession(id:string):Promise<{ok:boolean}> } } }
export {};
