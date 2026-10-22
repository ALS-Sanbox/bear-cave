<script setup lang="ts">
import type { DashboardModel } from '../composables/useDashboard';
defineProps<{
    model: DashboardModel;
}>();
</script>

<template>
<div class="pagination">
  <button :disabled="model.busy||model.offset===0" @click="model.page(model.offset-model.pageSize)">Previous</button>
  <span>{{model.total?model.offset+1:0}}–{{Math.min(model.offset+model.pageSize,model.total)}} of {{model.total}}</span>
  <button :disabled="model.busy||model.offset+model.pageSize>=model.total" @click="model.page(model.offset+model.pageSize)">Next</button>
</div>
</template>
