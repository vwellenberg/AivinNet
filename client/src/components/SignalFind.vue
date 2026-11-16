<template>
    <section
        v-if="plate"
        :key="plate.id"
        ref="el"
        class="signal-find"
        role="dialog"
        aria-label="Signal received"
        :style="{ '--sf-left': `${plate.anchor.left}px`, '--sf-top': `${plate.anchor.top}px` }"
        @mouseenter="onPointer(true)"
        @mouseleave="onPointer(false)"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
    >
        <div class="sf-head">
            <span class="sf-kicker">Signal received</span>
            <button type="button" class="sf-close" aria-label="Close" @click="closeSignalPlate">
                <CloseSvg />
            </button>
        </div>

        <p v-if="plate.loading && !plate.find" class="sf-note">Tuning in…</p>
        <p v-else-if="plate.failed" class="sf-note">No signal right now. Try again in a moment.</p>
        <p v-else-if="plate.empty" class="sf-note">No signal: you have heard it all.</p>
        <template v-else-if="view">
            <div class="sf-body" :class="{ 'is-tuning': plate.loading }">
                <img class="sf-cover" :src="paths.images.thumb.medium + view.image" alt="" />
                <div class="sf-text">
                    <span class="sf-reason">{{ view.reason }}</span>
                    <RouterLink
                        v-if="view.albumhash"
                        class="sf-title"
                        :to="{ name: Routes.album, params: { albumhash: view.albumhash } }"
                        @click="closeSignalPlate"
                    >
                        {{ view.title }}
                    </RouterLink>
                    <span v-else class="sf-title">{{ view.title }}</span>
                    <span class="sf-artist">{{ view.artist }}</span>
                </div>
            </div>
            <div class="sf-actions">
                <button type="button" class="sf-play" :disabled="plate.loading" @click="play">
                    <PlaySvg />
                    Play
                </button>
                <button type="button" class="sf-another" :disabled="plate.loading" @click="anotherFind">
                    <ShuffleSvg />
                    Another
                </button>
            </div>
        </template>
    </section>
</template>

<script setup lang="ts">
// The logo's find (#828), drawn once for the whole app. Seven clicks on the
// planet (composables/useLogoSignal.ts) open it right under the icon that was
// clicked: the answer stands where the question was asked, not with the
// toasts at the bottom, where it would read as a system message.
//
// It stays while the pointer or the focus is on it, and slides back into the
// planet after AUTO_CLOSE_MS left alone. Esc, the ✕ or a click elsewhere
// close it at once.
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { paths } from '@/config'
import { Routes } from '@/router'
import { playFromAlbumCard, playFromPlaylist } from '@/helpers/usePlayFrom'
import { AUTO_CLOSE_MS, anotherFind, closeSignalPlate, useSignalPlate } from '@/composables/useLogoSignal'
import { findView } from '@/utils/signalFind'

import CloseSvg from '@/assets/icons/close.svg'
import PlaySvg from '@/assets/icons/play.svg'
import ShuffleSvg from '@/assets/icons/shuffle.svg'

const plate = useSignalPlate()
const el = ref<HTMLElement | null>(null)
const view = computed(() => (plate.value?.find ? findView(plate.value.find) : null))

let timer: ReturnType<typeof setTimeout> | null = null
// The plate stays while the pointer OR the focus is on it; each is tracked on
// its own, so leaving with one does not drop the hold of the other.
let pointerIn = false
let focusIn = false

function stopTimer() {
    if (timer) clearTimeout(timer)
    timer = null
}

function startTimer() {
    stopTimer()
    if (!pointerIn && !focusIn && plate.value) timer = setTimeout(closeSignalPlate, AUTO_CLOSE_MS)
}

function onPointer(inside: boolean) {
    pointerIn = inside
    startTimer()
}

function onFocusIn() {
    focusIn = true
    stopTimer()
}

function onFocusOut(e: FocusEvent) {
    // Focus moving between the plate's own buttons is not leaving it.
    const next = e.relatedTarget as Node | null
    if (next && el.value?.contains(next)) return
    focusIn = false
    startTimer()
}

/** A press anywhere outside the plate closes it, like any popover. */
function onPointerDown(e: PointerEvent) {
    if (el.value && !el.value.contains(e.target as Node)) closeSignalPlate()
}

/** Esc closes it from anywhere: the plate does not take the focus when it opens. */
function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeSignalPlate()
}

function unlisten() {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
}

watch(
    () => plate.value?.id,
    id => {
        pointerIn = false
        focusIn = false
        unlisten()
        if (id === undefined) return stopTimer()
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        startTimer()
    }
)

// A new find restarts the clock: "Another" is attention.
watch(() => plate.value?.find, startTimer)

onBeforeUnmount(() => {
    stopTimer()
    unlisten()
})

async function play() {
    const find = plate.value?.find
    if (!find) return
    closeSignalPlate()
    // Both go through the queue's own seams (a group session included).
    if (find.type === 'album') await playFromAlbumCard(find.item.albumhash, find.item.title)
    else await playFromPlaylist('forgottenfavorites', find.item)
}
</script>

<style lang="scss">
// A plate torn off the planet: it hangs from the icon's lower edge, tilted the
// way a sticker lands, and straightens under the pointer — the same gesture the
// covers in the song list make (styling.md, "Kassetten-Inlay").
.signal-find {
    position: fixed;
    left: var(--sf-left);
    top: calc(var(--sf-top) + #{$small});
    z-index: 1002;
    width: 22rem;
    max-width: calc(100vw - 2rem);
    padding: $medium;
    display: grid;
    gap: $medium;
    color: $mem-content-text;
    @include candy-box($mem-panel, $candy-radius);
    @include candy-shadow(4px, 4px);
    transform: rotate(-1.5deg);
    transform-origin: 1.5rem 0;
    transition: transform $motion-move $motion-curve;
    animation: sf-tear-off $motion-veil $motion-curve-overshoot backwards;

    @media (hover: hover) {
        &:hover {
            transform: none;
        }
    }

    &:focus-within {
        transform: none;
    }

    // Phones: the whole width under the top bar, 16px from either edge.
    @include allPhones {
        left: 1rem;
        right: 1rem;
        width: auto;
        max-width: none;
    }
}

.sf-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $small;
}

.sf-kicker {
    @include mem-sticker($fill: $mem-lavender);
    color: $candy-black;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.sf-close {
    @include btn-quiet($size: $control-compact, $glyph: 1.25rem);
    color: $mem-content-text;
}

.sf-note {
    margin: 0;
    font-weight: 600;
}

.sf-body {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    gap: $medium;
    align-items: center;

    // "Another" is on its way: the old find stays, quieter, so the plate does
    // not jump while the server answers.
    &.is-tuning {
        opacity: 0.5;
    }
}

.sf-cover {
    width: 4.5rem;
    height: 4.5rem;
    object-fit: cover;
    border: $candy-border;
    border-radius: $candy-radius-sm;
    background-color: $mem-soft;
}

.sf-text {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
}

.sf-reason {
    font-size: 0.75rem;
    font-weight: 700;
    color: $candy-text-muted;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.sf-title,
.sf-artist {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.sf-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: inherit;
    @include focus-ring;

    @media (hover: hover) {
        &:hover {
            text-decoration: underline;
        }
    }
}

.sf-artist {
    font-size: 0.85rem;
    color: $candy-text-muted;
}

.sf-actions {
    display: flex;
    gap: $small;

    svg {
        width: 1.25rem;
        height: 1.25rem;
    }
}

.sf-play {
    @include btn-primary($h: $bar-control, $glyph: 1.25rem);
    gap: 0.4rem;
}

.sf-another {
    @include btn-pill($h: $bar-control, $fill: $mem-panel);
    color: $mem-content-text;
    gap: 0.4rem;
}

// Out of the planet: small, turned and tucked into the icon's corner, then it
// overshoots once and lands on its own tilt. The end frame is left out on
// purpose — it lands on the declared transform (see `mem-plate-rise`).
@keyframes sf-tear-off {
    0% {
        opacity: 0;
        transform: translate(-0.5rem, -1.5rem) rotate(-14deg) scale(0.3);
        box-shadow: 0 0 0 var(--mem-shadow);
    }
}
</style>
