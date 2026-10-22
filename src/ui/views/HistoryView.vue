<script setup lang="ts">
import type { DashboardModel } from '../composables/useDashboard';
import JobCard from '../components/JobCard.vue';
import LibraryFilters from '../components/LibraryFilters.vue';
import LibraryPagination from '../components/LibraryPagination.vue';
defineProps<{
    model: DashboardModel;
}>();
</script>

<template>
<section>
  <h2>{{model.counts.completed??0}} completed downloads</h2>
  <p>History tracks the latest attempt for each source/chapter identity. Previous copies remain on disk. Verification checks the saved output. Download again keeps an existing output and creates a separate copy, or requeues a verified missing file.</p>
  <LibraryFilters :model="model"/>
  <div v-if="!model.jobs.length" class="empty card">No completed chapters match these filters.</div>
  <div v-for="job in model.jobs" :key="job.id">
    <h2>
      {{job.series.title}}
      <small>{{job.source}}</small>
    </h2>
    <JobCard :job="job" :model="model"/>
  </div>
  <LibraryPagination :model="model"/>
</section>
</template>
