<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import type { Settings, Series, Chapter, Job, SourceManifest, PageResult } from '../shared/types';
import logoFull from './assets/logo-full.png';
import logoMark from './assets/logo-mark.png';
const local = window.bearCaveLocal;
const mangaAccount=ref<{connected:boolean;username?:string;message?:string}>({connected:false});
const mangaCredentials=ref({clientId:'',clientSecret:'',username:'',password:''});
async function connectManga(){await perform(async()=>{try{const r=await local!.mangaConnect({...mangaCredentials.value});if(!r.ok)throw Error(r.error);mangaAccount.value=r.status!;message.value='MangaDex account verified and saved using Windows secure storage.';}finally{mangaCredentials.value.password='';mangaCredentials.value.clientSecret='';}});}
async function disconnectManga(){await perform(async()=>{const r=await local!.mangaDisconnect();if(!r.ok)throw Error(r.error);mangaAccount.value=r.status!;message.value='MangaDex account removed from this computer.';});}
const config=ref<Settings>(), adminConfigured=ref(false), password=ref(''), message=ref(''), error=ref(''), busy=ref(false);
const authenticated=ref(false), setupRequired=ref(false), csrf=ref(''), view=ref<'search'|'queue'|'history'|'sources'>('search');
const query=ref(''), results=ref<PageResult<Series>>(), detail=ref<Series>(), chapters=ref<PageResult<Chapter>>(), language=ref('en'), group=ref('');
const selected=ref<string[]>([]), knownGroups=ref<{id:string;name:string}[]>([]), jobs=ref<Job[]>([]), paused=ref(false), sources=ref<SourceManifest[]>([]);
const selectedSource=ref('mangadex'), enabledSources=computed(()=>sources.value.filter(s=>s.status==='operational'));
const preview=ref<{ token:string;count:number;multipleTranslations:number }>(), confirmTranslations=ref(false);
const downloadDialog=ref<HTMLDialogElement>(), previewLoading=ref(false), previewError=ref(''), previewHeading=ref<HTMLElement>();
let previewController:AbortController|undefined;
const visibleJobs=computed(()=>jobs.value.filter(j=>view.value==='history' ? j.state==='completed' : j.state!=='completed'));
const activeCount=computed(()=>jobs.value.filter(j=>j.state==='running').length);
let timer:ReturnType<typeof setInterval>|undefined;
async function api<T>(url:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  const response=await fetch(`/api/${url}`,{ method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf.value},body:body===undefined?undefined:JSON.stringify(body),signal });
  const data=await response.json(); if(!response.ok) { if(response.status===401) authenticated.value=false; throw Error(data.error??'Request failed.'); } return data as T;
}
async function perform(fn:()=>Promise<unknown>) { busy.value=true; error.value=''; message.value=''; try { await fn(); } catch(e) { error.value=(e as Error).message; } finally { busy.value=false; } }
async function refresh() { if(!authenticated.value) return; const data=await api<{jobs:Job[];paused:boolean}>('jobs'); jobs.value=data.jobs; paused.value=data.paused; }
async function login() { await perform(async()=> { const data=await api<{csrf:string}>('login',{password:password.value}); password.value=''; csrf.value=data.csrf; authenticated.value=true; sources.value=await api('sources'); await refresh(); }); }
async function logout() { await perform(async()=> { await api('logout',{}); authenticated.value=false; password.value=''; jobs.value=[]; detail.value=undefined; results.value=undefined; preview.value=undefined; }); }
async function search(offset=0) { await perform(async()=> { results.value=await api(`search?source=${encodeURIComponent(selectedSource.value)}&q=${encodeURIComponent(query.value)}&offset=${offset}`); detail.value=undefined; }); }
async function loadChapters(offset=0) {
  if(!detail.value) return;
  chapters.value=await api(`chapters?source=${detail.value.source}&id=${detail.value.id}&language=${encodeURIComponent(language.value)}&group=${encodeURIComponent(group.value)}&offset=${offset}`);
  const merged=new Map(knownGroups.value.map(g=>[g.id,g])); chapters.value!.items.flatMap(c=>c.groups).forEach(g=>merged.set(g.id,g)); knownGroups.value=[...merged.values()]; selected.value=[]; preview.value=undefined;
}
async function openSeries(series:Series) { await perform(async()=> { detail.value=await api(`series?source=${series.source}&id=${series.id}`); group.value=''; knownGroups.value=[]; chapters.value=undefined; await loadChapters(); }); }
async function prepare(ids?:string[]) {
  if(busy.value||!detail.value)return;
  const controller=new AbortController();previewController=controller;
  preview.value=undefined;previewError.value='';confirmTranslations.value=false;previewLoading.value=true;busy.value=true;error.value='';message.value='';
  downloadDialog.value?.showModal();
  try{preview.value=await api('preview',{source:detail.value.source,seriesId:detail.value.id,language:language.value,group:group.value||undefined,ids},controller.signal);await nextTick();previewHeading.value?.focus();}
  catch(e){if(!controller.signal.aborted)previewError.value=(e as Error).message;}
  finally{if(previewController===controller){previewController=undefined;previewLoading.value=false;busy.value=false;}}
}
function cancelPreview(event?:Event){
  if(busy.value&&!previewLoading.value){event?.preventDefault();return;}
  previewController?.abort();previewController=undefined;previewLoading.value=false;busy.value=false;preview.value=undefined;previewError.value='';downloadDialog.value?.close();
}
async function enqueue() {
  if(!preview.value||busy.value)return;
  busy.value=true;previewError.value='';
  try{const r=await api<{added:number;duplicates:number}>('enqueue',{token:preview.value.token,confirmTranslations:confirmTranslations.value});preview.value=undefined;downloadDialog.value?.close();view.value='queue';message.value=`Queued ${r.added} chapter(s); skipped ${r.duplicates} existing job(s).`;await nextTick();window.scrollTo({top:0});await refresh();if(paused.value)message.value+=' Downloads are paused. Select Resume downloads to start.';}
  catch(e){if(downloadDialog.value?.open)previewError.value=(e as Error).message;else error.value=(e as Error).message;}
  finally{busy.value=false;}
}
async function control(id:string,action:string) { await perform(async()=> { await api(`jobs/${id}`,{action}); await refresh(); }); }
async function allControl(action:string) { await perform(async()=> { await api('queue',{action}); await refresh(); }); }
async function save() { await perform(async()=> { const r=await local!.save(JSON.parse(JSON.stringify(config.value)),password.value||undefined); password.value=''; if(!r.ok) throw Error(r.error); adminConfigured.value=true; message.value=r.restartRequired?'Saved. Quit and reopen Bear Cave to apply the new port.':'Saved. Password changes sign out dashboard sessions.'; }); }
async function pick() { await perform(async()=> { const folder=await local!.pickFolder(); if(folder) config.value!.downloadRoot=folder; }); }
onMounted(()=> { void perform(async()=> { if(local) { const data=await local.read(); config.value=data.settings; sources.value=data.sources??[]; mangaAccount.value=data.mangaAccount??{connected:false}; for(const s of enabledSources.value)config.value.sourceChapters[s.id]??=s.recommended.chapters; adminConfigured.value=data.adminConfigured; return; } const s=await api<{authenticated:boolean;csrf?:string;setupRequired:boolean}>('session'); authenticated.value=s.authenticated; csrf.value=s.csrf??''; setupRequired.value=s.setupRequired; if(authenticated.value) { sources.value=await api('sources'); await refresh(); } timer=setInterval(()=> { void refresh().catch(e=>{ error.value=(e as Error).message; }); },2000); }); });
onUnmounted(()=> { if(timer) clearInterval(timer);previewController?.abort(); });
</script>

<template>
  <div class="layout" :class="{solo:local||!authenticated}">
    <aside v-if="!local && authenticated" class="sidebar">
      <div class="brand"><img :src="logoFull" class="brand-logo" alt="Bear Cave"><small>Your next chapter.</small></div>
      <nav aria-label="Main navigation"><button v-for="tab in (['search','queue','history','sources'] as const)" :key="tab" :class="{current:view===tab}" @click="view=tab; error='';message=''">{{ {search:'Discover',queue:'Download queue',history:'History',sources:'Sources'}[tab] }} <span v-if="tab==='queue'" class="badge">{{ jobs.filter(j=>j.state!=='completed').length }}</span></button></nav>
      <div class="sidebar-bottom"><span class="dot"></span> {{ paused?'Downloads paused':`${activeCount} active chapter${activeCount===1?'':'s'}` }}<p>This dashboard controls your Windows instance.</p><button class="subtle" @click="logout">Log out</button></div>
    </aside>
    <main>
      <div v-if="error" class="notice error" role="alert">{{ error }} <button aria-label="Dismiss error" @click="error=''">×</button></div>
      <div v-if="message" class="notice success" role="status">{{ message }}</div>
      <div v-if="busy" class="working" role="status">Working…</div>
      <template v-if="local">
        <header><p class="eyebrow">ON THIS COMPUTER</p><h1>Local settings</h1><p>Closing this window keeps Bear Cave in the tray. Use Quit to stop the application.</p></header>
        <form v-if="config" class="settings card" @submit.prevent="save">
          <h2>Downloads</h2><label>Download root<div class="inline"><input v-model="config.downloadRoot" required maxlength="220"><button type="button" @click="pick">Choose folder</button></div></label>
          <label>Chapter output<select v-model="config.format"><option value="cbz">One CBZ per chapter</option><option value="folders">Chapter image folders</option></select></label>
          <div class="form-grid"><label>Active chapters · global<input v-model.number="config.globalChapters" type="number" min="1" max="8" required></label><label v-for="s in enabledSources" :key="s.id">Active chapters · {{ s.name }}<input v-model.number="config.sourceChapters[s.id]" type="number" min="1" max="4" required></label></div>
          <label>Simultaneous page requests<input v-model.number="config.pageRequests" type="number" min="1" max="3" required></label><p class="hint">Source limits count active chapter jobs. Request pacing and Retry-After apply separately. Existing jobs keep their original folder and output format.</p>
          <h2>Application</h2><label class="check"><input v-model="config.startWithWindows" type="checkbox"> Start with Windows</label><label>Dashboard port (restart required)<input v-model.number="config.port" type="number" min="1024" max="65535" required></label>
          <h2>Remote access</h2><label>Public HTTPS URL (optional)<input v-model="config.publicUrl" placeholder="https://bearcave.lionhosting.net"></label><label class="check"><input v-model="config.trustTunnel" type="checkbox"> Trust an explicitly configured local Cloudflare Tunnel</label><p class="hint">The server binds to 127.0.0.1. Configure the tunnel separately; see docs/remote-access.md.</p>
          <h2>Administrator</h2><label>{{ adminConfigured?'New password (leave empty to keep current)':'Set administrator password' }}<input v-model="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" :required="!adminConfigured"></label><p class="hint">At least 12 characters. Saved as a scrypt hash; never returned to the dashboard.</p>
          <button class="primary" :disabled="busy">Save settings</button>
        </form>
        <section class="card account-settings">
          <h2>MangaDex account</h2><p>Optional for public downloads. Register an approved personal API client in your MangaDex account settings. Only its owner can sign in.</p>
          <p v-if="mangaAccount.connected" class="notice success">Signed in as {{ mangaAccount.username }}. Tokens and the client secret are stored with Windows secure storage.</p><p v-else-if="mangaAccount.message" class="notice">{{ mangaAccount.message }}</p>
          <form class="settings" @submit.prevent="connectManga"><label>Personal client ID<input v-model="mangaCredentials.clientId" placeholder="personal-client-…" required autocomplete="off"></label><label>Client secret<input v-model="mangaCredentials.clientSecret" type="password" required autocomplete="off"></label><label>MangaDex username<input v-model="mangaCredentials.username" required autocomplete="off"></label><label>MangaDex password<input v-model="mangaCredentials.password" type="password" required autocomplete="off"></label><p class="hint">Your MangaDex password is used only to sign in and is never saved. This is separate from the dashboard administrator password.</p><div class="inline"><button class="primary" :disabled="busy">Sign in to MangaDex</button><button type="button" :disabled="busy" @click="disconnectManga">Remove saved account</button></div></form>
        </section>
        <section class="card account-settings"><h2>Local source sessions</h2><p>If a source requests human interaction, open its isolated local window, complete the normal site flow, then retry your search or job. Site restrictions may still prevent access.</p><div class="inline"><button v-for="s in enabledSources.filter(s=>s.capabilities.includes('local-session'))" :key="s.id" :disabled="busy" @click="perform(()=>local!.sourceSession(s.id))">Open {{ s.name }}</button></div></section>
      </template>
      <section v-else-if="!authenticated" class="login card">
        <img :src="logoFull" class="login-logo" alt="Bear Cave"><p class="eyebrow">WELCOME TO YOUR CAVE</p><h1>A little offline reading.</h1><p>Sign in to discover manga and manage downloads on your Windows computer.</p>
        <div v-if="setupRequired" class="notice">Open Settings from the local Bear Cave tray menu to create the administrator password.</div>
        <form @submit.prevent="login"><label>Administrator password<input v-model="password" type="password" autocomplete="current-password" required maxlength="256"></label><button class="primary" :disabled="busy||setupRequired">Sign in</button></form>
      </section>
      <template v-else>
        <header><p class="eyebrow">YOUR PERSONAL MANGA SHELF</p><h1>{{ {search:'Find your next chapter.',queue:'Make room for offline.',history:'Ready when you are.',sources:'Connected to the stories.'}[view] }}</h1><p>{{ {search:'Choose a source and translation, then bring it home.',queue:'Real progress from the download engine on your Windows computer.',history:'Validated chapters, saved to your download folder.',sources:'Six connectors enabled. Live availability and access requirements vary by source.'}[view] }}</p></header>
        <section v-if="view==='search'">
          <form class="searchbar card" @submit.prevent="search(0)"><select v-model="selectedSource" aria-label="Source" class="source-select" @change="results=undefined;detail=undefined;preview=undefined"><option v-for="s in enabledSources" :key="s.id" :value="s.id">{{ s.name }}</option></select><input v-model="query" aria-label="Search manga" placeholder="Search a title…" required maxlength="200"><button class="primary" :disabled="busy">Search</button></form>
          <template v-if="detail">
            <button class="subtle back" @click="detail=undefined;preview=undefined">← Back to results</button>
            <div class="series-heading card"><img :src="logoMark" class="book-mark large" alt=""><div><p class="eyebrow">{{ detail.source }}</p><h2>{{ detail.title }}</h2><p class="description">{{ detail.description||'No description available.' }}</p></div></div>
            <div class="filters card"><label>Language<input v-model="language" list="languages" placeholder="en"><datalist id="languages"><option v-for="l in ['en','ja','es','es-la','pt-br','fr','de','it','ru','zh','ko','id','vi']" :key="l" :value="l" /></datalist></label><label>Translation group<select v-model="group"><option value="">All groups · translations kept distinct</option><option v-for="g in knownGroups" :key="g.id" :value="g.id">{{ g.name }}</option></select></label><button :disabled="busy" @click="perform(()=>loadChapters(0))">Apply filters</button><p class="hint">Groups appear as chapter pages are loaded. Every row keeps its source chapter ID. Language codes follow MangaDex.</p></div>
            <div v-if="chapters" class="card chapters">
              <div class="section-bar"><h2>{{ chapters.total.toLocaleString() }} matching chapters</h2><div class="inline"><button :disabled="!selected.length||busy" @click="prepare(selected)">Download selected ({{ selected.length }})</button><button class="primary" :disabled="!chapters.total||busy" @click="prepare()">Preview all matching</button></div></div>
              <div v-if="!chapters.items.length" class="empty">No downloadable chapters match these filters. Try a different language or group. External and unavailable chapters are excluded.</div>
              <div class="table-scroll" v-else><table><thead><tr><th><input type="checkbox" aria-label="Select this page" :checked="selected.length===chapters.items.length" @change="selected=($event.target as HTMLInputElement).checked?chapters.items.map(c=>c.id):[]"></th><th>Chapter</th><th>Translation</th><th>Pages</th><th></th></tr></thead><tbody><tr v-for="c in chapters.items" :key="c.id"><td><input v-model="selected" type="checkbox" :value="c.id" :aria-label="`Select chapter ${c.number}`"></td><td><strong>{{ c.volume?`Vol. ${c.volume} · `:'' }}Ch. {{ c.number }}</strong><span>{{ c.title }}</span><small class="mono" :title="c.id">{{ c.id }}</small></td><td>{{ c.language }}<span>{{ c.groups.map(g=>g.name).join(', ')||'No group listed' }}</span></td><td>{{ c.pages ?? "On resolution" }}</td><td><button :disabled="busy" @click="prepare([c.id])">Download</button></td></tr></tbody></table></div>
              <div class="pagination"><button :disabled="busy||chapters.offset===0" @click="perform(()=>loadChapters(Math.max(0,chapters!.offset-chapters!.limit)))">Previous</button><span>{{ chapters.offset+1 }}–{{ Math.min(chapters.offset+chapters.limit,chapters.total) }} of {{ chapters.total }}</span><button :disabled="busy||chapters.offset+chapters.limit>=chapters.total||chapters.offset+chapters.limit*2>10000" @click="perform(()=>loadChapters(chapters!.offset+chapters!.limit))">Next</button></div>
            </div>
          </template>
          <template v-else-if="results"><div class="section-bar"><h2>Search results</h2><span class="muted">{{ results.total.toLocaleString() }} titles</span></div><div v-if="!results.items.length" class="empty card">No titles found. Try a shorter title or alternate spelling.</div><div class="result-grid"><button v-for="s in results.items" :key="s.id" class="result card" :disabled="busy" @click="openSeries(s)"><img :src="logoMark" class="book-mark" alt=""><div><span class="eyebrow">{{ s.source }}</span><h2>{{ s.title }}</h2><p>{{ s.description.slice(0,170)||'Open this series to explore its chapters.' }}</p><span class="text-link">Explore chapters →</span></div></button></div><div class="pagination"><button :disabled="busy||!results.offset" @click="search(Math.max(0,results.offset-results.limit))">Previous</button><span>Page {{ Math.floor(results.offset/results.limit)+1 }}</span><button :disabled="busy||results.offset+results.limit>=results.total||results.offset+results.limit*2>10000" @click="search(results.offset+results.limit)">Next</button></div></template>
          <div v-else class="empty card"><img :src="logoMark" class="book-mark" alt=""><h2>Good stories start here.</h2><p>Choose a source and search to find a series. You’ll choose a language and translation before downloading.</p><span class="source-pill">Public downloads · No MangaDex account needed</span></div>
        </section>
        <section v-if="view==='queue'||view==='history'">
          <div class="section-bar"><h2>{{ visibleJobs.length }} {{ view==='history'?'completed':'queued and recent' }} chapter(s)</h2><div v-if="view==='queue'" class="inline"><span class="source-pill">{{ paused?'Paused':'Engine running' }}</span><button :disabled="busy" @click="allControl('pause')">Pause all</button><button class="primary" :disabled="busy" @click="allControl('resume')">Resume downloads</button></div></div>
          <div v-if="!visibleJobs.length" class="empty card"><h2>{{ view==='history'?'Your offline shelf is waiting.':'A quiet cave.' }}</h2><p>{{ view==='history'?'Completed downloads will appear here after output validation.':'Search for a series to add your first chapter.' }}</p><button @click="view='search'">Discover manga</button></div>
          <article v-for="j in visibleJobs" :key="j.id" class="card job"><div class="section-bar"><div><p class="eyebrow">{{ j.source }} · {{ j.chapter.language }}</p><h2>{{ j.series.title }}</h2><p>Ch. {{ j.chapter.number }} {{ j.chapter.title }} · {{ j.chapter.groups.map(g=>g.name).join(', ')||'No group listed' }}</p></div><span class="status" :class="j.state">{{ j.state.replace('_',' ') }}</span></div><progress :value="j.done" :max="j.total||1" :aria-label="`${j.done} of ${j.total} pages`"></progress><div class="section-bar"><small>{{ j.done }} / {{ j.total }} pages · {{ j.format.toUpperCase() }}</small><div class="inline"><button v-if="['running','queued'].includes(j.state)" :disabled="busy" @click="control(j.id,'pause')">Pause</button><button v-if="j.state==='paused'" :disabled="busy" @click="control(j.id,'resume')">Resume</button><button v-if="['failed','cancelled','action_required'].includes(j.state)" :disabled="busy" @click="control(j.id,'retry')">Retry</button><button v-if="!['completed','cancelled'].includes(j.state)" :disabled="busy" @click="control(j.id,'cancel')">Cancel</button></div></div><p v-if="j.error" class="job-error">{{ j.error }}</p><p v-if="j.output" class="mono">{{ j.output }}</p><small class="muted mono">{{ j.chapter.id }}</small></article>
        </section>
        <section v-if="view==='sources'" class="source-grid"><article v-for="s in sources" :key="s.id" class="card"><div class="section-bar"><h2>{{ s.name }}</h2><span class="status" :class="s.status==='operational'?'completed':'paused'">{{ s.status==='operational'?'Connector enabled':'Planned · disabled' }}</span></div><p>{{ s.website }}</p><p v-if="s.status==='operational'">{{ s.note || (s.id === "mangadex" ? "Public downloads work without an account. Optional personal-client login is in local Settings." : "Public website search and downloads. Access is checked on each request.") }}</p><p v-else>This source has no working adapter in Phase 1.</p><button v-if="s.status==='operational'" @click="selectedSource=s.id;view='search';results=undefined;detail=undefined">Explore {{ s.name }}</button><button v-else disabled>Not available yet</button></article></section>
      </template>
      <footer>BEAR CAVE <span>Made for a slower kind of reading.</span></footer>
    </main>
    <dialog ref="downloadDialog" class="download-dialog" aria-labelledby="download-title" :aria-busy="previewLoading || busy" @cancel="cancelPreview">
      <h2 id="download-title" ref="previewHeading" tabindex="-1">{{ previewLoading ? 'Checking chapter availability…' : preview ? `Download ${preview.count} matching chapter${preview.count===1?'':'s'}?` : 'Could not prepare this download' }}</h2>
      <p v-if="previewLoading" role="status">Counting the matching chapters before adding them to your queue. You can cancel while this runs.</p>
      <div v-if="previewError" class="notice error" role="alert">{{ previewError }}</div>
      <template v-if="preview && !previewLoading">
        <p>Existing source chapter IDs are skipped. This preview expires in five minutes.</p>
        <p v-if="!preview.count">No downloadable chapters match this selection. Close this dialog and adjust the filters.</p>
        <label v-if="preview.multipleTranslations" class="check"><input v-model="confirmTranslations" type="checkbox"> I want the {{ preview.multipleTranslations }} additional translation(s) of matching chapter numbers. Otherwise cancel and choose one group.</label>
      </template>
      <div class="dialog-actions"><button type="button" :disabled="busy && !previewLoading" @click="cancelPreview()">{{ previewError ? 'Close' : 'Cancel' }}</button><button v-if="preview && !previewLoading" type="button" class="primary" :disabled="busy || !preview.count || Boolean(preview.multipleTranslations && !confirmTranslations)" @click="enqueue">{{ busy ? 'Adding to queue…' : `Confirm ${preview.count} downloads` }}</button></div>
    </dialog>
  </div>
</template>
