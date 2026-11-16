<template>
    <!-- A list's own find field. Long lists render through a virtual scroller
         (only the rows in view exist) and often load page by page, so the
         browser's Cmd/Ctrl+F cannot see a track further down; this field
         searches the whole list, and Cmd/Ctrl+F lands here
         (helpers/useListFind.ts). What it searches is the host's: it only
         reports the query. -->
    <label class="list-find" :class="{ 'has-query': modelValue }">
        <SearchSvg class="list-find-glyph" aria-hidden="true" />
        <input
            :id="fieldId"
            :value="modelValue"
            type="search"
            :placeholder="placeholder"
            :aria-label="placeholder"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="search"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
            @keydown.esc="onEscape"
        />
    </label>
</template>

<script setup lang="ts">
import SearchSvg from '@/assets/icons/search.svg'

const props = defineProps<{
    modelValue: string
    // The `id` useListFind() focuses on Cmd/Ctrl+F.
    fieldId: string
    placeholder: string
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void
}>()

// Escape clears first, the way the browser's find bar does; a second Escape
// (or one on an empty field) leaves it — the global handler blurs inputs.
function onEscape(e: KeyboardEvent) {
    if (!props.modelValue) return
    e.stopPropagation()
    e.preventDefault()
    emit('update:modelValue', '')
}
</script>

<style lang="scss">
// A field, not a control: it is sunk into its surface, not raised off it — no
// offset shadow, no press, no hatch (styling.md: the hatch means "press me").
// Where it sits (margins, grid cell) is the host's.
.list-find {
    display: flex;
    align-items: center;
    gap: $small;
    flex: 0 1 18rem;
    min-width: 0;
    height: $bar-control;
    padding: 0 0.75rem;
    @include candy-box($mem-panel, $candy-radius-pill);
    border-style: var(--shape-well-style, solid);
    color: $candy-text;
    cursor: text;

    // A host's caption case and tracking (the playlist's ink bar) are for its
    // label, not for what is typed.
    text-transform: none;
    letter-spacing: normal;
    font-size: 14px;
    font-weight: 500;

    &:focus-within {
        outline: $focus-ring-w solid $mem-focus;
        outline-offset: 2px;
    }

    .list-find-glyph {
        flex-shrink: 0;
        width: 1.125rem;
        height: 1.125rem;
        color: $candy-text-muted;
    }

    input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: none;
        outline: none;
        background-color: transparent;
        color: inherit;
        font: inherit;
        text-overflow: ellipsis;

        &::placeholder {
            color: $candy-text-faint;
            opacity: 1;
        }
    }
}
</style>
