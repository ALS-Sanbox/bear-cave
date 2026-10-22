<script setup lang="ts">
import { statusLabels, type DashboardModel } from '../composables/useDashboard';
defineProps<{
    model: DashboardModel;
}>();
</script>

<template>
<form class="filters card" @submit.prevent="model.applyLibraryFilters">
  <label>
    Search series
    <input v-model="model.librarySearch" maxlength="200">
  </label>
  <label>
    Source
    <select v-model="model.sourceFilter">
      <option value="">All sources</option>
      <option v-for="s in model.sources" :key="s.id" :value="s.id">{{s.name}}</option>
    </select>
  </label>
  <label>
    Status
    <select v-model="model.statusFilter">
      <option value="">All statuses</option>
      <option v-for="state in (model.view==='history'?['completed','verified','missing','damaged','inaccessible','unverified']:['queued','running','paused','failed','action_required','cancelled'])" :key="state" :value="state">{{statusLabels[state]??state}}</option>
    </select>
  </label>
  <button :disabled="model.busy">Apply filters</button>
</form>
</template>
