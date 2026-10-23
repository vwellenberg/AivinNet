<template>
    <!-- The way to Rewind (#527), while it is news (#572): the latest finished
         year until it has been seen to the end. After that the link goes and
         the square of January 1 in the calendar below is the way back. -->
    <RouterLink v-if="fresh" class="rewind-link" :to="{ name: Routes.Rewind, params: { year: fresh } }">
        Your {{ fresh }} Rewind
    </RouterLink>
</template>

<script setup lang="ts">
import { Routes } from '@/router'

defineProps<{ fresh: number | null | undefined }>()
</script>

<style lang="scss" scoped>
.rewind-link {
    @include btn-pill;
    // A pill, not a bar: the page's column would stretch it across the width.
    width: fit-content;
    // First on the page: no space above (the page's own start line, `$page-start`),
    // the gap to the charts below.
    margin-bottom: 1.5rem;
}
</style>
