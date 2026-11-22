<template>
    <Teleport to="body">
        <div v-if="open" class="quick-play">
            <div class="qp-bg" @click="close"></div>
            <div class="qp-panel" role="dialog" aria-modal="true" aria-label="Quick play">
                <input
                    ref="inputEl"
                    v-model="query"
                    class="qp-input"
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="quick-play-list"
                    :aria-expanded="visible.length > 0"
                    placeholder="Play a song by its title"
                    autocomplete="off"
                    spellcheck="false"
                    @keydown="onKeydown"
                />
                <ul v-if="visible.length" id="quick-play-list" class="qp-list" role="listbox" @mousedown.prevent>
                    <li v-for="(track, i) in visible" :key="track.trackhash + ':' + i" role="presentation" @mouseenter="select(i)">
                        <button
                            type="button"
                            role="option"
                            class="qp-row"
                            :class="{ selected: i === selected }"
                            :aria-selected="i === selected"
                            tabindex="-1"
                            @click="playRow(i)"
                        >
                            <span class="qp-title">{{ track.title }}</span>
                            <span class="qp-meta">{{ meta(track) }}</span>
                        </button>
                    </li>
                </ul>
                <div v-else-if="showNoMatch" class="qp-empty">No match</div>
                <p class="qp-hint">{{ hint }}</p>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { createQuickPlay } from '@/helpers/quickPlay'
import type { Track } from '@/interfaces'
import { searchTracks } from '@/requests/searchMusic'
import { closeQuickPlay, focusRequest, isQuickPlayShortcut, open } from '@/stores/quickPlay'
import { quickPlayHint } from '@/utils/shortcuts'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'

const queue = useQueue()
const tracklist = useTracklist()
const inputEl = ref<HTMLInputElement | null>(null)

// The same two calls the search page makes (views/SearchView/tracks.vue).
const qp = createQuickPlay({
    search: query => searchTracks(query, 0, true),
    playNow: (query, tracks, index) => {
        tracklist.setFromSearch(query, tracks)
        queue.play(index)
    },
    playNext: track => queue.playTrackNext(track),
    close: () => closeQuickPlay(),
})

const { query, visible, selected, searching, results } = qp

// The keys of this box, from the same list as the ? overlay.
const hint = quickPlayHint()
const showNoMatch = computed(() => !searching.value && query.value.trim() !== '' && results.value.length === 0)

function meta(track: Track) {
    const artists = (track.artists ?? []).map(a => a.name).join(', ')
    return [artists, track.album].filter(Boolean).join(' · ')
}

function select(i: number) {
    qp.select(i)
}

function playRow(i: number) {
    qp.select(i)
    void qp.confirm(false)
}

function close() {
    closeQuickPlay()
}

// Every change of the text (typing, or reset on open/close) goes to the helper.
watch(query, text => qp.setQuery(text))

function onKeydown(e: KeyboardEvent) {
    // The global shortcut handler must not act on keys typed here (arrows seek).
    e.stopPropagation()
    if (e.isComposing) return

    // Ctrl/Cmd+P again while the box is open: the global handler never sees this
    // key (stopped above), so suppress the browser's print dialog here and select
    // the text for a new search.
    if (isQuickPlayShortcut(e)) {
        e.preventDefault()
        inputEl.value?.select()
        return
    }

    // Focus stays in the box: Tab would move it to the page behind the
    // backdrop, where Space toggles playback and Escape closes something else.
    if (e.key === 'Tab') {
        e.preventDefault()
        return
    }

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault()
            qp.move(1)
            break
        case 'ArrowUp':
            e.preventDefault()
            qp.move(-1)
            break
        case 'Enter':
            e.preventDefault()
            void qp.confirm(e.shiftKey)
            break
        case 'Escape':
            e.preventDefault()
            close()
            break
    }
}

// Focus goes to the input on every open, and back to the element that had it
// when the box closes. Ctrl/Cmd+P while open re-focuses the field (focusRequest).
let previousFocus: HTMLElement | null = null

watch(open, (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        qp.reset()
    }
    if (!isOpen && wasOpen) {
        qp.reset()
        const back = previousFocus
        previousFocus = null
        if (back && back.isConnected) back.focus()
    }
})

watch(
    [open, focusRequest],
    async ([isOpen]) => {
        if (!isOpen) return
        await nextTick()
        inputEl.value?.focus()
        inputEl.value?.select()
    },
    { flush: 'post' }
)

onBeforeUnmount(() => qp.dispose())
</script>

<style lang="scss">
.quick-play {
    position: fixed;
    inset: 0;
    // Above the page chrome. Never over a modal: useKeyboard does not open the
    // box while one is visible.
    z-index: 70;
    display: grid;
    place-items: start center;
    padding-top: 12vh;

    .qp-bg {
        position: absolute;
        inset: 0;
        background-color: rgb(0, 0, 0, 0.6);
    }

    .qp-panel {
        position: relative;
        width: min(560px, 100vw - 32px);
        padding: 1rem;
        display: grid;
        gap: 0.75rem;
        color: $candy-text;
        @include candy-box($candy-white, $candy-radius);
        @include candy-shadow(6px, 6px);
        animation: mem-plate-rise $motion-settle ease-out;
    }

    .qp-input {
        width: 100%;
        height: 2.75rem;
        padding: $small $medium;
        font-size: 16px;
        color: $candy-text;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        background-color: $candy-pink-soft;
        outline: none;
    }

    .qp-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.5rem;
    }

    .qp-row {
        display: grid;
        // The global button rule centres its content: one full-width column
        // keeps title and meta at the left edge, and lets the ellipsis work.
        grid-template-columns: minmax(0, 1fr);
        justify-content: stretch;
        gap: 0.125rem;
        width: 100%;
        min-height: 44px;
        padding: 0.5rem 0.75rem;
        text-align: left;
        font: inherit;
        cursor: pointer;
        @include mem-row-plate($candy-radius-sm, $hatch: false);

        &:hover {
            @include mem-row-plate-hover($hatch: false);
        }

        &.selected {
            // No texture through title and meta: the blush fill alone marks
            // the row Enter plays.
            @include mem-row-plate-active($hatch: false);

            // The muted token is light in dark mode and vanished on the blush
            // fill; the active plate sets the ink that belongs on it.
            .qp-meta {
                color: inherit;
            }
        }

        .qp-title {
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .qp-meta {
            font-size: 13px;
            color: $candy-text-muted;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }

    .qp-empty {
        padding: 0.5rem 0.25rem;
        color: $candy-text-muted;
    }

    // Plain muted text on the panel surface, never on the hatch.
    .qp-hint {
        margin: 0;
        font-size: 13px;
        color: $candy-text-muted;
    }
}
</style>
