<script setup lang="ts">
import type { Settings, SourceManifest } from '../../shared/types';
import { applyProfile } from '../../shared/performance';
const props = defineProps<{
    config: Settings;
    sources: SourceManifest[];
}>();
function profile(event: Event) {
    applyProfile(props.config, (event.target as HTMLSelectElement).value as NonNullable<Settings['performanceProfile']>, props.sources);
}
function custom() {
    props.config.performanceProfile = 'custom';
}
</script>

<template>
<fieldset class="performance-settings" @input="custom">
  <legend>Download performance</legend>
  <div class="form-grid">
    <label>
      Performance profile
      <select :value="config.performanceProfile??'custom'" @change="profile" @input.stop>
        <option value="conservative">Conservative</option>
        <option value="balanced">Balanced</option>
        <option value="fast">Fast</option>
        <option value="custom">Custom</option>
      </select>
    </label>
    <label>
      Concurrent chapters
      <input v-model.number="config.globalChapters" type="number" min="1" max="8" required>
    </label>
    <label>
      Images per chapter
      <input v-model.number="config.pageRequests" type="number" min="1" max="16" required>
    </label>
    <label>
      Images across all sources
      <input v-model.number="config.globalPageRequests" type="number" min="1" max="40" required>
    </label>
    <label>
      Retries per request
      <input v-model.number="config.retryAttempts" type="number" min="0" max="6" required>
    </label>
    <label>
      Initial retry delay (ms)
      <input v-model.number="config.retryBaseMs" type="number" min="100" max="30000" required>
    </label>
    <label>
      Connection timeout (ms)
      <input v-model.number="config.connectTimeoutMs" type="number" min="1000" max="60000" required>
    </label>
    <label>
      Request deadline (ms)
      <input v-model.number="config.requestTimeoutMs" type="number" min="5000" max="180000" required>
    </label>
  </div>
  <label class="check">
    <input v-model="config.browserAssisted" type="checkbox">
    Browser-assisted retrieval on this Windows computer
  </label>
  <p class="hint">Source safety limits and Retry-After take priority. Verification, when requested, must be completed on the Windows host. Existing jobs keep their folders and output format.</p>
  <details>
    <summary>Per-source limits and pacing</summary>
    <div v-for="source in sources.filter(s=>s.status==='operational')" :key="source.id" class="card">
      <strong>{{source.name}}</strong>
      <div class="form-grid">
        <label>
          Chapters
          <input v-model.number="config.sourceChapters[source.id]" type="number" min="1" :max="source.limits?.chapters??4" required>
        </label>
        <label>
          Images across chapters
          <input v-model.number="config.sourcePageRequests![source.id]" type="number" min="1" :max="source.limits?.pageRequests??20" required>
        </label>
        <label>
          Image request interval (ms)
          <input v-model.number="config.sourceIntervals![source.id]" type="number" :min="source.limits?.minIntervalMs??0" max="30000" required>
        </label>
      </div>
    </div>
  </details>
</fieldset>
</template>
