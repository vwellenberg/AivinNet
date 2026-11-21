<template>
    <!-- The favourite toggle with the rating as its SECOND gesture: a click (or
         tap) still toggles the favourite, a right-click, the context-menu key or
         a long-press opens the five stars. The player bar has no room for a
         permanent rating control (user, 2026-11-21: "die Leiste unten will ich
         eigentlich gar nicht so voll haben"), so the heart carries it, like the
         theme toggle carries Light · Dark · Auto (nav/ThemeToggle.vue).

         `v-context-menu`, not `@contextmenu`: iOS fires no contextmenu for a
         touch, and the directive also eats the click the lifted finger would
         produce — without that a long-press would rate AND toggle the heart. -->
    <HeartSvg
        v-context-menu="openPicker"
        v-bind="$attrs"
        :state="state"
        :btn_role="btn_role"
        :title="title"
        aria-haspopup="dialog"
        :aria-expanded="open"
        @handle-fav="emit('handleFav')"
    >
        <span v-if="shown !== null" class="heart-rating-tag" aria-hidden="true">
            <StarFillSvg class="heart-rating-star" />{{ shown }}
        </span>
    </HeartSvg>
    <!-- On <body>: the bar is a stacking context of its own, and the picker
         has to float above the page it sits under. -->
    <Teleport to="body">
        <RatingPicker v-if="open" ref="pickerRef" class="heart-rating-picker" :value="shown" @pick="onPick" />
    </Teleport>
</template>

<script setup lang="ts">
import { createPopper, type Instance } from '@popperjs/core'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import useContextStore from '@/stores/context'
import useRatings from '@/stores/ratings'

import StarFillSvg from '@/assets/icons/star.fill.svg'
import HeartSvg from './HeartSvg.vue'
import RatingPicker from './RatingPicker.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
    defineProps<{
        /** The track the heart and the stars belong to; empty = nothing playing. */
        trackhash: string
        /** The rating the host's copy of the track was loaded with (the store's fallback). */
        rating?: number | null
        state: boolean | undefined
        btn_role?: 'compact' | 'bar' | 'action'
    }>(),
    { rating: null, btn_role: 'bar' }
)

const emit = defineEmits<{
    (event: 'handleFav'): void
}>()

const ratings = useRatings()

// Per hash, like every rating control: a change made in a song row or in Now
// Playing shows here, and one made here shows there (stores-and-state.md,
// "Derselbe Track ist mehrere Objekte").
const shown = computed<number | null>(() =>
    props.trackhash ? ratings.rating(props.trackhash, props.rating ?? null) : null
)

const title = computed(() =>
    shown.value === null
        ? 'Favorite. Right-click or long-press to rate'
        : `Favorite. Rated ${shown.value} of 5 — right-click or long-press to change`
)

const open = ref(false)
const pickerRef = ref<{ $el: HTMLElement } | null>(null)
let anchor: HTMLElement | null = null
let popper: Instance | null = null

async function openPicker(e: MouseEvent) {
    if (!props.trackhash) return

    // One floating menu at a time: a track menu left open would sit beside it.
    const context = useContextStore()
    if (context.visible) context.hideContextMenu()

    anchor = e.currentTarget as HTMLElement
    open.value = true
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)

    await nextTick()
    const panel = pickerRef.value?.$el
    if (!open.value || !anchor || !panel) return

    // Above the heart, kept inside the window: the bar is the bottom edge, and
    // on a tablet the heart can stand close to either side.
    //
    // Clear of the player bar, not just of the heart: 10px above the heart
    // left the panel lying across the bar's top edge (measured at 1440px: the
    // heart sits 20px under it), so the frame of the one ran into the other.
    const bar = anchor.closest('.b-bar')
    const gap = bar ? anchor.getBoundingClientRect().top - bar.getBoundingClientRect().top + 8 : 10
    popper = createPopper(anchor, panel, {
        placement: 'top',
        strategy: 'fixed',
        modifiers: [
            { name: 'offset', options: { offset: [0, Math.max(gap, 10)] } },
            { name: 'preventOverflow', options: { padding: 8 } },
            { name: 'flip', options: { fallbackPlacements: ['bottom'] } },
            // top/left rather than a transform, as in stores/context.ts.
            { name: 'computeStyles', options: { gpuAcceleration: false } },
        ],
    })

    // Into the stars, so the keyboard can rate straight away (the context-menu
    // key opens this too). No scroll: the panel is fixed, the page must not jump.
    const start = panel.querySelector<HTMLElement>('.rating-star[aria-pressed="true"]') ?? panel.querySelector<HTMLElement>('.rating-star')
    start?.focus({ preventScroll: true })
}

function close() {
    if (!open.value) return
    open.value = false
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
    popper?.destroy()
    popper = null
}

// A press anywhere outside the panel closes it — mouse, touch or pen, either
// button. Not swallowed: whatever was pressed still gets its click. The heart
// counts as outside, so a click on it closes the stars and toggles as usual.
function onPointerDown(e: PointerEvent) {
    const panel = pickerRef.value?.$el
    if (panel && e.target instanceof Node && panel.contains(e.target)) return
    close()
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    const panel = pickerRef.value?.$el
    const focusInside = !!panel && panel.contains(document.activeElement)
    close()
    // Hand focus back to where it came from, but only if it was in the panel.
    if (focusInside) anchor?.focus({ preventScroll: true })
}

function onPick(value: number | null) {
    const trackhash = props.trackhash
    close()
    if (trackhash) ratings.rate(trackhash, value, props.rating ?? null)
}

// The stars rate the track they were opened for. Left open into the next song,
// the click meant for the previous one would land on this one.
watch(
    () => props.trackhash,
    () => close()
)

onBeforeUnmount(close)
</script>

<style lang="scss">
// Above the bar and the page, level with the context menu (ContextMenu.vue) —
// the two never show together (openPicker closes the menu).
.heart-rating-picker {
    z-index: 1000;
}

// The hint that a rating exists: a small yellow tag in the heart's corner, the
// same anatomy as the theme toggle's "A" (nav/ThemeToggle.vue). Only for a rated
// track, so the bar gains nothing permanent. Yellow is the rating's colour (the
// stars it opens); static, so the ink text holds in both themes.
.heart-button > .heart-rating-tag {
    position: absolute;
    right: -6px;
    bottom: -6px;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 1px;
    height: 16px;
    padding: 0 3px 0 2px;
    border: $mem-ring-w solid $mem-ink;
    border-radius: 4px;
    background-color: $mem-yellow;
    color: $mem-ink;
    font-size: 0.65rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    pointer-events: none;

    // The role sizes every svg in the button to its glyph (0,2,1), and the
    // compact role drop-shadows a favourited one; the tag's star is its own,
    // smaller and flat. Ink body and edge, like the number beside it.
    > .heart-rating-star {
        width: 9px;
        height: 9px;
        filter: none;
        --star-edge: #{$mem-ink};
    }
}
</style>
