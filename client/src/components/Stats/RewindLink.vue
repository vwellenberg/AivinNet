<template>
    <!-- The way to Rewind (#527). A year opens on January 1 for the one that
         ended, so the link appears once there is a finished year with music —
         and names that year, not the one still running. -->
    <RouterLink v-if="latest" class="rewind-link" :to="{ name: Routes.Rewind, params: { year: latest } }">
        Your {{ latest }} Rewind
    </RouterLink>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { getRewindYears } from '@/requests/stats'
import { Routes } from '@/router'

const years = ref<number[]>([])
const latest = computed(() => years.value[years.value.length - 1])

let alive = true
onUnmounted(() => (alive = false))

onMounted(async () => {
    const res = await getRewindYears()
    if (alive && res.status === 200) years.value = res.data.years
})
</script>

<style lang="scss" scoped>
.rewind-link {
    @include btn-pill;
    // A pill, not a bar: the page's column would stretch it across the width.
    width: fit-content;
    margin-top: 1rem;
}
</style>
