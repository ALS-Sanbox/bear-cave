import type { Chapter, Job } from './types.js';
export function sameChapter(a: Chapter, b: Chapter) {
    return /^\d+(?:\.\d+)?$/.test(a.number) && /^\d+(?:\.\d+)?$/.test(b.number) && Number(a.number) === Number(b.number) && a.language === b.language &&
        (!a.volume || !b.volume || a.volume === b.volume || Number(a.volume) === Number(b.volume));
}
// Retain explicitly selected same-source translations while collapsing overlap between sources.
export function libraryChapterCount(jobs: Job[]) {
    const groups: {
        chapter: Chapter;
        sources: Map<string, number>;
    }[] = [];
    for (const job of jobs) {
        let group = groups.find(g => sameChapter(g.chapter, job.chapter));
        if (!group) {
            group = { chapter: job.chapter, sources: new Map() };
            groups.push(group);
        }
        group.sources.set(job.source, (group.sources.get(job.source) ?? 0) + 1);
    }
    return groups.reduce((n, g) => n + Math.max(...g.sources.values()), 0);
}
