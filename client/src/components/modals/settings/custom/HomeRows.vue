<template>
    <!-- Settings → Home (#532): every Home row with a switch, the movable ones
         with a grip. Saved as it changes; the server keeps the layout per user
         and leaves a hidden row out of what it sends. -->
    <div ref="root" class="home-rows">
        <p v-if="failed" class="home-rows-note">Your Home rows could not be loaded.</p>
        <template v-else-if="rows.length">
            <ol class="home-rows-list is-pinned">
                <li v-for="row in pinned" :key="row.key" class="layout-row" :class="{ 'is-hidden': !row.visible }">
                    <div class="layout-row-text">
                        <div class="layout-row-title">{{ row.title }}</div>
                        <div class="layout-row-desc">Always on top</div>
                    </div>
                    <Switch :state="row.visible" :aria-label="`Show ${row.title} on Home`" @click="toggle(row.key)" />
                </li>
            </ol>

            <ol ref="list" class="home-rows-list" :class="{ settling }">
                <li
                    v-for="(row, i) in movable"
                    :key="row.key"
                    class="layout-row"
                    :class="{ 'is-lifted': liftedKey === row.key, 'is-hidden': !row.visible }"
                >
                    <button
                        type="button"
                        class="layout-row-grip"
                        :aria-label="`Move ${row.title}, position ${i + 1} of ${movable.length}`"
                        aria-describedby="home-rows-grip-help"
                        @pointerdown="startDrag($event, i)"
                        @keydown="onGripKey($event, i)"
                    >
                        <span aria-hidden="true"></span>
                    </button>
                    <div class="layout-row-text">
                        <div class="layout-row-title">{{ row.title }}</div>
                        <div v-if="row.description" class="layout-row-desc">{{ row.description }}</div>
                    </div>
                    <Switch :state="row.visible" :aria-label="`Show ${row.title} on Home`" @click="toggle(row.key)" />
                </li>
            </ol>

            <p id="home-rows-grip-help" class="home-rows-sr">Drag the handle, or use the arrow keys, to move a row.</p>
            <p class="home-rows-sr" aria-live="polite">{{ announcement }}</p>
            <button type="button" class="btn-pill home-rows-reset" :disabled="resetting" @click="reset">
                Reset to default
            </button>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import Switch from '@/components/SettingsView/Components/Switch.vue'
import { getHomeLayout, HomeLayoutRow, setHomeLayout } from '@/requests/home'
import useHome from '@/stores/home'
import { useToast } from '@/stores/notification'
import { createDragAutoScroller } from '@/utils/dragAutoScroll'
import { clampSlotTravel, landingSlot, Slot, slotShift } from '@/utils/dragReorder'
import { layoutPayload, movableRows, moveRow, toggleRow } from '@/utils/homeLayout'

const rows = ref<HomeLayoutRow[]>([])
const failed = ref(false)
const announcement = ref('')
const pinned = computed(() => rows.value.filter(row => row.pinned))
const movable = computed(() => movableRows(rows.value))

const toasts = useToast()
const home = useHome()

// Only the first load asks: a save outlives the panel (closing Settings right
// after a change must not drop it, nor Home's refresh after it).
let alive = true
onBeforeUnmount(() => {
    alive = false
    endDrag(false)
})

onMounted(async () => {
    const res = await getHomeLayout()
    if (!alive) return
    if (res.status === 200) {
        rows.value = res.data.rows
        confirmed = res.data.rows
    } else {
        failed.value = true
    }
})

// ---------------------------------------------------------------------------
// Saving: every change goes out at once, the latest one wins. A change made
// while a save is on its way is sent after it, so a quick second toggle is
// never lost; a refused save puts back the last layout the server kept.
// ---------------------------------------------------------------------------

type Payload = () => ReturnType<typeof layoutPayload>

let confirmed: HomeLayoutRow[] = []
let inflight = false
// What goes out next. Every change replaces it, so the latest one wins — and
// a reset made while a save is on its way goes out as a reset, not as the
// rows on screen.
let next: Payload | null = null
// The reset has no rows on screen to change until the server answers with
// the default: a switch or a move meanwhile would be made on the old layout
// and undo the reset, so they wait.
const resetting = ref(false)

async function save(payload: Payload = () => layoutPayload(rows.value)) {
    next = payload
    if (inflight) return

    inflight = true
    try {
        while (next) {
            const { order, hidden } = next()
            next = null
            const res = await setHomeLayout(order, hidden)

            if (res.status !== 200) {
                next = null
                // A drag holds the rows by their place on screen: let go
                // before they are put back in the order the server kept.
                endDrag(false)
                rows.value = confirmed
                toasts.showError('Could not save your Home rows')
                return
            }

            confirmed = res.data.rows
            // A newer change is still to go: keep it on screen, send it next.
            if (!next) rows.value = res.data.rows
        }
    } finally {
        inflight = false
        resetting.value = false
    }

    // Home is behind the settings window, or the next page: it gets the new
    // rows without a reload.
    home.refreshIfLoaded()
}

function toggle(key: string) {
    if (resetting.value) return
    rows.value = toggleRow(rows.value, key)
    const row = rows.value.find(r => r.key === key)
    if (row) announcement.value = `${row.title}: ${row.visible ? 'shown' : 'hidden'} on Home`
    save()
}

function move(from: number, to: number) {
    if (resetting.value) return
    const moved = movable.value[from]
    rows.value = moveRow(rows.value, from, to)
    announcement.value = `${moved.title}: position ${to + 1} of ${movable.value.length}`
    save()
}

function reset() {
    if (resetting.value) return
    resetting.value = true
    // The default is the server's to know: an empty layout is the default.
    save(() => ({ order: [], hidden: [] }))
}

// Arrow keys on a focused grip move the row one step — the keyboard's way to
// do what the finger does with the grip.
async function onGripKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    if (drag || resetting.value) return

    const to = i + (e.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= movable.value.length) return

    const key = movable.value[i].key
    move(i, to)
    focusGrip(key)
}

async function focusGrip(key: string) {
    await nextTick()
    const index = movable.value.findIndex(row => row.key === key)
    list.value?.querySelectorAll<HTMLElement>('.layout-row-grip')[index]?.focus({ preventScroll: true })
}

// ---------------------------------------------------------------------------
// Dragging by the grip — built like the playlist edit mode
// (components/PlaylistView/EditList.vue), but these rows differ in height (a
// description, or one that wraps on a phone), so the arithmetic works on the
// rows as laid out when the drag began (`Slot`s, utils/dragReorder.ts). A
// dozen rows, but the transforms still go straight onto the elements: they
// change with every move of the finger, and only the drop is a change of the
// layout.
// ---------------------------------------------------------------------------

interface Drag {
    from: number
    to: number
    pointerId: number
    startY: number
    lastY: number
    startScroll: number
    slots: Slot[]
    travel: number
    els: HTMLElement[]
    scroller: HTMLElement | null
}

let drag: Drag | null = null
const liftedKey = ref<string | null>(null)
// One frame without transitions after a drop: the rows are already in their
// new order, and animating them back from their make-room offsets would show
// the old one for a moment.
const settling = ref(false)
const root = ref<HTMLElement>()
const list = ref<HTMLElement>()

/** The settings window's content scrolls, not the page: find what does. */
function scrollParent(el: HTMLElement | undefined): HTMLElement | null {
    for (let node = el?.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node)
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
    }
    return null
}

const autoScroll = createDragAutoScroller(() => drag?.scroller ?? null, { zone: 64, maxSpeed: 12 })

function startDrag(e: PointerEvent, i: number) {
    if (drag || resetting.value) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()

    const els = Array.from(list.value?.children ?? []) as HTMLElement[]
    const scroller = scrollParent(root.value)
    drag = {
        from: i,
        to: i,
        pointerId: e.pointerId,
        startY: e.clientY,
        lastY: e.clientY,
        startScroll: scroller?.scrollTop ?? 0,
        slots: els.map(el => ({ top: el.offsetTop, height: el.offsetHeight })),
        travel: 0,
        els,
        scroller,
    }
    liftedKey.value = movable.value[i].key

    try {
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
        // No active pointer to capture (a synthetic event): the window
        // listeners below still see every move.
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    scroller?.addEventListener('scroll', followFinger, { passive: true })
}

function followFinger() {
    const d = drag
    if (!d) return
    const scrolled = (d.scroller?.scrollTop ?? d.startScroll) - d.startScroll
    d.travel = clampSlotTravel(d.slots, d.from, d.lastY - d.startY + scrolled)

    const before = d.to
    d.to = landingSlot(d.slots, d.from, d.travel)
    d.els[d.from].style.transform = `translateY(${d.travel}px) rotate(-1.2deg)`

    if (d.to !== before) {
        const lo = Math.min(before, d.to, d.from)
        const hi = Math.max(before, d.to, d.from)
        for (let i = lo; i <= hi; i++) {
            if (i === d.from) continue
            const shift = slotShift(d.slots, i, d.from, d.to)
            d.els[i].style.transform = shift ? `translateY(${shift}px)` : ''
        }
    }
}

function onPointerMove(e: PointerEvent) {
    const d = drag
    if (!d || e.pointerId !== d.pointerId) return
    d.lastY = e.clientY
    followFinger()
    autoScroll.update(e.clientY)
}

function onPointerUp(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) endDrag(true)
}

function onPointerCancel(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) endDrag(false)
}

function endDrag(commit: boolean) {
    const d = drag
    if (!d) return
    drag = null

    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    d.scroller?.removeEventListener('scroll', followFinger)
    autoScroll.stop()

    settling.value = true
    for (const el of d.els) el.style.transform = ''
    requestAnimationFrame(() => (settling.value = false))
    liftedKey.value = null

    if (!commit || !alive) return
    const key = movable.value[d.from]?.key
    if (d.to !== d.from) move(d.from, d.to)
    if (key) focusGrip(key)
}
</script>

<style lang="scss">
.home-rows {
    display: grid;
    gap: $small;
    width: 100%;

    .home-rows-list {
        display: grid;
        gap: $small;
        margin: 0;
        padding: 0;
        list-style: none;

        > li {
            transition: transform $motion-move $motion-curve;
        }

        &.settling > li {
            transition: none;
        }
    }

    // A plate around a grip and a switch, not a control itself — the grip and
    // the switch are the buttons. Framed like every plate in this panel, so it
    // casts the static shadow the user cards do (Accounts.vue).
    .layout-row {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr) max-content;
        align-items: center;
        gap: $medium;
        min-height: $bar-control;
        padding: $small $medium $small $small;
        @include candy-box($mem-panel, $candy-radius-sm);
        @include candy-shadow(3px, 3px);

        &.is-lifted {
            position: relative;
            z-index: 1;
            transition: none;
        }

        // A hidden row reads as off, not as gone: it stays in its place.
        &.is-hidden .layout-row-text {
            opacity: 0.55;
        }
    }

    // The pinned row has no grip: its text starts where the grips would end.
    .home-rows-list.is-pinned .layout-row {
        grid-template-columns: minmax(0, 1fr) max-content;
        padding-left: $medium;
    }

    .layout-row-title {
        font-weight: 700;
    }

    .layout-row-desc {
        margin-top: 2px;
        font-size: 0.8rem;
        color: $mem-content-faint;
    }

    // Three ink lines: the grip every phone draws on a row that can be moved.
    .layout-row-grip {
        @include btn-quiet($size: $bar-control);
        color: inherit;
        cursor: grab;
        // The finger on the grip moves the ROW, never the window.
        touch-action: none;

        &:active {
            cursor: grabbing;
        }

        > span {
            width: 1.4rem;
            height: 1rem;
            background:
                linear-gradient(currentColor, currentColor) top / 100% 2.5px no-repeat,
                linear-gradient(currentColor, currentColor) center / 100% 2.5px no-repeat,
                linear-gradient(currentColor, currentColor) bottom / 100% 2.5px no-repeat;
        }
    }

    .home-rows-reset {
        justify-self: start;
        margin-top: $small;
    }

    .home-rows-note {
        margin: 0;
        color: $mem-content-faint;
    }

    .home-rows-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
    }
}
</style>
