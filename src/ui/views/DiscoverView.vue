<script setup lang="ts">
import { computed } from 'vue';
import { languageOptions, languageName } from '../languages';
import { statusLabels, type DashboardModel } from '../composables/useDashboard';
import CoverImage from '../components/CoverImage.vue';
const props = defineProps<{
    model: DashboardModel;
}>();
const following = computed(() => props.model.detail && props.model.follows.some(f => f.series.source === props.model.detail!.source && f.series.id === props.model.detail!.id));
const languages = languageOptions;
</script>

<template>
<section>
  <form class="searchbar card" @submit.prevent="model.search(0)">
    <select v-model="model.selectedSource" aria-label="Source" class="source-select">
      <option v-for="source in model.enabledSources" :key="source.id" :value="source.id">{{source.name}}</option>
    </select>
    <input v-model="model.query" aria-label="Search manga" placeholder="Search a title..." required maxlength="200">
    <button class="primary" :disabled="model.busy">Search</button>
  </form>
  <template v-if="model.detail">
    <button class="subtle back" @click="model.detail=undefined;model.preview=undefined">Back to results</button>
    <div class="series-heading card">
      <CoverImage :source="model.detail.source" :id="model.detail.id" :title="model.detail.title"/>
      <div>
        <p class="eyebrow">{{model.detail.source}}</p>
        <h2>{{model.detail.title}}</h2>
        <p class="description">{{model.detail.description||'No description available.'}}</p>
        <div class="inline">
          <button :disabled="model.busy" @click="model.downloadCover">Download cover art</button>
          <button :disabled="model.busy" @click="model.followSeries">{{following?'Unfollow series':'Follow series'}}</button>
        </div>
      </div>
    </div>
    <form v-if="model.detail.source==='mangadex'" class="filters card" @submit.prevent="model.perform(()=>model.loadChapters(0))">
      <label>
        Language
        <select v-model="model.language">
          <option v-for="[code,name] in languages" :key="code" :value="code">{{name}}</option>
          <option v-if="!languages.some(([code])=>code===model.language)" :value="model.language">{{languageName(model.language)}}</option>
        </select>
      </label>
      <label>
        Translation group
        <select v-model="model.group">
          <option value="">All groups (confirm extra translations)</option>
          <option v-if="model.group&&!model.knownGroups.some(g=>g.id===model.group)" :value="model.group">Saved preferred group</option>
          <option v-for="g in model.knownGroups" :key="g.id" :value="g.id">{{g.name}}</option>
        </select>
      </label>
      <button :disabled="model.busy">Apply filters</button>
      <p class="hint">Group choices appear as chapter pages are loaded. Preferences are remembered per source.</p>
    </form>
    <p v-else class="notice">English public chapters. This source does not support language or translation-group selection.</p>
    <div v-if="model.chapters" class="card chapters">
      <div class="section-bar">
        <h2>{{model.chapters.total.toLocaleString()}} matching chapters</h2>
        <div class="inline">
          <button :disabled="!model.selected.length||model.busy" @click="model.prepare(model.selected)">Download selected ({{model.selected.length}})</button>
          <button class="primary" :disabled="!model.chapters.total||model.busy" @click="model.prepare()">Preview all matching</button>
        </div>
      </div>
      <div v-if="!model.chapters.items.length" class="empty">No downloadable chapters match these filters.</div>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select this page" :checked="model.selected.length===model.chapters.items.length" @change="model.selected=($event.target as HTMLInputElement).checked?model.chapters.items.map(c=>c.id):[]">
              </th>
              <th>Chapter</th>
              <th>Translation</th>
              <th>Local status</th>
              <th>Pages</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="chapter in model.chapters.items" :key="chapter.id">
              <td>
                <input v-model="model.selected" type="checkbox" :value="chapter.id" :aria-label="`Select chapter ${chapter.number}`">
              </td>
              <td>
                <strong>{{chapter.volume?`Vol. ${chapter.volume} · `:''}}Ch. {{chapter.number}}</strong>
                <span>{{chapter.title}}</span>
                <small class="mono">{{chapter.id}}</small>
              </td>
              <td>
                {{languageName(chapter.language)}}
                <span>{{chapter.groups.map(g=>g.name).join(', ')||'No group listed'}}</span>
              </td>
              <td>{{statusLabels[chapter.localState??'not_downloaded']}}</td>
              <td>{{chapter.pages??'On resolution'}}</td>
              <td>
                <button :disabled="model.busy" @click="model.prepare([chapter.id])">Download</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <button :disabled="model.busy||!model.chapters.offset" @click="model.perform(()=>model.loadChapters(Math.max(0,model.chapters!.offset-model.chapters!.limit)))">Previous</button>
        <span>{{model.chapters.offset+1}}–{{Math.min(model.chapters.offset+model.chapters.limit,model.chapters.total)}} of {{model.chapters.total}}</span>
        <button :disabled="model.busy||model.chapters.offset+model.chapters.limit>=model.chapters.total||model.chapters.offset+model.chapters.limit*2>10000" @click="model.perform(()=>model.loadChapters(model.chapters!.offset+model.chapters!.limit))">Next</button>
      </div>
    </div>
  </template>
  <template v-else-if="model.results">
    <h2>Search results · {{model.results.total.toLocaleString()}} titles</h2>
    <div v-if="!model.results.items.length" class="empty card">No matching titles.</div>
    <div class="result-grid">
      <button v-for="series in model.results.items" :key="series.id" class="result card" :disabled="model.busy" @click="model.openSeries(series)">
        <CoverImage :source="series.source" :id="series.id" :title="series.title"/>
        <div>
          <p class="eyebrow">{{series.source}}</p>
          <h2>{{series.title}}</h2>
          <p>{{series.description.slice(0,170)||'Explore this series and choose chapters.'}}</p>
          <span class="text-link">Explore chapters</span>
        </div>
      </button>
    </div>
    <div class="pagination">
      <button :disabled="model.busy||!model.results.offset" @click="model.search(Math.max(0,model.results.offset-model.results.limit))">Previous</button>
      <span>Page {{Math.floor(model.results.offset/model.results.limit)+1}}</span>
      <button :disabled="model.busy||model.results.offset+model.results.limit>=model.results.total||model.results.offset+model.results.limit*2>10000" @click="model.search(model.results.offset+model.results.limit)">Next</button>
    </div>
  </template>
  <div v-else class="empty card">
    <h2>Good stories start here.</h2>
    <p>Choose a source and search for a series.</p>
  </div>
</section>
</template>
