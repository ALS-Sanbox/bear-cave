export type JobState = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'action_required';
export interface Series {
    id: string;
    source: string;
    title: string;
    description: string;
    coverRef?: string;
    url?: string;
    metadata?: Record<string, unknown>;
    library?: {
        state: string;
        downloaded: number;
        total: number;
    };
}
export interface Chapter {
    url?: string;
    id: string;
    source: string;
    seriesId: string;
    title: string;
    number: string;
    volume: string;
    language: string;
    groups: {
        id: string;
        name: string;
    }[];
    pages: number | null;
    external: boolean;
    localState?: string;
    localJobId?: string;
    localSource?: string;
    localChapterId?: string;
}
export interface PageResult<T> {
    totalExact?: boolean;
    items: T[];
    total: number;
    offset: number;
    limit: number;
}
export interface ChapterFilter {
    language: string;
    group?: string;
}
export interface Job {
    id: string;
    source: string;
    chapter: Chapter;
    series: Series;
    state: JobState;
    done: number;
    total: number;
    attempts: number;
    error: string | null;
    output: string | null;
    completedAt?: string;
    created: string;
    updated: string;
    root: string;
    format: 'folders' | 'cbz';
    seriesFolder?: string;
    copySuffix?: string;
    replacement?: {
        original: string;
        suffix?: string;
    };
    verification?: {
        state: 'verified' | 'missing' | 'damaged' | 'inaccessible';
        checked: string;
    };
    previousOutputs?: string[];
}
export interface Settings {
    downloadRoot: string;
    format: 'folders' | 'cbz';
    globalChapters: number;
    sourceChapters: Record<string, number>;
    pageRequests: number;
    port: number;
    startWithWindows: boolean;
    publicUrl: string;
    trustTunnel: boolean;
}
export interface SourceManifest {
    id: string;
    name: string;
    website: string;
    status: 'operational' | 'planned';
    interfaceVersion: 1;
    capabilities: string[];
    apiHosts: string[];
    imageHosts: string[];
    note?: string;
    hold?: {
        source: string;
        reason: string;
        count: number;
    } | null;
    recommended: {
        chapters: number;
        pageRequests: number;
        requestIntervalMs: number;
    };
}
export interface ResolvedPages {
    revision: string;
    urls: string[];
    identities?: string[];
}
export interface FollowedSeries {
    coverKey?: string;
    failures?: number;
    id: string;
    series: Series;
    language: string;
    group?: string;
    autoDownload: boolean;
    outputFormat?: 'inherit' | 'cbz' | 'folders';
    intervalHours: number;
    enabled: boolean;
    lastCheck?: string;
    nextCheck: string;
    lastSuccess?: string;
    error?: string;
    missing: number;
    translations: number;
}
export interface SourceAdapter {
    manifest: SourceManifest;
    search(query: string, offset: number, signal?: AbortSignal): Promise<PageResult<Series>>;
    series(id: string, signal?: AbortSignal): Promise<Series>;
    chapters(id: string, filter: ChapterFilter, offset: number, signal?: AbortSignal): Promise<PageResult<Chapter>>;
    chapter(id: string, signal?: AbortSignal): Promise<Chapter>;
    resolve(id: string, signal?: AbortSignal): Promise<ResolvedPages>;
    readPage?(url: string, signal?: AbortSignal): Promise<Uint8Array>;
    cover?(id: string, signal?: AbortSignal, reference?: string): Promise<Uint8Array>;
    account?: {
        kind: 'browser';
        loginUrl: string;
        hosts?: string[];
    };
}
export class SourceError extends Error {
    constructor(message: string, public kind: 'transient' | 'permanent' | 'action_required' | 'expired' = 'permanent', public retryAfterMs = 0) {
        super(message);
    }
}
