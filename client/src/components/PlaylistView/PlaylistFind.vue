<template>
    <!-- The playlist's own find. It searches every track (the store loads the
         rest on the first letter), where the browser's Cmd/Ctrl+F only sees
         the rows the virtual scroller has rendered. Cmd/Ctrl+F lands here
         (utils/pageFind.ts, registered by PlaylistView). -->
    <label class="ah-find" :class="{ 'has-query': query }">
        <SearchSvg class="ah-find-glyph" aria-hidden="true" />
        <input
            id="playlist-find"
            v-model="query"
            type="search"
            placeholder="Find in playlist"
            aria-label="Find in playlist"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="search"
            @keydown.esc="onEscape"
        />
    </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import usePlaylistStore from '@/stores/pages/playlist'

import SearchSvg from '@/assets/icons/search.svg'

const playlist = usePlaylistStore()

const query = computed({
    get: () => playlist.query,
    set: (value: string) => void playlist.setQuery(value),
})

// Escape clears first, the way the browser's find bar does; a second Escape
// (or one on an empty field) leaves it — the global handler blurs inputs.
function onEscape(e: KeyboardEvent) {
    if (!playlist.query) return
    e.stopPropagation()
    e.preventDefault()
    void playlist.setQuery('')
}
</script>

<style lang="scss">
// A field, not a control: it is sunk into the bar, not raised off it — no
// offset shadow, no press, no hatch (styling.md: the hatch means "press me").
.p-after-header .ah-find {
    display: flex;
    align-items: center;
    gap: $small;
    flex: 0 1 18rem;
    min-width: 0;
    height: $bar-control;
    padding: 0 0.75rem;
    margin-left: auto;
    @include candy-box($mem-panel, $candy-radius-pill);
    border-style: var(--shape-well-style, solid);
    color: $candy-text;
    cursor: text;

    // The bar's caption case and tracking are for its label, not for what is typed.
    text-transform: none;
    letter-spacing: normal;
    font-size: 14px;
    font-weight: 500;

    &:focus-within {
        outline: $focus-ring-w solid $mem-focus;
        outline-offset: 2px;
    }

    .ah-find-glyph {
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

// Next to the Edit button the field gives up its push to the right: the button
// already takes it, and two `auto` margins would split the space between them.
.p-after-header .ah-find + .ah-edit {
    margin-left: $small;
}
</style>
