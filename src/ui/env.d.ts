import type { Settings, SourceManifest } from '../shared/types';
declare global { interface Window { bearCaveLocal?: { read(): Promise<{ settings:Settings;sources:SourceManifest[];adminConfigured:boolean }>; save(settings:Settings,password?:string): Promise<{ ok:boolean;error?:string;restartRequired?:boolean }>; pickFolder(): Promise<string|null> } } }
export {};
