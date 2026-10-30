import { ref, computed, onMounted, onUnmounted, watch, type UnwrapNestedRefs } from 'vue';
import type { Settings, Series, Chapter, Job, SourceManifest, PageResult, FollowedSeries } from '../../shared/types';
export interface Preview {
    token: string;
    count: number;
    total: number;
    completed: number;
    existing: number;
    multipleTranslations: number;
}
export interface Hold {
    source: string;
    reason: string;
    count: number;
}
export interface DialogPort {
    showModal(): void;
    close(): void;
    isOpen(): boolean;
}
export const statusLabels: Record<string, string> = {
    unverified: 'Not checked', not_downloaded: 'Not downloaded', queued: 'Queued', running: 'Downloading', paused: 'Paused', failed: 'Failed', action_required: 'Needs local action', completed: 'Completed', missing: 'Missing', damaged: 'Damaged', cancelled: 'Cancelled', inaccessible: 'Storage inaccessible', verified: 'Verified'
};
export function useDashboard() {
    const authenticated = ref(false), setupRequired = ref(false), password = ref(''), csrf = ref(''), busy = ref(false), error = ref(''), message = ref('');
    const view = ref<'search' | 'queue' | 'history' | 'sources' | 'followed'>('search');
    let remembered: {
        source?: string;
        filters?: Record<string, {
            language: string;
            group: string;
        }>;
    } = {};
    try {
        const parsed = JSON.parse(localStorage.getItem('bear-cave-preferences') ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            remembered = parsed;
    }
    catch {
    }
    if (typeof remembered.source !== 'string' || !/^[a-z][a-z0-9-]{0,29}$/.test(remembered.source))
        remembered.source = undefined;
    if (!remembered.filters || typeof remembered.filters !== 'object' || Array.isArray(remembered.filters))
        remembered.filters = {};
    const selectedSource = ref('all'), language = ref('en'), group = ref(''), query = ref(''), results = ref<PageResult<Series>>(), detail = ref<Series>(), chapters = ref<PageResult<Chapter>>(), selected = ref<string[]>([]), knownGroups = ref<{
        id: string;
        name: string;
    }[]>([]);
    const searching = ref(false), searchStates = ref<{
        id: string;
        name: string;
        state: 'waiting' | 'searching' | 'done' | 'error';
        error?: string;
        retryOffset?: number;
        total: number;
        offset: number;
        limit: number;
        loaded: number;
    }[]>([]);
    let searchController: AbortController | undefined, searchedQuery = '';
    let seriesController: AbortController | undefined, chapterController: AbortController | undefined;
    let libraryController: AbortController | undefined;
    const libraryChecking = ref(false), libraryMessage = ref(''), libraryError = ref('');
    function cancelFolderCheck() {
        libraryController?.abort();
        libraryChecking.value = false;
    }
    const detailLoading = ref(false), chaptersLoading = ref(false), chaptersError = ref('');
    function closeSeries() {
        seriesController?.abort();
        chapterController?.abort();
        cancelFolderCheck();
        libraryMessage.value = '';
        libraryError.value = '';
        detailLoading.value = false;
        chaptersLoading.value = false;
        chaptersError.value = '';
        detail.value = undefined;
        chapters.value = undefined;
        preview.value = undefined;
    }
    watch([language, group], () => {
        cancelFolderCheck();
        libraryMessage.value = '';
        libraryError.value = '';
    });
    const sources = ref<SourceManifest[]>([]), jobs = ref<Job[]>([]), counts = ref<Record<string, number>>({}), holds = ref<Hold[]>([]), paused = ref(false), total = ref(0), offset = ref(0), pageSize = 100;
    const librarySearch = ref(''), sourceFilter = ref(''), statusFilter = ref(''), follows = ref<FollowedSeries[]>([]);
    const enabledSources = computed(() => sources.value.filter(s => s.status === 'operational')), activeCount = computed(() => counts.value.running ?? 0), remainingCount = computed(() => Object.entries(counts.value).reduce((n, [state, count]) => n + (state === 'completed' ? 0 : count), 0));
    const sourceGroups = ref<Record<string, {
        completed: number;
        remaining: number;
        done: number;
        total: number;
        active?: string;
    }>>({});
    const performanceConfig = ref<Settings>();
    const performance = ref({
        currentBytesPerSecond: 0, averageBytesPerSecond: 0, activeChapters: 0, activeImages: 0, done: 0, total: 0, completedImages: 0, failedImages: 0, retries: 0
    });
    async function loadPerformance() {
        try {
            const config = await api<Settings>('performance');
            config.globalPageRequests ??= config.pageRequests;
            config.sourcePageRequests ??= {};
            config.sourceIntervals ??= {};
            for (const s of enabledSources.value) {
                config.sourceChapters[s.id] ??= s.recommended.chapters;
                config.sourcePageRequests[s.id] ??= s.recommended.pageRequests;
                config.sourceIntervals[s.id] ??= s.id === 'mangadex' ? 500 : s.id === 'mangafreak' ? 0 : 200;
            }
            performanceConfig.value = config;
        }
        catch (e) {
            error.value = (e as Error).message;
        }
    }
    async function savePerformance() {
        await perform(async () => {
            await api('performance', performanceConfig.value);
            message.value = 'Download performance saved.';
        });
    }
    const preview = ref<Preview>(), previewLoading = ref(false), previewError = ref(''), confirmTranslations = ref(false), downloadDialog = ref<DialogPort>();
    let previewController: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, refreshing = false, refreshAgain = false;
    let pollFailures = 0, pollError = '';
    const savePreferences = () => {
        remembered.source = selectedSource.value;
        remembered.filters ??= {};
        remembered.filters[detail.value?.source ?? selectedSource.value] = { language: language.value, group: group.value };
        try {
            localStorage.setItem('bear-cave-preferences', JSON.stringify(remembered));
        }
        catch {
        }
    };
    function restoreFilters(source = selectedSource.value) {
        const saved = remembered.filters?.[source];
        language.value = source === 'mangadex' && typeof saved?.language === 'string' && /^[a-z]{2,3}(-[a-z]{2})?$/.test(saved.language) ? saved.language : 'en';
        group.value = ['mangadex', 'comix'].includes(source) && typeof saved?.group === 'string' && /^[a-zA-Z0-9_-]{0,1200}$/.test(saved.group) ? saved.group : '';
    }
    restoreFilters();
    watch(selectedSource, () => {
        closeSeries();
        searchController?.abort();
        searching.value = false;
        searchStates.value = [];
        detail.value = undefined;
        restoreFilters();
        savePreferences();
        results.value = undefined;
        detail.value = undefined;
        chapters.value = undefined;
        preview.value = undefined;
    });
    async function request(url: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
        const response = await fetch(`/api/${url}`, {
            method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.value }, body: body === undefined ? undefined : JSON.stringify(body), signal
        });
        if (!response.ok) {
            const data = await response.json();
            if (response.status === 401 && url !== 'login') {
                closeSeries();
                searchController?.abort();
                searching.value = false;
                results.value = undefined;
                searchStates.value = [];
                authenticated.value = false;
                csrf.value = '';
                jobs.value = [];
                busy.value = false;
                previewController?.abort();
                downloadDialog.value?.close();
                throw Error('Your dashboard session ended. Sign in again using your Bear Cave administrator password.');
            }
            throw Error(data.error ?? 'Request failed.');
        }
        return response;
    }
    async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
        return (await request(url, body, signal)).json();
    }
    async function perform(fn: () => Promise<unknown>) {
        if (busy.value)
            return;
        busy.value = true;
        error.value = '';
        message.value = '';
        try {
            await fn();
        }
        catch (e) {
            error.value = (e as Error).message;
        }
        finally {
            busy.value = false;
        }
    }
    async function refresh() {
        if (!authenticated.value || stopped)
            return;
        if (refreshing) {
            refreshAgain = true;
            return;
        }
        refreshing = true;
        const key = [view.value, offset.value, librarySearch.value, sourceFilter.value, statusFilter.value].join('|');
        try {
            const params = new URLSearchParams({
                history: String(view.value === 'history'), offset: String(offset.value), limit: String(pageSize), q: librarySearch.value, source: sourceFilter.value, state: statusFilter.value
            });
            const data = await api<{
                performance?: typeof performance.value;
                jobs: Job[];
                total: number;
                counts: Record<string, number>;
                holds: Hold[];
                paused: boolean;
                groups: typeof sourceGroups.value;
            }>(['queue', 'history'].includes(view.value) ? `jobs?${params}` : 'summary');
            if (key === [view.value, offset.value, librarySearch.value, sourceFilter.value, statusFilter.value].join('|')) {
                performance.value = data.performance ?? performance.value;
                jobs.value = data.jobs;
                total.value = data.total;
                counts.value = data.counts;
                holds.value = data.holds;
                paused.value = data.paused;
                sourceGroups.value = data.groups ?? {};
            }
            if (view.value === 'followed')
                follows.value = await api('follows');
            if (chapters.value && detail.value && view.value === 'search') {
                const snapshot = chapters.value;
                const local: Record<string, string> = {};
                const sources = new Set(snapshot.items.map(c => c.localSource ?? c.source));
                for (const source of sources) {
                    const items = snapshot.items.filter(c => (c.localSource ?? c.source) === source);
                    const states = await api<Record<string, string>>('chapter-status', { source, ids: items.map(c => c.localChapterId ?? c.id) });
                    for (const c of items)
                        if (states[c.localChapterId ?? c.id])
                            local[c.id] = states[c.localChapterId ?? c.id];
                }
                const series = detail.value;
                if (series) {
                    const library = await api<NonNullable<Series['library']>>(`library-status?source=${series.source}&id=${encodeURIComponent(series.id)}&total=${seriesTotal.value}`);
                    if (detail.value === series && chapters.value === snapshot)
                        series.library = library;
                }
                if (chapters.value === snapshot)
                    for (const c of snapshot.items)
                        c.localState = local[c.id] ?? 'not_downloaded';
            }
            pollFailures = 0;
            if (error.value === pollError)
                error.value = '';
            pollError = '';
        }
        finally {
            refreshing = false;
            if (refreshAgain) {
                refreshAgain = false;
                void refresh().catch(e => {
                    error.value = e.message;
                });
            }
        }
    }
    async function login() {
        await perform(async () => {
            const data = await api<{
                csrf: string;
            }>('login', { password: password.value });
            password.value = '';
            csrf.value = data.csrf;
            authenticated.value = true;
            sources.value = await api('sources');
            follows.value = await api('follows');
            await refresh();
        });
    }
    async function logout() {
        closeSeries();
        await perform(async () => {
            await api('logout', {});
            searchController?.abort();
            authenticated.value = false;
            password.value = '';
            jobs.value = [];
            detail.value = undefined;
            results.value = undefined;
            preview.value = undefined;
            follows.value = [];
        });
    }
    function acceptSearchPage(source: string, page: PageResult<Series>, controller: AbortController, append = false) {
        const state = searchStates.value.find(s => s.id === source);
        if (!state || controller !== searchController || controller.signal.aborted)
            return;
        const previous = selectedSource.value === 'all' || append ? results.value?.items ?? [] : [];
        const unique = new Map(previous.map(s => [`${s.source}:${s.id}`, s]));
        page.items.forEach(s => unique.set(`${s.source}:${s.id}`, s));
        const order = new Map(searchStates.value.map((s, i) => [s.id, i]));
        const items = [...unique.values()].sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));
        state.state = 'done';
        state.offset = page.offset;
        state.limit = page.limit;
        state.total = page.total;
        state.loaded = items.filter(s => s.source === source).length;
        results.value = {
            items, totalExact: selectedSource.value === 'all' ? false : page.totalExact, total: selectedSource.value === 'all' ? searchStates.value.reduce((n, s) => n + s.total, 0) : page.total, offset: selectedSource.value === 'all' ? 0 : page.offset, limit: page.limit
        };
    }
    async function searchAll(controller: AbortController) {
        searchStates.value.forEach(state => {
            state.state = 'searching';
        });
        const completed = new Set<string>();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            const response = await request(`search-all?q=${encodeURIComponent(searchedQuery)}`, undefined, controller.signal);
            reader = response.body?.getReader();
            if (!reader)
                throw Error('Search response was empty. Retry the search.');
            const decoder = new TextDecoder();
            let buffer = '';
            const accept = (line: string) => {
                if (!line.trim() || controller !== searchController || controller.signal.aborted)
                    return;
                const event = JSON.parse(line) as {
                    source: string;
                    page?: PageResult<Series>;
                    error?: string;
                };
                const state = searchStates.value.find(s => s.id === event.source);
                if (!state)
                    return;
                completed.add(event.source);
                if (event.page)
                    acceptSearchPage(event.source, event.page, controller);
                else {
                    state.state = 'error';
                    state.retryOffset = 0;
                    state.error = event.error || 'Source search failed. Retry this source.';
                }
            };
            for (;;) {
                const part = await reader.read();
                buffer += decoder.decode(part.value, { stream: !part.done });
                if (buffer.length > 2 * 1024 * 1024)
                    throw Error('Search response exceeded its size limit.');
                let end: number;
                while ((end = buffer.indexOf('\n')) >= 0) {
                    accept(buffer.slice(0, end));
                    buffer = buffer.slice(end + 1);
                }
                if (part.done) {
                    accept(buffer);
                    break;
                }
            }
            if (searchStates.value.some(state => !completed.has(state.id)))
                throw Error('Search response ended early. Retry unfinished sources.');
        }
        catch (e) {
            if (controller !== searchController || controller.signal.aborted)
                return;
            searchStates.value.filter(state => !completed.has(state.id) && ['searching', 'waiting'].includes(state.state)).forEach(state => {
                state.state = 'error';
                state.retryOffset = 0;
                state.error = (e as Error).message;
            });
        }
        finally {
            if (reader) {
                await reader.cancel().catch(() => {
                });
                reader.releaseLock();
            }
        }
    }
    async function searchPage(source: string, at: number, controller: AbortController, append = false) {
        const state = searchStates.value.find(s => s.id === source);
        if (!state)
            return;
        state.state = 'searching';
        state.error = undefined;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]);
        try {
            const page = await api<PageResult<Series>>(`search?source=${source}&q=${encodeURIComponent(searchedQuery)}&offset=${at}`, undefined, signal);
            acceptSearchPage(source, page, controller, append);
        }
        catch (e) {
            if (controller !== searchController || controller.signal.aborted)
                return;
            state.state = 'error';
            state.retryOffset = at;
            state.error = signal.aborted ? 'Search timed out. Retry this source.' : (e as Error).message;
            if (selectedSource.value !== 'all')
                error.value = state.error;
        }
    }
    async function search(at = 0) {
        if (busy.value || !query.value.trim())
            return;
        searchController?.abort();
        const controller = new AbortController();
        searchController = controller;
        searching.value = true;
        error.value = '';
        message.value = '';
        savePreferences();
        coverRevision.value++;
        closeSeries();
        searchedQuery = query.value.trim();
        const targets = selectedSource.value === 'all' ? enabledSources.value : enabledSources.value.filter(s => s.id === selectedSource.value);
        searchStates.value = targets.map(s => ({
            id: s.id, name: s.name, state: 'waiting', total: 0, offset: at, limit: 0, loaded: 0
        }));
        results.value = {
            items: [], total: 0, offset: at, limit: 50
        };
        try {
            // Each provider has its own pacing and cancellation; a slow provider
            // must not prevent an unrelated provider from starting its first page.
            if (selectedSource.value === 'all')
                await searchAll(controller);
            else if (targets[0])
                await searchPage(targets[0].id, at, controller);
        }
        finally {
            if (searchController === controller)
                searching.value = false;
        }
    }
    async function searchMore(source: string) {
        const state = searchStates.value.find(s => s.id === source), controller = searchController;
        if (!state || !controller || controller.signal.aborted || state.state === 'searching')
            return;
        await searchPage(source, state.state === 'error' ? state.retryOffset ?? state.offset : state.offset + state.limit, controller, true);
    }
    const allSelected = ref(false), excluded = ref<string[]>([]), seriesTotal = ref(0);
    const selectedCount = computed(() => allSelected.value ? Math.max(0, seriesTotal.value - excluded.value.length) : selected.value.length);
    function isSelected(id: string) {
        return allSelected.value ? !excluded.value.includes(id) : selected.value.includes(id);
    }
    function toggleChapter(id: string, checked: boolean) {
        const target = allSelected.value ? excluded : selected;
        target.value = target.value.filter(x => x !== id);
        if (allSelected.value ? !checked : checked)
            target.value.push(id);
    }
    function selectPage(checked = true) {
        chapters.value?.items.forEach(c => toggleChapter(c.id, checked));
    }
    function selectAll() {
        allSelected.value = true;
        excluded.value = [];
        selected.value = [];
    }
    function deselectAll() {
        allSelected.value = false;
        excluded.value = [];
        selected.value = [];
    }
    async function prepareSelected() {
        await prepare(allSelected.value ? undefined : selected.value, undefined, allSelected.value);
    }
    async function chapterAction(id: string, action: 'verify' | 'redownload') {
        await perform(async () => {
            await api(`jobs/${action}`, action === 'verify' ? { id } : { id, mode: 'replace' });
            await loadChapters(chapters.value?.offset ?? 0);
        });
    }
    async function checkFolder(force = true) {
        if (!detail.value)
            return;
        cancelFolderCheck();
        const controller = new AbortController(), series = detail.value, filter = JSON.stringify([language.value, group.value]);
        libraryController = controller;
        const signal = AbortSignal.any([controller.signal, ...(seriesController ? [seriesController.signal] : [])]);
        libraryChecking.value = true;
        libraryError.value = '';
        libraryMessage.value = '';
        try {
            const result = await api<{
                folderFound: boolean;
                completed?: number;
                imported: number;
                ambiguous: number;
                skipped: number;
            }>('library-scan', {
                source: series.source, seriesId: series.id, language: language.value, group: group.value || undefined, force
            }, signal);
            if (signal.aborted || libraryController !== controller || filter !== JSON.stringify([language.value, group.value]))
                return;
            libraryMessage.value = result.folderFound ? `Folder checked: ${result.completed ?? 0} completed chapter(s) recognized.` : 'No matching series folder found.';
            if (result.ambiguous)
                libraryMessage.value += ' Some files or folders are ambiguous. Choose a translation group or check the folder naming, then recheck.';
            if (result.skipped)
                libraryMessage.value += ` ${result.skipped} unsupported or incomplete file(s) left unchanged.`;
            if (result.imported)
                libraryMessage.value += ' Numbered external files were matched to the selected language/group.';
            if (result.folderFound)
                await loadChapters(chapters.value?.offset ?? 0, false);
        }
        catch (e) {
            if (!signal.aborted && libraryController === controller)
                libraryError.value = (e as Error).message;
        }
        finally {
            if (libraryController === controller)
                libraryChecking.value = false;
        }
    }
    async function loadChapters(at = 0, scan = false) {
        if (!detail.value)
            return;
        savePreferences();
        chapterController?.abort();
        const controller = new AbortController(), series = detail.value;
        chapterController = controller;
        const signal = AbortSignal.any([controller.signal, ...(seriesController ? [seriesController.signal] : [])]);
        chaptersLoading.value = true;
        chaptersError.value = '';
        try {
            const page = await api<PageResult<Chapter> & {
                library?: Series['library'];
            }>(`chapters?source=${series.source}&id=${encodeURIComponent(series.id)}&language=${encodeURIComponent(language.value)}&group=${encodeURIComponent(group.value)}&offset=${at}`, undefined, signal);
            if (signal.aborted || chapterController !== controller || detail.value?.source !== series.source || detail.value?.id !== series.id)
                return;
            chapters.value = page;
            seriesTotal.value = page.total;
            if (page.library)
                detail.value.library = page.library;
            const merged = new Map(knownGroups.value.map(g => [g.id, g]));
            page.items.flatMap(c => c.groups).forEach(g => merged.set(g.id, g));
            knownGroups.value = [...merged.values()];
            preview.value = undefined;
            if (scan)
                void checkFolder(false);
        }
        catch (e) {
            if (!signal.aborted && chapterController === controller)
                chaptersError.value = (e as Error).message;
        }
        finally {
            if (chapterController === controller)
                chaptersLoading.value = false;
        }
    }
    async function openSeries(series: Series) {
        if (busy.value)
            return;
        if (selectedSource.value !== 'all' && selectedSource.value !== series.source) {
            selectedSource.value = series.source;
            await Promise.resolve();
        }
        closeSeries();
        const controller = new AbortController();
        seriesController = controller;
        detail.value = { ...series };
        detailLoading.value = true;
        error.value = '';
        restoreFilters(series.source);
        deselectAll();
        seriesTotal.value = 0;
        knownGroups.value = [];
        const metadata = (async () => {
            try {
                const result = await api<Series>(`series?source=${series.source}&id=${encodeURIComponent(series.id)}`, undefined, controller.signal);
                if (seriesController === controller && !controller.signal.aborted && detail.value)
                    detail.value = { ...result, library: detail.value.library ?? result.library };
            }
            catch (e) {
                if (seriesController === controller && !controller.signal.aborted)
                    error.value = (e as Error).message;
            }
            finally {
                if (seriesController === controller)
                    detailLoading.value = false;
            }
        })();
        await Promise.all([metadata, loadChapters(0, true)]);
    }
    async function prepare(ids?: string[], followId?: string, all = false) {
        if (busy.value || !detail.value && !followId)
            return;
        cancelFolderCheck();
        const controller = new AbortController();
        previewController = controller;
        preview.value = undefined;
        previewError.value = '';
        confirmTranslations.value = false;
        previewLoading.value = true;
        busy.value = true;
        downloadDialog.value?.showModal();
        try {
            preview.value = followId ? await api(`follows/${followId}/preview`, {}, controller.signal) : await api('preview', {
                source: detail.value!.source, seriesId: detail.value!.id, language: language.value, group: all ? undefined : group.value || undefined, ids, all, exclude: all ? excluded.value : undefined
            }, controller.signal);
        }
        catch (e) {
            if (!controller.signal.aborted)
                previewError.value = (e as Error).message;
        }
        finally {
            if (previewController === controller) {
                previewController = undefined;
                previewLoading.value = false;
                busy.value = false;
            }
        }
    }
    function cancelPreview(event?: Event) {
        if (busy.value && !previewLoading.value) {
            event?.preventDefault();
            return;
        }
        previewController?.abort();
        previewController = undefined;
        previewLoading.value = false;
        busy.value = false;
        preview.value = undefined;
        previewError.value = '';
        downloadDialog.value?.close();
    }
    async function enqueue() {
        if (!preview.value || busy.value)
            return;
        busy.value = true;
        previewError.value = '';
        try {
            const r = await api<{
                added: number;
                duplicates: number;
            }>('enqueue', { token: preview.value.token, confirmTranslations: confirmTranslations.value });
            preview.value = undefined;
            downloadDialog.value?.close();
            view.value = 'queue';
            message.value = `Queued ${r.added} new chapter(s); skipped ${r.duplicates} existing job(s).${paused.value ? ' Downloads are paused. Select Resume downloads to start.' : ''}`;
            window.scrollTo({ top: 0 });
            await refresh();
        }
        catch (e) {
            previewError.value = (e as Error).message;
        }
        finally {
            busy.value = false;
        }
    }
    async function control(id: string, action: string) {
        await perform(async () => {
            await api(`jobs/${id}`, { action });
            await refresh();
        });
    }
    async function groupControl(source: string, series: string, action: string) {
        if (action === 'remove' && !window.confirm('Remove this series from the queue? Saved files are kept.'))
            return;
        await perform(async () => {
            await api('jobs/group', {
                source, series, action
            });
            await refresh();
        });
    }
    async function allControl(action: string) {
        await perform(async () => {
            await api('queue', { action });
            await refresh();
        });
    }
    async function deleteDownloads(id?: string) {
        if (!id && !window.confirm('Delete the entire queue? Active downloads stop. Completed history and saved files are kept.'))
            return;
        await perform(async () => {
            const r = await api<{
                deleted: number;
            }>('jobs/delete', id ? { id } : { all: true });
            message.value = `Removed ${r.deleted} queue entries. Saved files were kept.`;
            await refresh();
        });
    }
    async function clearFailed() {
        await perform(async () => {
            const r = await api<{
                cleared: number;
            }>('jobs/clear-failed', {});
            message.value = `Cleared ${r.cleared} failed chapters. Saved files were kept.`;
            await refresh();
        });
    }
    async function retrySource(source: string) {
        await perform(async () => {
            const r = await api<{
                requeued: number;
            }>('source-retry', { source });
            message.value = `Released the source hold and queued ${r.requeued} affected download(s).`;
            await refresh();
        });
    }
    async function verify(id: string) {
        await perform(async () => {
            const result = await api<{
                state: string;
            }>('jobs/verify', { id });
            message.value = `File check: ${statusLabels[result.state] ?? result.state}.`;
            await refresh();
        });
    }
    async function downloadAgain(job: Job) {
        const missing = job.verification?.state === 'missing';
        if (!missing && !window.confirm('Re-download and replace this chapter after the new files pass verification?'))
            return;
        await perform(async () => {
            await api('jobs/redownload', { id: job.id, mode: missing ? 'missing' : 'replace' });
            message.value = 'Chapter queued again. Existing files stay available until the verified replacement is ready.';
            await refresh();
        });
    }
    const coverRevision = ref(0);
    const coverFormat = ref<'default' | 'png' | 'jpg'>('default');
    try {
        const saved = localStorage.getItem('bear-cave-cover-format');
        if (saved === 'png' || saved === 'jpg')
            coverFormat.value = saved;
    }
    catch { /* Use local settings by default. */
    }
    watch(coverFormat, value => {
        try {
            localStorage.setItem('bear-cave-cover-format', value);
        }
        catch { /* Preferences are optional. */
        }
    });
    async function downloadCover() {
        if (!detail.value)
            return;
        await perform(async () => {
            const result = await api<{
                filename: string;
            }>('cover', {
                source: detail.value!.source, id: detail.value!.id, format: coverFormat.value === 'default' ? undefined : coverFormat.value
            });
            coverRevision.value++;
            message.value = `Saved ${result.filename} in the series download folder.`;
        });
    }
    async function followSeries() {
        if (!detail.value)
            return;
        await perform(async () => {
            const existing = follows.value.find(f => f.series.source === detail.value!.source && f.series.id === detail.value!.id);
            if (existing)
                await api(`follows/${existing.id}/remove`, {});
            else
                await api('follows', {
                    source: detail.value!.source, seriesId: detail.value!.id, language: language.value, group: group.value || undefined, autoDownload: false, enabled: false, intervalHours: 6
                });
            follows.value = await api('follows');
        });
    }
    async function saveFollow(f: FollowedSeries) {
        await perform(async () => {
            await api('follows', {
                source: f.series.source, seriesId: f.series.id, language: f.language, group: f.group || undefined, autoDownload: f.autoDownload, enabled: f.enabled, intervalHours: f.intervalHours, outputFormat: f.outputFormat ?? 'inherit'
            });
            follows.value = await api('follows');
            message.value = 'Follow preferences saved. Scheduled checks run only while Bear Cave is running.';
        });
    }
    async function checkFollow(id: string) {
        await perform(async () => {
            await api(`follows/${id}/check`, {});
            follows.value = await api('follows');
            message.value = 'Missing-chapter check finished.';
        });
    }
    async function removeFollow(id: string) {
        await perform(async () => {
            await api(`follows/${id}/remove`, {});
            follows.value = await api('follows');
        });
    }
    watch(view, () => {
        offset.value = 0;
        librarySearch.value = '';
        sourceFilter.value = '';
        statusFilter.value = '';
        void refresh().catch(e => {
            error.value = e.message;
        });
    });
    async function page(at: number) {
        offset.value = Math.max(0, at);
        await perform(refresh);
    }
    async function applyLibraryFilters() {
        offset.value = 0;
        await perform(refresh);
    }
    function poll() {
        if (stopped)
            return;
        timer = setTimeout(async () => {
            if (!document.hidden)
                try {
                    await refresh();
                }
                catch (e) {
                    pollFailures = Math.min(4, pollFailures + 1);
                    pollError = (e as Error).message;
                    error.value = pollError;
                }
            poll();
        }, document.hidden ? 30000 : Math.min(30000, 2500 * 2 ** pollFailures));
    }
    const visibility = () => {
        if (!document.hidden) {
            pollFailures = 0;
            if (timer)
                clearTimeout(timer);
            poll();
            void refresh().catch(e => {
                error.value = e.message;
            });
        }
    };
    onMounted(() => {
        void perform(async () => {
            const s = await api<{
                authenticated: boolean;
                csrf?: string;
                setupRequired: boolean;
            }>('session');
            authenticated.value = s.authenticated;
            csrf.value = s.csrf ?? '';
            setupRequired.value = s.setupRequired;
            if (s.authenticated) {
                sources.value = await api('sources');
                follows.value = await api('follows');
                await refresh();
            }
        });
        document.addEventListener('visibilitychange', visibility);
        poll();
    });
    onUnmounted(() => {
        closeSeries();
        searchController?.abort();
        stopped = true;
        if (timer)
            clearTimeout(timer);
        previewController?.abort();
        document.removeEventListener('visibilitychange', visibility);
    });
    return {
        performance, performanceConfig, loadPerformance, savePerformance,
        checkFolder, cancelFolderCheck, libraryChecking, libraryMessage, libraryError,
        coverFormat,
        closeSeries, detailLoading, chaptersLoading, chaptersError,
        searching, searchStates, searchMore, coverRevision, allSelected, excluded, seriesTotal, selectedCount, isSelected, toggleChapter, selectPage, selectAll, deselectAll, prepareSelected, chapterAction, authenticated, setupRequired, password, busy, error, message, view, selectedSource, language, group, query, results, detail, chapters, selected, knownGroups, sources, jobs, counts, holds, paused, total, offset, pageSize, librarySearch, sourceFilter, statusFilter, follows, enabledSources, activeCount, remainingCount, sourceGroups, preview, previewLoading, previewError, confirmTranslations, downloadDialog, perform, refresh, login, logout, search, loadChapters, openSeries, prepare, cancelPreview, enqueue, control, groupControl, allControl, deleteDownloads, clearFailed, retrySource, verify, downloadAgain, downloadCover, followSeries, saveFollow, checkFollow, removeFollow, page, applyLibraryFilters
    };
}
export type DashboardModel = UnwrapNestedRefs<ReturnType<typeof useDashboard>>;
