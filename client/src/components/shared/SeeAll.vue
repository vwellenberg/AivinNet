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
// memphis ground — so it is a sticker like the caption itself. It IS pressable,
// but it is a text link rather than a control surface, so it takes the sticker
// (no hatch) and answers with the row-plate's hover tint instead.
.see-all {
    @include mem-sticker(999px, 0.25rem 0.7rem);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    flex-shrink: 0;
    // Motion only — the paint is a cut (styling.md).
    transition: box-shadow 0.12s ease-out;

    // The text token travels with the fill (#422) and reaches the link by
    // INHERITANCE — the global anchor rule is `color: inherit`, and the sticker
    // already colours the capsule. The `a { color: $candy-text }` pin that used
    // to sit here restated that inheritance and, on hover, outweighed it: the
    // pill went solid ink with invisible ink text.
    &:hover {
        background-color: $mem-hover;
        color: var(--mem-hover-text);
        @include candy-shadow(4px, 4px);
    }
}
</style>
