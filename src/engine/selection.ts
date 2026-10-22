import type { Chapter, ChapterFilter, Series, SourceAdapter } from '../shared/types.js';
import type { Store } from '../core/store.js';
export async function matching(adapter: SourceAdapter, seriesId: string, filter: ChapterFilter, ids?: string[], signal?: AbortSignal, guard?: () => void) {
    const chapters: Chapter[] = [];
    let offset = 0;
    do {
        signal?.throwIfAborted();
        guard?.();
        const page = await adapter.chapters(seriesId, filter, offset, signal);
        signal?.throwIfAborted();
        chapters.push(...page.items);
        offset += page.limit;
        if (ids?.every(id => chapters.some(c => c.id === id)) || offset >= page.total)
            break;
        if (offset + page.limit > 10000)
            throw Error('Too many matching chapters. Narrow the filters.');
    } while (true);
    const unique = [...new Map(chapters.map(c => [c.id, c])).values()].filter(c => !c.external && c.pages !== 0 && c.source === adapter.manifest.id && c.seriesId === seriesId && (!ids || ids.includes(c.id)));
    if (ids?.some(id => !unique.some(c => c.id === id)))
        throw Error('Some selected chapters are unavailable. Refresh the chapter list.');
    return unique;
}
export function selectionSummary(store: Store, source: string, chapters: Chapter[]) {
    const existing = store.chapterJobs(source, chapters.map(c => c.id)), fresh = chapters.filter(c => !existing[c.id]);
    let multipleTranslations = 0;
    const logical = new Set<string>();
    // Existing translations also count: adding another group must never happen silently.
    for (const key of chapters.length ? store.logicalChapters(source, chapters[0].seriesId) : [])
        logical.add(key);
    for (const c of fresh) {
        const key = `${c.volume}|${c.number}|${c.language}`;
        if (logical.has(key))
            multipleTranslations++;
        logical.add(key);
    }
    return {
        count: fresh.length, total: chapters.length, completed: chapters.filter(c => existing[c.id]?.state === 'completed').length, existing: chapters.filter(c => existing[c.id] && existing[c.id].state !== 'completed').length, multipleTranslations
    };
}
export function enqueueSelection(store: Store, series: Series, chapters: Chapter[], settings: import('../shared/types.js').Settings, confirmTranslations: boolean) {
    store.db.exec('BEGIN IMMEDIATE');
    try {
        const summary = selectionSummary(store, series.source, chapters);
        if (summary.multipleTranslations && !confirmTranslations)
            throw Error('Additional translations now require confirmation. Preview again or choose one group.');
        let added = 0, duplicates = 0;
        for (const c of chapters)
            store.enqueue(series, c, settings).duplicate ? duplicates++ : added++;
        store.db.exec('COMMIT');
        return {
            added, duplicates, ...summary
        };
    }
    catch (e) {
        store.db.exec('ROLLBACK');
        throw e;
    }
}
