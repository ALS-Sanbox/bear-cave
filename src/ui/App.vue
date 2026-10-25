<script setup lang="ts">
import { reactive } from 'vue';
import { useDashboard } from './composables/useDashboard';
import LocalSettings from './views/LocalSettings.vue';
import DiscoverView from './views/DiscoverView.vue';
import QueueView from './views/QueueView.vue';
import HistoryView from './views/HistoryView.vue';
import SourcesView from './views/SourcesView.vue';
import FollowedView from './views/FollowedView.vue';
import DownloadDialog from './components/DownloadDialog.vue';
import logoFull from './assets/logo-full.png';
const local = Boolean(window.bearCaveLocal), d = local ? undefined : reactive(useDashboard());
const tabs = ['search', 'queue', 'history', 'sources', 'followed'] as const;
const labels = {
    search: 'Discover', queue: 'Download queue', history: 'History', sources: 'Sources', followed: 'Followed Series'
};
const headings = {
    search: 'Find your next chapter.', queue: 'Make room for offline.', history: 'Ready when you are.', sources: 'Connected to the stories.', followed: 'Keep up with your stories.'
};
</script>

<template>
<div class="layout" :class="{solo:local||!d?.authenticated}">
  <aside v-if="d?.authenticated" class="sidebar">
    <div class="brand">
      <img :src="logoFull" class="brand-logo" alt="Bear Cave">
      <small>Your next chapter.</small>
    </div>
    <nav aria-label="Main navigation">
      <button v-for="tab in tabs" :key="tab" :class="{current:d.view===tab}" @click="d.view=tab;d.error='';d.message=''">
        {{labels[tab]}}
        <span v-if="tab==='queue'" class="badge">{{d.remainingCount}}</span>
      </button>
    </nav>
    <div class="sidebar-bottom">
      <span class="dot"></span>
      {{d.paused?'Downloads paused':d.activeCount+' active chapters'}}
      <p>This dashboard controls your Windows instance.</p>
      <button class="subtle" @click="d.logout">Log out</button>
    </div>
  </aside>
  <main>
    <LocalSettings v-if="local"/>
    <template v-else-if="d">
      <div v-if="d.error" class="notice error" role="alert">
        {{d.error}}
        <button aria-label="Dismiss error" @click="d.error=''">Close</button>
      </div>
      <div v-if="d.message" class="notice success" role="status">{{d.message}}</div>
      <div v-if="d.busy" class="working" role="status">Working...</div>
      <section v-if="!d.authenticated" class="login card">
        <img :src="logoFull" class="login-logo" alt="Bear Cave">
        <p class="eyebrow">WELCOME TO YOUR CAVE</p>
        <h1>A little offline reading.</h1>
        <p>Sign in to discover manga and manage downloads on your Windows computer.</p>
        <div v-if="d.setupRequired" class="notice">Open Settings from the local Bear Cave tray menu to create the administrator password.</div>
        <p class="hint">Use the administrator password saved in Bear Cave tray Settings. If forgotten, set a new administrator password there and Save.</p>
        <form @submit.prevent="d.login">
          <input type="hidden" name="username" autocomplete="username" value="administrator">
          <label>
            Administrator password
            <input v-model="d.password" type="password" name="password" autocomplete="current-password" required maxlength="256">
          </label>
          <button class="primary" :disabled="d.busy||d.setupRequired">Sign in</button>
        </form>
      </section>
      <template v-else>
        <header>
          <p class="eyebrow">YOUR PERSONAL MANGA SHELF</p>
          <h1>{{headings[d.view]}}</h1>
        </header>
        <DiscoverView v-if="d.view==='search'" :model="d"/>
        <QueueView v-else-if="d.view==='queue'" :model="d"/>
        <HistoryView v-else-if="d.view==='history'" :model="d"/>
        <SourcesView v-else-if="d.view==='sources'" :model="d"/>
        <FollowedView v-else :model="d"/>
      </template>
    </template>
    <footer>
      BEAR CAVE
      <span>Made for a slower kind of reading.</span>
    </footer>
  </main>
  <DownloadDialog v-if="d" :model="d" @ready="d.downloadDialog=$event"/>
</div>
</template>
