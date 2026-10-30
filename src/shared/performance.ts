import type { Settings, SourceManifest } from './types.js';
export const profiles = {
    conservative: {
        globalChapters: 1, pageRequests: 2, globalPageRequests: 2
    },
    balanced: {
        globalChapters: 3, pageRequests: 6, globalPageRequests: 18
    },
    fast: {
        globalChapters: 5, pageRequests: 10, globalPageRequests: 30
    }
};
export function applyProfile(settings: Settings, profile: NonNullable<Settings['performanceProfile']>, sources: SourceManifest[]) {
    settings.performanceProfile = profile;
    if (profile === 'custom')
        return;
    Object.assign(settings, profiles[profile]);
    settings.sourceChapters = Object.fromEntries(sources.filter(s => s.status === 'operational').map(s => [s.id, Math.min(profile === 'conservative' ? 1 : profile === 'fast' ? 3 : 2, s.limits?.chapters ?? 4, s.id === 'mangadex' ? 1 : 4)]));
    settings.sourcePageRequests = Object.fromEntries(sources.filter(s => s.status === 'operational').map(s => [s.id, Math.min(settings.pageRequests, s.limits?.pageRequests ?? s.recommended.pageRequests)]));
    settings.sourceIntervals = Object.fromEntries(sources.filter(s => s.status === 'operational').map(s => [s.id, Math.max(s.limits?.minIntervalMs ?? 0, s.id === 'mangafreak' ? 0 : s.id === 'mangadex' ? 500 : 200)]));
}
