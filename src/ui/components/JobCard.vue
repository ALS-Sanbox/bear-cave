<script setup lang="ts">
import { languageName } from '../languages';
import type { Job } from '../../shared/types';
import { statusLabels, type DashboardModel } from '../composables/useDashboard';
defineProps<{
    job: Job;
    model: DashboardModel;
}>();
</script>

<template>
<article class="card job" :data-job-id="job.id">
  <div class="section-bar">
    <div>
      <h3>Ch. {{job.chapter.number}} {{job.chapter.title}}</h3>
      <p>{{languageName(job.chapter.language)}} · {{job.chapter.groups.map(g=>g.name).join(', ')||'No group listed'}}</p>
    </div>
    <span class="status" :class="job.state">{{statusLabels[job.verification?.state??job.state]??job.state}}</span>
  </div>
  <progress :value="job.done" :max="job.total||1" :aria-label="`${job.done} of ${job.total} pages`"></progress>
  <div class="section-bar">
    <small>{{job.done}} / {{job.total}} pages · {{job.format.toUpperCase()}}</small>
    <div class="inline">
      <button v-if="['running','queued'].includes(job.state)" :disabled="model.busy" @click="model.control(job.id,'pause')">Pause</button>
      <button v-if="job.state==='paused'" :disabled="model.busy" @click="model.control(job.id,'resume')">Resume</button>
      <button v-if="['failed','cancelled','action_required'].includes(job.state)" :disabled="model.busy" @click="model.control(job.id,'retry')">Retry</button>
      <button v-if="job.state!=='completed'" :disabled="model.busy" @click="model.deleteDownloads(job.id)">Delete</button>
      <button v-if="job.state==='completed'" :disabled="model.busy" @click="model.verify(job.id)">Verify downloaded file</button>
      <button v-if="job.state==='completed'" :disabled="model.busy" @click="model.downloadAgain(job)">Download again</button>
    </div>
  </div>
  <p v-if="job.error" class="job-error">{{job.error}}</p>
  <p v-if="job.output" class="mono">{{job.output}}</p>
  <small class="muted mono">{{job.chapter.id}}</small>
  <p v-if="job.verification" class="hint">Last checked {{new Date(job.verification.checked).toLocaleString()}}</p>
</article>
</template>
