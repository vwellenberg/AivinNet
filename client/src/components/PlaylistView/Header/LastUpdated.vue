<template>
    <!-- Status text only. Edit and Delete used to live here too, and that was
         the bug: this box is absolutely positioned in the header's bottom-right
         corner, so on a phone — where the status text hides — the two buttons
         landed beside the action row without belonging to it (4px higher, 30px
         away instead of the row's 8px). They are overflow actions and sit in
         the header's own row now, behind the ⋯ button in Header/Info.vue. -->
    <div v-if="!isHeaderSmall" class="last-updated">
        <span class="status">Last updated {{ playlist.info._last_updated }}</span>
    </div>
</template>
<script setup lang="ts">
import { isHeaderSmall } from '@/stores/content-width'

import usePStore from '@/stores/pages/playlist'

const playlist = usePStore()
</script>

<style lang="scss">
// Part of the header's meta line since the plate anatomy — it used to be an
// absolutely positioned box in the bottom-right corner, and that is precisely
// how its two buttons once ended up NEXT TO the action row without belonging
// to it (see the note in the template).
.last-updated {
    display: inline;

    &::before {
        content: " • ";
    }
}
</style>
