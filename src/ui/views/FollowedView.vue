<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { languageOptions, languageName } from '../languages';
import type { FollowedSeries } from '../../shared/types';
import type { DashboardModel } from '../composables/useDashboard';
import CoverImage from '../components/CoverImage.vue';
const props = defineProps<{
    model: DashboardModel;
}>();
const drafts = reactive<Record<string, FollowedSeries>>({}), dirty = new Set<string>();
function sync() {
    for (const f of props.model.follows) {
        const old = drafts[f.id];
        drafts[f.id] = dirty.has(f.id) && old ? {
            ...f, language: old.language, group: old.group, enabled: old.enabled, intervalHours: old.intervalHours, autoDownload: old.autoDownload, outputFormat: old.outputFormat
        } : { ...f };
    }
}
watch(() => props.model.follows, sync, { immediate: true });
const records = computed(() => props.model.follows.map(f => drafts[f.id] ?? f));
async function save(f: FollowedSeries) {
    await props.model.saveFollow(f);
    if (!props.model.error) {
        dirty.delete(f.id);
        sync();
    }
}
</script>

<template>
<section>
  <h2>Followed Series</h2>
  <p>Checks run only while Bear Cave is running. After sleep or restart, overdue checks run once and are staggered. Global pause suspends automatic checks and downloads.</p>
  <div v-if="!model.follows.length" class="empty card">Open a series in Discover and choose Follow series.</div>
  <article v-for="follow in records" :key="follow.id" class="card followed-series">
    <div class="section-bar">
      <CoverImage :source="follow.series.source" :id="follow.series.id" :title="follow.series.title"/>
      <div>
        <h2>{{follow.series.title}}</h2>
        <p>{{follow.series.source}} · {{languageName(follow.language)}} · {{follow.missing}} new chapter(s)</p>
        <p v-if="follow.translations">{{follow.translations}} extra translation(s) need confirmation.</p>
      </div>
    </div>
    <p v-if="follow.error" class="notice error">{{follow.error}}</p>
    <p class="hint">Last check: {{follow.lastCheck?new Date(follow.lastCheck).toLocaleString():'Never'}} · Last success: {{follow.lastSuccess?new Date(follow.lastSuccess).toLocaleString():'Never'}} · Next: {{follow.enabled?new Date(follow.nextCheck).toLocaleString():'Manual checks only'}}</p>
    <form class="settings" @submit.prevent="save(follow)" @input="dirty.add(follow.id)" @change="dirty.add(follow.id)">
      <label class="check">
        <input v-model="follow.enabled" type="checkbox">
        Schedule checks while running
      </label>
      <label>
        Check interval (hours)
        <input v-model.number="follow.intervalHours" type="number" min="1" max="168" required>
      </label>
      <label v-if="follow.series.source==='mangadex'">
        Language
        <select v-model="follow.language">
          <option v-for="[code,name] in languageOptions" :key="code" :value="code">{{name}}</option>
        </select>
      </label>
      <label v-if="follow.series.source==='mangadex'">
        Preferred translation group ID (optional)
        <input v-model="follow.group" maxlength="1200">
      </label>
      <label>
        Chapter output
        <select v-model="follow.outputFormat">
          <option value="inherit">Use local Settings</option>
          <option value="cbz">CBZ archive</option>
          <option value="folders">Image folder</option>
        </select>
      </label>
      <label class="check">
        <input v-model="follow.autoDownload" type="checkbox">
        Automatically download missing chapters during scheduled checks (opt in)
      </label>
      <p class="hint">Extra translations never download automatically. Select a preferred group or use the manual confirmation preview.</p>
      <button :disabled="model.busy">Save preferences</button>
    </form>
    <div class="inline">
      <button :disabled="model.busy" @click="model.checkFollow(follow.id)">Check now</button>
      <button class="primary" :disabled="model.busy" @click="model.prepare(undefined,follow.id)">Download missing chapters</button>
      <button :disabled="model.busy" @click="model.view='search';model.openSeries(follow.series)">Open series</button>
      <button :disabled="model.busy" @click="model.removeFollow(follow.id)">Unfollow</button>
    </div>
  </article>
</section>
</template>
