<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { DashboardModel, DialogPort } from '../composables/useDashboard';
defineProps<{
    model: DashboardModel;
}>();
const emit = defineEmits<{
    ready: [
        port: DialogPort
    ];
}>();
const dialog = ref<HTMLDialogElement>();
onMounted(() => emit('ready', {
    showModal: () => dialog.value?.showModal(), close: () => dialog.value?.close(), isOpen: () => Boolean(dialog.value?.open)
}));
</script>

<template>
<dialog ref="dialog" class="download-dialog" aria-labelledby="download-title" :aria-busy="model.previewLoading||model.busy" @cancel="model.cancelPreview">
  <h2 id="download-title" tabindex="-1">{{model.previewLoading?'Checking chapter availability...':model.preview?`Download ${model.preview.count} new chapter(s)?`:'Could not prepare this download'}}</h2>
  <p v-if="model.previewLoading" role="status">Counting matching chapters. You can cancel while this runs.</p>
  <div v-if="model.previewError" class="notice error" role="alert">{{model.previewError}}</div>
  <template v-if="model.preview&&!model.previewLoading">
    <dl class="preview-counts">
      <dt>Total matching</dt>
      <dd>{{model.preview.total}}</dd>
      <dt>Already completed</dt>
      <dd>{{model.preview.completed}}</dd>
      <dt>Already queued / existing</dt>
      <dd>{{model.preview.existing}}</dd>
      <dt>New chapters to add</dt>
      <dd>{{model.preview.count}}</dd>
    </dl>
    <p>Existing identities are skipped. This preview expires in five minutes. Counts are checked again when you confirm.</p>
    <p v-if="!model.preview.count">No new chapters to add. Use History to verify or download completed chapters again.</p>
    <label v-if="model.preview.multipleTranslations" class="check">
      <input v-model="model.confirmTranslations" type="checkbox">
      I explicitly want
      {{model.preview.multipleTranslations}}
      additional translation(s). Otherwise cancel and choose one group.
    </label>
  </template>
  <div class="dialog-actions">
    <button :disabled="model.busy&&!model.previewLoading" @click="model.cancelPreview()">{{model.previewError?'Close':'Cancel'}}</button>
    <button v-if="model.preview&&!model.previewLoading" class="primary" :disabled="model.busy||!model.preview.count||Boolean(model.preview.multipleTranslations&&!model.confirmTranslations)" @click="model.enqueue">{{model.busy?'Adding to queue...':`Confirm ${model.preview.count} downloads`}}</button>
  </div>
</dialog>
</template>
