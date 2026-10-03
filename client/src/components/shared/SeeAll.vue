<template>
    <span class="see-all">
        <RouterLink :to="route">
            <b>{{ text || `SEE ALL` }}</b>
        </RouterLink>
    </span>
</template>

<script setup lang="ts">
defineProps<{
    route: string
    text?: string
}>()
</script>

<style lang="scss">
// "SEE ALL" / "VIEW HISTORY" sits at the right end of a section caption, on the
// memphis ground — a sticker plate like the caption itself. But it IS pressable,
// and right next to a smooth caption is exactly where the texture has to say so
// (styling.md: the hatch marks a control BETWEEN non-controls). It used to stay
// smooth as "a text link, not a control surface" and read as a second caption.
// Its face is a word, so the texture is a ring around the label, never behind it
// (mem-label-hatch, the #476 pattern); the ring sits inside the 0.25rem/0.7rem
// padding like btn-pill's auto-height variant.
.see-all {
    @include mem-sticker($candy-radius-pill, 0.25rem 0.7rem);
    @include mem-label-hatch(26px, $on: surface, $ring-y: 0.2rem);
    font-size: 0.75rem;
    // A 0.75rem uppercase link, not a heading: a look's display face (a pixel
    // face in Desktop 98) blurs letters at this size (#241).
    @include body-face;
    letter-spacing: 0.04em;
    flex-shrink: 0;
    // Motion only — the paint is a cut (styling.md).
    transition: box-shadow $motion-shadow ease-out;

    // The text token travels with the fill (#422) and reaches the link by
    // INHERITANCE — the global anchor rule is `color: inherit`, and the sticker
    // already colours the capsule. The `a { color: $candy-text }` pin that used
    // to sit here restated that inheritance and, on hover, outweighed it: the
    // pill went solid ink with invisible ink text.
    &:hover {
        background-color: $mem-hover;
        color: var(--mem-hover-text);
        // The fill flips (ink plate in light, paper plate in dark), so the
        // stroke colour flips with it — rule 2 of the hatch section.
        --label-hatch: var(--mem-hatch-hover);
        @include candy-shadow(4px, 4px);
    }
}
</style>
