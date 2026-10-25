<script setup lang="ts">
import type { DashboardModel } from '../composables/useDashboard';
defineProps<{
    model: DashboardModel;
}>();
</script>

<template>
<section class="source-grid">
  <article v-for="source in model.sources" :key="source.id" class="card">
    <h2>{{source.name}}</h2>
    <span class="status">{{source.status==='operational'?'Connector enabled; access checked on request':'Download connector unavailable'}}</span>
    <p>{{source.website}}</p>
    <p>{{source.note||'Public downloads. Live availability depends on the source. Local browser sessions are in tray Settings.'}}</p>
    <template v-if="model.holds.find(h=>h.source===source.id)">
      <p class="job-error">{{model.holds.find(h=>h.source===source.id)?.reason}}</p>
      <p>{{model.holds.find(h=>h.source===source.id)?.count}} held chapter(s)</p>
    </template>
    <template v-if="source.status==='operational'">
      <button :disabled="model.busy" @click="model.retrySource(source.id)">Retry affected downloads</button>
      <p class="hint">Also clears a stale hold when no held jobs remain. Complete the normal local site flow first.</p>
      <button :disabled="model.busy||source.status!=='operational'" @click="model.selectedSource=source.id;model.view='search'">Explore {{source.name}}</button>
    </template>
    <a :href="source.website" target="_blank" rel="noopener noreferrer">Browse website</a>
  </article>
</section>
</template>
