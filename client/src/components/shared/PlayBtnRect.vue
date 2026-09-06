<template>
    <!-- Primary "Play" CTA: a bold teal memphis button with a subtle sprinkle
         texture and ink label + glyph, one consistent look on every header. -->
    <button
        class="playbtnrect shadow-sm circular btn-active"
        @click="playFrom(source)"
    >
        <playBtnSvg />
        <div class="text">Play</div>
    </button>
</template>

<script setup lang="ts">
import { playSources } from '@/enums'

import playBtnSvg from '@/assets/icons/play.svg'
import { playFrom } from '@/helpers/usePlayFrom'

defineProps<{
    source: playSources
}>()
</script>

<style lang="scss">
// `button.` prefix so the teal fill/border/radius win over the global button
// base, .btn-active and .circular (pill) without !important.
button.playbtnrect {
    // The primary role owns the whole anatomy: teal fill, ink border, the 3px
    // offset (deeper than the 2px every other surface gets), the sprinkle
    // texture and the scale feedback. Only the footprint stays here — 6rem wide
    // for the "Play" label, at the same 44px height as the rest of the header
    // row. (That height used to be phone-only, so on desktop the primary CTA
    // sat 36px next to 44px siblings and the baseline visibly stepped.)
    @include btn-primary($w: 6rem, $h: 2.75rem);
    // Opted in here rather than in the role: this primary mounts once per page
    // and belongs to the header's action row, so it pops in with its
    // neighbours. The role leaves it out because the card play discs are also
    // primaries and they re-mount constantly inside the recycling scroller.
    @include btn-pop;
    padding-right: 1rem;

    // The label needs the same stacking lift the role gives the glyph, so it
    // sits above the sprinkle overlay.
    .text {
        position: relative;
        z-index: 1;
    }
}
</style>
