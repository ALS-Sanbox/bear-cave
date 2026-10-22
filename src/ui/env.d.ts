import type { Settings, SourceManifest } from '../shared/types';
interface AccountStatus {
    connected: boolean;
    username?: string;
    message?: string;
}
declare global {
    interface Window {
        bearCaveLocal?: {
            stagingScan(): Promise<{
                token: string;
                bytes: number;
                entries: {
                    title: string;
                    bytes: number;
                    chapter: string;
                }[];
            }>;
            stagingClean(token: string): Promise<{
                removed: number;
            }>;
            read(): Promise<{
                settings: Settings;
                sources: SourceManifest[];
                mangaAccount: AccountStatus;
                adminConfigured: boolean;
            }>;
            save(settings: Settings, password?: string): Promise<{
                ok: boolean;
                error?: string;
                restartRequired?: boolean;
            }>;
            pickFolder(): Promise<string | null>;
            mangaConnect(credentials: {
                clientId: string;
                clientSecret: string;
                username: string;
                password: string;
            }): Promise<{
                ok: boolean;
                status?: AccountStatus;
                error?: string;
            }>;
            mangaDisconnect(): Promise<{
                ok: boolean;
                status?: AccountStatus;
                error?: string;
            }>;
            sourceSession(id: string): Promise<{
                ok: boolean;
            }>;
        };
    }
}
export {};
