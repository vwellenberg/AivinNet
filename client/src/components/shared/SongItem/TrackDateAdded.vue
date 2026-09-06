<template>
    <div class="song-date-added" :title="tooltip">{{ text }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { formatDate, formatDateAdded } from '@/utils/dates'

const props = defineProps<{
    // Unix timestamp (seconds). Null/undefined = added before the backend
    // started recording dates -> placeholder.
    timestamp?: number | null
}>()

// Explicit null check (not truthiness): 0 is a valid unix timestamp.
const hasDate = computed(() => props.timestamp != null)

const text = computed(() => (hasDate.value ? formatDateAdded(props.timestamp as number) : '—'))
const tooltip = computed(() =>
    hasDate.value ? `Added on ${formatDate(props.timestamp as number)}` : 'Added before dates were tracked'
)
</script>

<style lang="scss">
.songlist-item > .song-date-added {
    font-size: small;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.6;

    @include mediumPhones {
        display: none;
    }
}
</style>
