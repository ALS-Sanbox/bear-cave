<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Settings, SourceManifest } from '../../shared/types';
const local = window.bearCaveLocal!;
const config = ref<Settings>(), adminConfigured = ref(false), password = ref(''), message = ref(''), error = ref(''), busy = ref(false), sources = ref<SourceManifest[]>([]);
const enabledSources = computed(() => sources.value.filter(s => s.status === 'operational'));
const mangaAccount = ref<{
    connected: boolean;
    username?: string;
    message?: string;
}>({ connected: false }), mangaCredentials = ref({
    clientId: '', clientSecret: '', username: '', password: ''
}), mangaFeedback = ref(''), mangaSigningIn = ref(false), mangaLoginFailed = ref(false);
async function perform(fn: () => Promise<unknown>) {
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
async function connectManga() {
    await perform(async () => {
        mangaFeedback.value = 'Signing in to MangaDex...';
        mangaSigningIn.value = true;
        mangaLoginFailed.value = false;
        try {
            const r = await local!.mangaConnect({ ...mangaCredentials.value });
            if (!r.ok)
                throw Error(r.error);
            mangaAccount.value = r.status!;
            mangaFeedback.value = `MangaDex sign-in succeeded. Signed in as ${r.status!.username ?? 'your account'}. Saved securely on this computer.`;
        }
        catch (e) {
            mangaLoginFailed.value = true;
            mangaFeedback.value = (e as Error).message;
        }
        finally {
            mangaSigningIn.value = false;
            mangaCredentials.value.password = '';
            mangaCredentials.value.clientSecret = '';
        }
    });
}
async function disconnectManga() {
    await perform(async () => {
        const r = await local!.mangaDisconnect();
        if (!r.ok)
            throw Error(r.error);
        mangaAccount.value = r.status!;
        message.value = 'MangaDex account removed from this computer.';
    });
}
async function save() {
    await perform(async () => {
        const r = await local!.save(JSON.parse(JSON.stringify(config.value)), password.value || undefined);
        password.value = '';
        if (!r.ok)
            throw Error(r.error);
        adminConfigured.value = true;
        message.value = r.restartRequired ? 'Saved. Quit and reopen Bear Cave to apply the new port.' : 'Saved. Password changes sign out dashboard sessions.';
    });
}
async function pick() {
    await perform(async () => {
        const folder = await local!.pickFolder();
        if (folder)
            config.value!.downloadRoot = folder;
    });
}
async function openSourceSession(id: string) {
    await perform(async () => {
        const r = await local!.sourceSession(id);
        if (!r.ok)
            throw Error('The local source window could not be opened.');
        message.value = 'Local source window opened. Sign in there using the normal website flow.';
    });
}
const staging = ref<Awaited<ReturnType<typeof local.stagingScan>>>();
async function scanStaging() {
    await perform(async () => {
        staging.value = await local.stagingScan();
    });
}
async function cleanStaging() {
    if (!staging.value)
        return;
    await perform(async () => {
        const r = await local.stagingClean(staging.value!.token);
        message.value = `Removed ${r.removed} abandoned staging entry(s).`;
        staging.value = await local.stagingScan();
    });
}
onMounted(() => {
    void perform(async () => {
        const data = await local.read();
        config.value = data.settings;
        sources.value = data.sources ?? [];
        mangaAccount.value = data.mangaAccount ?? { connected: false };
        adminConfigured.value = data.adminConfigured;
        for (const s of enabledSources.value)
            config.value.sourceChapters[s.id] ??= s.recommended.chapters;
    });
});
</script>

<template>
<div v-if="error" class="notice error" role="alert">{{error}}</div>
<div v-if="message" class="notice success" role="status">{{message}}</div>
<div v-if="busy" class="working" role="status">Working...</div>
<header>
  <p class="eyebrow">ON THIS COMPUTER</p>
  <h1>Local settings</h1>
  <p>Closing this window keeps Bear Cave in the tray. Use Quit to stop the application.</p>
</header>
<form v-if="config" class="settings card" @submit.prevent="save">
  <h2>Downloads</h2>
  <label>
    Download root
    <div class="inline">
      <input v-model="config.downloadRoot" required maxlength="220">
      <button type="button" @click="pick">Choose folder</button>
    </div>
  </label>
  <label>
    Chapter output
    <select v-model="config.format">
      <option value="cbz">One CBZ per chapter</option>
      <option value="folders">Chapter image folders</option>
    </select>
  </label>
  <div class="form-grid">
    <label>
      Saved cover format
      <select v-model="config.coverFormat">
        <option value="png">PNG (coverart.png)</option>
        <option value="jpg">JPG (coverart.jpg)</option>
      </select>
    </label>
    <label>
      Active chapters · global
      <input v-model.number="config.globalChapters" type="number" min="1" max="8" required>
    </label>
    <label v-for="s in enabledSources" :key="s.id">
      Active chapters ·
      {{ s.name }}
      <input v-model.number="config.sourceChapters[s.id]" type="number" min="1" max="4" required>
    </label>
  </div>
  <label>
    Simultaneous page requests
    <input v-model.number="config.pageRequests" type="number" min="1" max="3" required>
  </label>
  <p class="hint">Source limits count active chapter jobs. Request pacing and Retry-After apply separately. Existing jobs keep their original folder and output format.</p>
  <h2>Application</h2>
  <label class="check">
    <input v-model="config.startWithWindows" type="checkbox">
    Start with Windows
  </label>
  <label>
    Dashboard port (restart required)
    <input v-model.number="config.port" type="number" min="1024" max="65535" required>
  </label>
  <h2>Remote access</h2>
  <label>
    Public HTTPS URL (optional)
    <input v-model="config.publicUrl" placeholder="https://bearcave.lionhosting.net">
  </label>
  <label class="check">
    <input v-model="config.trustTunnel" type="checkbox">
    Trust an explicitly configured local Cloudflare Tunnel
  </label>
  <p class="hint">The server binds to 127.0.0.1. Configure the tunnel separately; see docs/remote-access.md.</p>
  <h2>Administrator</h2>
  <label>
    {{ adminConfigured?'New password (leave empty to keep current)':'Set administrator password' }}
    <input v-model="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" :required="!adminConfigured">
  </label>
  <p class="hint">At least 12 characters. Saved as a scrypt hash; never returned to the dashboard.</p>
  <button class="primary" :disabled="busy">Save settings</button>
</form>
<section class="card account-settings">
  <h2>MangaDex account</h2>
  <button type="button" :disabled="busy" @click="openSourceSession('mangadex')">Open MangaDex</button>
  <p class="hint">Try website sign-in in its local window. Browser sign-in is separate from the optional personal-client API login below.</p>
  <p>Optional for public downloads. Register an approved personal API client in your MangaDex account settings. Only its owner can sign in.</p>
  <p v-if="mangaAccount.connected" class="notice success">Signed in as {{ mangaAccount.username }}. Tokens and the client secret are stored with Windows secure storage.</p>
  <p v-else-if="mangaAccount.message" class="notice">{{ mangaAccount.message }}</p>
  <div v-if="mangaFeedback" class="notice" :class="mangaLoginFailed?'error':'success'" :role="mangaLoginFailed?'alert':'status'">{{ mangaFeedback }}</div>
  <form class="settings" @submit.prevent="connectManga">
    <label>
      Personal client ID
      <input v-model="mangaCredentials.clientId" placeholder="personal-client-…" required autocomplete="off">
    </label>
    <label>
      Client secret
      <input v-model="mangaCredentials.clientSecret" type="password" required autocomplete="off">
    </label>
    <label>
      MangaDex username
      <input v-model="mangaCredentials.username" required autocomplete="off">
    </label>
    <label>
      MangaDex password
      <input v-model="mangaCredentials.password" type="password" required autocomplete="off">
    </label>
    <p class="hint">Your MangaDex password is used only to sign in and is never saved. This is separate from the dashboard administrator password.</p>
    <div class="inline">
      <button class="primary" :disabled="busy">{{ mangaSigningIn?'Signing in...':'Sign in to MangaDex' }}</button>
      <button type="button" :disabled="busy" @click="disconnectManga">Remove saved account</button>
    </div>
  </form>
</section>
<section class="card account-settings">
  <h2>Local source sessions</h2>
  <p>If a source requests human interaction, open its isolated local window, complete the normal site flow, then retry your search or job. Site restrictions may still prevent access.</p>
  <div class="inline">
    <button v-for="s in enabledSources.filter(s=>s.capabilities.includes('local-session'))" :key="s.id" :disabled="busy" @click="openSourceSession(s.id)">Open {{ s.name }}</button>
  </div>
</section>
<section class="card">
  <h2>Staging maintenance</h2>
  <p>Scan abandoned recovery data in Bear Cave-owned series folders. Active, queued, paused, followed-series recovery and completed output are excluded. Saved chapters are never deleted here.</p>
  <button :disabled="busy" @click="scanStaging">Scan staging storage</button>
  <template v-if="staging">
    <p>{{staging.entries.length}} eligible entry(s), approximately {{(staging.bytes/1048576).toFixed(1)}} MiB reclaimable.</p>
    <ul>
      <li v-for="entry in staging.entries" :key="entry.chapter">{{entry.title}} — {{(entry.bytes/1048576).toFixed(1)}} MiB</li>
    </ul>
    <button :disabled="busy||!staging.entries.length" @click="cleanStaging">Review and clean abandoned staging</button>
    <p class="hint">A local confirmation is required before any recoverable files are deleted. Unrecognized or inaccessible folders are left alone.</p>
  </template>
</section>
</template>
