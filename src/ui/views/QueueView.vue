<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DashboardModel } from '../composables/useDashboard';
import CoverImage from '../components/CoverImage.vue';
import JobCard from '../components/JobCard.vue';
import LibraryFilters from '../components/LibraryFilters.vue';
import LibraryPagination from '../components/LibraryPagination.vue';
const props = defineProps<{
    model: DashboardModel;
}>();
const collapsed = ref<string[]>([]);
try {
    const saved = JSON.parse(localStorage.getItem('bear-cave-collapsed-series') ?? '[]');
    if (Array.isArray(saved)) collapsed.value = saved.filter(k => typeof k === 'string' && k.length <= 1300).slice(0,1000);
} catch { /* Start expanded if preferences are unavailable. */ }
function expand(key: string, open: boolean) {
    if (collapsed.value.includes(key) === !open) return;
    collapsed.value = open ? collapsed.value.filter(k => k !== key) : [...collapsed.value, key].slice(-1000);
    try { localStorage.setItem('bear-cave-collapsed-series', JSON.stringify(collapsed.value)); } catch { /* Browsing still works without storage. */ }
}
function expandAll(open:boolean){
    const keys=new Set(groups.value.map(g=>g.key));
    collapsed.value=open?collapsed.value.filter(k=>!keys.has(k)):[...new Set([...collapsed.value,...keys])].slice(-1000);
    try{localStorage.setItem('bear-cave-collapsed-series',JSON.stringify(collapsed.value));}catch{/* Preferences are optional. */}
}
const groups = computed(() => {
    const map = new Map<string, typeof props.model.jobs>();
    for (const j of props.model.jobs) {
        const key = `${j.source}:${j.series.id}`;
        map.set(key, [...(map.get(key) ?? []), j]);
    }
    return [...map].map(([key, jobs]) => ({
        key, jobs, first: jobs[0], summary: props.model.sourceGroups[key]
    }));
});
</script>

<template>
<section>
  <div class="section-bar">
    <h2>{{model.remainingCount}} queued and recent chapter(s)</h2>
    <div class="inline">
      <span class="source-pill">{{model.paused?'Paused':'Engine running'}}</span>
      <button :disabled="!groups.length" @click="expandAll(false)">Collapse all</button>
      <button :disabled="!groups.length" @click="expandAll(true)">Expand all</button>
      <button :disabled="model.busy||!model.remainingCount" @click="model.deleteDownloads()">Delete entire queue</button>
      <button :disabled="model.busy||!model.counts.failed" @click="model.clearFailed">Clear failed chapters</button>
      <button :disabled="model.busy" @click="model.allControl('pause')">Pause all</button>
      <button class="primary" :disabled="model.busy" @click="model.allControl('resume')">Resume downloads</button>
    </div>
  </div>
  <div v-for="hold in model.holds" :key="hold.source" class="notice">
    <strong>{{hold.source}} · {{hold.count}} need local action</strong>
    <p>{{hold.reason}}</p>
    <button :disabled="model.busy" @click="model.retrySource(hold.source)">Retry affected downloads</button>
  </div>
  <LibraryFilters :model="model"/>
  <p class="hint">Removing queue entries keeps downloaded files. Groups show chapters on this page; group actions apply to the entire series.</p>
  <div v-if="!model.jobs.length" class="empty card">No queue entries match these filters.</div>
  <details v-for="g in groups" :key="g.key" class="series-group card" :open="!collapsed.includes(g.key)" @toggle="expand(g.key,($event.target as HTMLDetailsElement).open)">
    <summary>
      <CoverImage :source="g.first.source" :id="g.first.series.id" :title="g.first.series.title"/>
      <span>
        <strong>{{g.first.series.title}}</strong>
        <small>{{g.first.source}} · {{g.summary?.completed??0}} completed · {{g.summary?.remaining??g.jobs.length}} remaining</small>
        <small v-if="g.summary?.active">Downloading {{g.summary.active}}</small>
        <small>{{collapsed.includes(g.key)?'Expand chapters':'Collapse chapters'}}</small>
        <progress :value="g.summary?.done??g.jobs.reduce((n,j)=>n+j.done,0)" :max="g.summary?.total||g.jobs.reduce((n,j)=>n+j.total,0)||1" aria-label="Series download progress"></progress>
      </span>
    </summary>
    <div v-if="!collapsed.includes(g.key)">
    <div class="inline group-actions">
      <button v-for="action in (['pause','resume','retry','remove'] as const)" :key="action" :disabled="model.busy" @click="model.groupControl(g.first.source,g.first.series.id,action)">{{{pause:'Pause series',resume:'Resume series',retry:'Retry eligible failures',remove:'Remove series from queue'}[action]}}</button>
    </div>
    <JobCard v-for="job in g.jobs" :key="job.id" :job="job" :model="model"/>
    </div>
  </details>
  <LibraryPagination :model="model"/>
</section>
</template>
