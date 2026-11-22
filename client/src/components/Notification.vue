<template>
    <div v-if="notifStore.notifs" class="toasts">
        <!-- A toast with onClick is itself the control ("Playlist created" →
             open it), so it renders as a real <button>. Not combined with an
             action: that would nest a button in a button.
             Every other toast goes away on a tap, and every toast can be
             swiped aside (utils/swipeDismiss.ts). -->
        <component
            :is="isLink(notif) ? 'button' : 'div'"
            v-for="notif in notifStore.notifs"
            :key="notif.id"
            :type="isLink(notif) ? 'button' : undefined"
            class="new-notif rounded-sm"
            :class="[
                notif.type,
                { 'has-action': notif.action, 'is-link': isLink(notif), 'is-swiping': swipingId === notif.id },
            ]"
            :style="swipeStyle(notif.id)"
            @click="onToastClick(notif)"
            @pointerdown="startSwipe($event, notif)"
        >
            <component :is="getSvg(notif.type)" class="notif-icon" />
            <div class="notif-text">{{ notif.text }}</div>
            <button v-if="notif.action" type="button" class="notif-action rounded-sm" @click.stop="runAction(notif)">
                {{ notif.action.label }}
            </button>
        </component>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'

import { Notif } from '../interfaces'
import { NotifType, useToast } from '../stores/notification'
import { SWIPE_SLOP_PX, swipeDismisses, swipeOpacity } from '../utils/swipeDismiss'

import BookmarkSvg from '../assets/icons/bookmark.svg'
import ErrorSvg from '../assets/icons/toast/error.svg'
import InfoSvg from '../assets/icons/toast/info.svg'
import SuccessSvg from '../assets/icons/toast/ok.svg'
import WorkingSvg from '../assets/icons/toast/working.svg'

const notifStore = useToast()

function runAction(notif: Notif) {
    notifStore.dismiss(notif.id)
    notif.action?.handler()
}

function isLink(notif: Notif) {
    return !!notif.onClick && !notif.action
}

function onToastClick(notif: Notif) {
    // The click that ends a swipe is part of the gesture, not a tap: without
    // this a swiped "Playlist created" would open the playlist on release.
    if (suppressClickFor === notif.id) {
        suppressClickFor = null
        return
    }
    if (leaving.has(notif.id)) return
    notifStore.dismiss(notif.id)
    if (isLink(notif)) notif.onClick?.()
}

// ---------------------------------------------------------------------------
// Swipe aside. One finger at a time; the travel per toast lives in `offsets`
// so the template can follow it.
// ---------------------------------------------------------------------------

/** How long the thrown-away toast slides out before it is removed. */
const LEAVE_MS = 180

interface Swipe {
    id: number
    pointerId: number
    el: HTMLElement
    startX: number
    startY: number
    lastX: number
    lastT: number
    speed: number
    active: boolean
}

let swipe: Swipe | null = null
let suppressClickFor: number | null = null
const swipingId = ref<number | null>(null)
const offsets = reactive(new Map<number, number>())
const leaving = reactive(new Set<number>())

function swipeStyle(id: number) {
    const dx = offsets.get(id)
    if (dx === undefined) return undefined
    const el = swipe?.id === id ? swipe.el : undefined
    const width = el?.offsetWidth || Math.abs(dx) || 1
    return {
        transform: `translateX(${dx}px)`,
        opacity: leaving.has(id) ? 0 : swipeOpacity(dx, width),
    }
}

function startSwipe(e: PointerEvent, notif: Notif) {
    // A new press clears a suppression a cancelled gesture may have left.
    suppressClickFor = null
    if (swipe || e.button !== 0 || leaving.has(notif.id)) return
    // The action button is its own target; a swipe starting on it would turn
    // every slightly moving tap on "Undo" into a lost undo.
    if ((e.target as HTMLElement | null)?.closest?.('.notif-action')) return

    swipe = {
        id: notif.id,
        pointerId: e.pointerId,
        el: e.currentTarget as HTMLElement,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastT: e.timeStamp,
        speed: 0,
        active: false,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(e: PointerEvent) {
    const s = swipe
    if (!s || e.pointerId !== s.pointerId) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY

    if (!s.active) {
        if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return
        // Mostly vertical: not a swipe. Let the press end as whatever it is.
        if (Math.abs(dy) > Math.abs(dx)) {
            endSwipe(false)
            return
        }
        s.active = true
        swipingId.value = s.id
        try {
            s.el.setPointerCapture?.(s.pointerId)
        } catch {
            // No active pointer to capture (a synthetic event) — the window
            // listeners still see every move.
        }
    }

    const dt = e.timeStamp - s.lastT
    if (dt > 0) s.speed = (e.clientX - s.lastX) / dt
    s.lastX = e.clientX
    s.lastT = e.timeStamp
    offsets.set(s.id, dx)
}

function onPointerUp(e: PointerEvent) {
    if (swipe && e.pointerId === swipe.pointerId) endSwipe(true)
}

function onPointerCancel(e: PointerEvent) {
    if (swipe && e.pointerId === swipe.pointerId) endSwipe(false)
}

function removeListeners() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
}

function endSwipe(release: boolean) {
    const s = swipe
    swipe = null
    swipingId.value = null
    removeListeners()
    if (!s?.active) return

    const dx = offsets.get(s.id) ?? 0
    const width = s.el.offsetWidth
    if (release) suppressClickFor = s.id

    if (release && swipeDismisses(dx, width, s.speed)) {
        // Carry on in the direction of the throw, then drop it from the store.
        leaving.add(s.id)
        offsets.set(s.id, Math.sign(dx || 1) * (width + 32))
        const id = s.id
        setTimeout(() => {
            notifStore.dismiss(id)
            leaving.delete(id)
            offsets.delete(id)
            if (suppressClickFor === id) suppressClickFor = null
        }, LEAVE_MS)
    } else {
        // Not far enough: it springs back (the transition in the styles).
        offsets.delete(s.id)
    }
}

onBeforeUnmount(removeListeners)

function getSvg(notif: NotifType) {
    switch (notif) {
        case NotifType.Error:
            return ErrorSvg
        case NotifType.Info:
            return InfoSvg
        case NotifType.Success:
            return SuccessSvg
        case NotifType.Working:
            return WorkingSvg
        case NotifType.Favorite:
            return BookmarkSvg
    }
}
</script>
<style lang="scss">
.toasts {
    position: fixed;
    bottom: 6rem;
    left: 50%;
    width: 100%;
    transform: translate(-50%);
    z-index: 1003;
    display: flex;
    align-items: center;
    flex-direction: column-reverse;
    gap: 1rem;
    // This container spans the FULL viewport width while the toast inside it is
    // only 18rem and centred. Without this it swallowed every click in its
    // horizontal band — the whole row left and right of a visible toast was
    // dead until the toast timed out. It is a layout box, never a click target.
    pointer-events: none;
}

.new-notif {
    position: relative;
    // Re-enable hit-testing on the toast itself — the container above opts the
    // whole strip out. Without this the action button (`.notif-action`, e.g.
    // an undo) would be unclickable, which is a worse bug than the one fixed.
    pointer-events: auto;
    font-size: 0.85rem;
    font-weight: 600;
    color: $candy-text;
    display: grid;
    place-items: center;
    width: 100%;
    max-width: 18rem;
    min-height: 4rem;
    padding: 1rem $medium;
    padding-right: $large;
    @include candy-box($candy-white, $candy-radius-sm);
    @include candy-shadow(3px, 3px);

    grid-template-columns: 2rem 3fr;
    gap: $small;

    // Every toast goes on a tap or a sideways swipe. `pan-y` hands the
    // horizontal gesture to us and keeps vertical scrolling the browser's;
    // no text selection, or a mouse drag would highlight instead of throw.
    cursor: pointer;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    // The spring back after a short swipe and the slide out after a long one.
    transition:
        transform 180ms ease-out,
        opacity 180ms ease-out;

    .notif-icon {
        color: $candy-text;
    }

    .notif-text {
        width: 100%;
    }

    // Under the finger it follows exactly — a transition would make it lag.
    &.is-swiping {
        transition: none;
    }

    // The whole toast is the target ("Playlist created" → open it).
    // As a <button> it would centre its text and take the button reset's
    // line-height; it must look exactly like every other toast.
    &.is-link {
        text-align: start;
        line-height: inherit;
        @include focus-ring;
    }

    &.has-action {
        grid-template-columns: 2rem 3fr max-content;
        padding-right: $medium;
    }

    // A word button, so the pill role (handDrawnPlates.test.ts). It was a frame
    // and a pointer by hand: no shadow on the one plate inside a toast that
    // casts one, a 31px target, and the retired blush as its hover. The panel
    // fill reads on all three toast colours; it is theme-aware, so the label is
    // too — the role's static ink is only legal on a static accent.
    .notif-action {
        @include btn-pill($fill: $mem-panel);
        color: $mem-content-text;
    }

    @include smallestPhones {
        max-width: calc(100% - 2rem);
    }
}

.new-notif.success,
.new-notif.favorite {
    background-color: $candy-pink;
    // Blush accent fill → pin static ink for the text + icon.
    color: $mem-ink;

    .notif-icon {
        color: $mem-ink;
    }
}

.new-notif.error {
    // Coral is the danger hue — yellow is reserved for active/playing states.
    background-color: $mem-coral;
    // Static light text/icon on the coral fill (the panel var would go dark).
    color: $mem-panel-static;

    .notif-icon {
        color: $mem-panel-static;
    }
}
</style>
