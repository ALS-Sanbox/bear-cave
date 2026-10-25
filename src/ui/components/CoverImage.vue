<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import logoMark from '../assets/logo-mark.png';
const props = defineProps<{
    source: string;
    id: string;
    title: string;
    revision?: number;
    eager?: boolean;
}>();
const failed = ref(false), url = computed(() => `/api/cover-image?${new URLSearchParams({
    source: props.source, id: props.id, revision: String(props.revision ?? 0)
})}`);
watch(url, () => {
    failed.value = false;
});
</script>

<template>
<img :src="failed?logoMark:url" :alt="failed?`${title} cover unavailable`:`Cover of ${title}`" width="96" height="144" :loading="eager?'eager':'lazy'" class="series-cover" @error="failed=true">
</template>
