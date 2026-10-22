import { ref, computed, onMounted, onUnmounted, watch, type UnwrapNestedRefs } from 'vue';
import type { Series, Chapter, Job, SourceManifest, PageResult, FollowedSeries } from '../../shared/types';
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
    const selectedSource = ref(remembered.source ?? 'mangadex'), language = ref('en'), group = ref(''), query = ref(''), results = ref<PageResult<Series>>(), detail = ref<Series>(), chapters = ref<PageResult<Chapter>>(), selected = ref<string[]>([]), knownGroups = ref<{
        id: string;
        name: string;
    }[]>([]);
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
    const preview = ref<Preview>(), previewLoading = ref(false), previewError = ref(''), confirmTranslations = ref(false), downloadDialog = ref<DialogPort>();
    let previewController: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, refreshing = false, refreshAgain = false;
    let pollFailures = 0, pollError = '';
    const savePreferences = () => {
        remembered.source = selectedSource.value;
        remembered.filters ??= {};
        remembered.filters[selectedSource.value] = { language: language.value, group: group.value };
        try {
            localStorage.setItem('bear-cave-preferences', JSON.stringify(remembered));
        }
        catch {
        }
    };
    function restoreFilters() {
        const saved = remembered.filters?.[selectedSource.value];
        language.value = selectedSource.value === 'mangadex' && typeof saved?.language === 'string' && /^[a-z]{2,3}(-[a-z]{2})?$/.test(saved.language) ? saved.language : 'en';
        group.value = selectedSource.value === 'mangadex' && typeof saved?.group === 'string' && /^[a-zA-Z0-9_-]{0,1200}$/.test(saved.group) ? saved.group : '';
    }
    restoreFilters();
    watch(selectedSource, () => {
        restoreFilters();
        savePreferences();
        results.value = undefined;
        detail.value = undefined;
        chapters.value = undefined;
        preview.value = undefined;
    });
    async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
        const response = await fetch(`/api/${url}`, {
            method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.value }, body: body === undefined ? undefined : JSON.stringify(body), signal
        });
        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401 && url !== 'login') {
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
        return data;
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
                jobs: Job[];
                total: number;
                counts: Record<string, number>;
                holds: Hold[];
                paused: boolean;
                groups: typeof sourceGroups.value;
            }>(['queue', 'history'].includes(view.value) ? `jobs?${params}` : 'summary');
            if (key === [view.value, offset.value, librarySearch.value, sourceFilter.value, statusFilter.value].join('|')) {
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
                const local = await api<Record<string, string>>('chapter-status', { source: detail.value.source, ids: snapshot.items.map(c => c.id) });
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
        await perform(async () => {
            await api('logout', {});
            authenticated.value = false;
            password.value = '';
            jobs.value = [];
            detail.value = undefined;
            results.value = undefined;
            preview.value = undefined;
            follows.value = [];
        });
    }
    async function search(at = 0) {
        await perform(async () => {
            savePreferences();
            results.value = await api(`search?source=${selectedSource.value}&q=${encodeURIComponent(query.value)}&offset=${at}`);
            detail.value = undefined;
        });
    }
    async function loadChapters(at = 0) {
        if (!detail.value)
            return;
        savePreferences();
        chapters.value = await api(`chapters?source=${detail.value.source}&id=${encodeURIComponent(detail.value.id)}&language=${encodeURIComponent(language.value)}&group=${encodeURIComponent(group.value)}&offset=${at}`);
        const merged = new Map(knownGroups.value.map(g => [g.id, g]));
        chapters.value!.items.flatMap(c => c.groups).forEach(g => merged.set(g.id, g));
        knownGroups.value = [...merged.values()];
        selected.value = [];
        preview.value = undefined;
    }
    async function openSeries(series: Series) {
        await perform(async () => {
            if (selectedSource.value !== series.source) {
                selectedSource.value = series.source;
                await Promise.resolve();
            }
            detail.value = await api(`series?source=${series.source}&id=${encodeURIComponent(series.id)}`);
            knownGroups.value = [];
            chapters.value = undefined;
            await loadChapters();
        });
    }
    async function prepare(ids?: string[], followId?: string) {
        if (busy.value || !detail.value && !followId)
            return;
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
                source: detail.value!.source, seriesId: detail.value!.id, language: language.value, group: group.value || undefined, ids
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
        if (!missing && !window.confirm('Keep the existing file and download a separate copy? The existing output will not be replaced.'))
            return;
        await perform(async () => {
            await api('jobs/redownload', { id: job.id, mode: missing ? 'missing' : 'copy' });
            message.value = 'Chapter queued again. Existing saved files were kept.';
            await refresh();
        });
    }
    async function downloadCover() {
        if (!detail.value)
            return;
        await perform(async () => {
            await api('cover', { source: detail.value!.source, id: detail.value!.id });
            message.value = 'Saved coverart.png in the series download folder.';
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
        stopped = true;
        if (timer)
            clearTimeout(timer);
        previewController?.abort();
        document.removeEventListener('visibilitychange', visibility);
    });
    return {
        authenticated, setupRequired, password, busy, error, message, view, selectedSource, language, group, query, results, detail, chapters, selected, knownGroups, sources, jobs, counts, holds, paused, total, offset, pageSize, librarySearch, sourceFilter, statusFilter, follows, enabledSources, activeCount, remainingCount, sourceGroups, preview, previewLoading, previewError, confirmTranslations, downloadDialog, perform, refresh, login, logout, search, loadChapters, openSeries, prepare, cancelPreview, enqueue, control, groupControl, allControl, deleteDownloads, clearFailed, retrySource, verify, downloadAgain, downloadCover, followSeries, saveFollow, checkFollow, removeFollow, page, applyLibraryFilters
    };
}
export type DashboardModel = UnwrapNestedRefs<ReturnType<typeof useDashboard>>;
