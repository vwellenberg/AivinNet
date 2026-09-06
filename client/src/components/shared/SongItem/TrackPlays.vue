<template>
    <div class="song-plays" :title="`${plays} play${playcount === 1 ? '' : 's'}`">
        {{ plays }}
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
    playcount?: number
}>()

// Format with thousands separators, matching the English UI (e.g. 4,862,498).
const plays = computed(() => (props.playcount || 0).toLocaleString('en-US'))
</script>

<style lang="scss">
.songlist-item > .song-plays {
    font-size: small;
    font-variant-numeric: tabular-nums;
    text-align: right;
    opacity: 0.6;

    @include mediumPhones {
        display: none;
    }
}
</style>
