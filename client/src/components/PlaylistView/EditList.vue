<template>
    <!-- The playlist's edit mode: every track, in stored order, with a grip to
         move it and a button to remove it. The pattern phones already know for
         reordering a playlist — built for the finger, where the rows' mouse
         drag (HTML5 drag-and-drop in SongItem.vue) does not reach: a long press
         on a row opens its menu instead.

         Not virtualised, on purpose. A row that is being dragged must not be
         recycled while the list scrolls under it, and the edit rows are light
         (no menus, no links, no hover machinery). -->
    <div ref="root" class="p-edit-list">
        <ol class="edit-list" :class="{ 'is-dragging': drag !== null, 'is-settling': settling }" aria-label="Tracks">
            <li
                v-for="(track, i) in rows"
                :key="keyOf(track)"
                class="songlist-item rounded-sm edit-row"
                :class="[
                    trackBandClass(i),
                    {
                        'is-last': i === rows.length - 1,
                        'is-lifted': drag?.from === i,
                        'is-dropped': dropped === keyOf(track),
                    },
                ]"
                :style="{ '--band-fade': trackBandFade(i + 1, rows.length), transform: transformOf(i) }"
                :data-trackhash="track.trackhash"
            >
                <button
                    type="button"
                    class="edit-remove"
                    :aria-label="`Remove ${track.title} from the playlist`"
                    @click="remove(track)"
                >
                    <span aria-hidden="true"></span>
                </button>
                <img class="edit-cover" :src="imguri + track.image" alt="" draggable="false" loading="lazy" />
                <div class="edit-meta">
                    <div class="edit-title ellip">{{ track.title }}</div>
                    <div class="edit-artist ellip">{{ artistLine(track) }}</div>
                </div>
                <button
                    type="button"
                    class="edit-grip"
                    :aria-label="`Move ${track.title}, position ${i + 1} of ${rows.length}`"
                    aria-describedby="p-edit-grip-help"
                    @pointerdown="startDrag($event, i)"
                    @keydown="onGripKey($event, i)"
                >
                    <span aria-hidden="true"></span>
                </button>
            </li>
        </ol>
        <p id="p-edit-grip-help" class="edit-sr">Drag the handle, or use the arrow keys, to move the track.</p>
        <p class="edit-sr" aria-live="polite">{{ announcement }}</p>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, toRaw } from 'vue'

import { paths } from '@/config'
import { NotifType } from '@/enums'
import { movePlaylistTrackTo, removePlaylistTrack } from '@/helpers/playlistTrackEdits'
import { Track } from '@/interfaces'
import usePlaylistStore from '@/stores/pages/playlist'
import { Notification } from '@/stores/notification'
import { clampTravel, landingGap, landingIndex, makeRoomShift } from '@/utils/dragReorder'
import { createDragAutoScroller } from '@/utils/dragAutoScroll'
import { trackBandClass, trackBandFade } from '@/utils/songItemMethods'

const playlist = usePlaylistStore()
const imguri = paths.images.thumb.small

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * Tracks the user has removed but the server has not been told about yet — the
 * undo is still on offer — plus those whose removal is in flight. They leave
 * the screen at once and the store only when the server has agreed.
 */
const hidden = shallowReactive(new Set<Track>())
const rows = computed(() => playlist.allTracks.filter(t => !hidden.has(t)))

// Keys by object identity: a playlist may hold the same track (same hash)
// twice, and a key by position would hand one row's DOM to another mid-drag.
const keys = new WeakMap<object, number>()
let nextKey = 1
function keyOf(track: Track): number {
    const raw = toRaw(track)
    let key = keys.get(raw)
    if (key === undefined) {
        key = nextKey++
        keys.set(raw, key)
    }
    return key
}

function artistLine(track: Track): string {
    return (track.artists || []).map(a => a.name).join(', ')
}

const announcement = ref('')

// The row that just landed flashes once, so the eye can find it again.
const dropped = ref<number | null>(null)
let droppedTimer: ReturnType<typeof setTimeout> | undefined
function flash(track: Track) {
    dropped.value = keyOf(track)
    clearTimeout(droppedTimer)
    droppedTimer = setTimeout(() => (dropped.value = null), 400)
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

/**
 * A move is in flight. The next one waits for it: a failed move rolls back by
 * index (utils/playlistMove.ts), and a second move landing in between would
 * make those indices point at the wrong rows.
 */
const busy = ref(false)

async function move(from: number, to: number): Promise<void> {
    const visible = rows.value
    const moved = visible[from]
    const target = landingGap(playlist.allTracks, visible, from, to)
    if (!target || !moved) return

    busy.value = true
    // The store reorders synchronously inside this call (the move is
    // optimistic), before the request goes out.
    const done = movePlaylistTrackTo(target.from, target.gap)
    flash(moved)
    announcement.value = `${moved.title}: position ${to + 1} of ${visible.length}`
    await done
    busy.value = false
}

// Arrow keys on a focused grip move the row one step — the keyboard's way to do
// what the finger does with the grip.
async function onGripKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    if (busy.value || drag.value) return

    const to = i + (e.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= rows.value.length) return

    const moved = rows.value[i]
    await move(i, to)
    focusGrip(moved)
}

async function focusGrip(track: Track) {
    await nextTick()
    const key = keyOf(track)
    const index = rows.value.findIndex(t => keyOf(t) === key)
    const grips = listEl()?.querySelectorAll<HTMLElement>('.edit-grip')
    grips?.[index]?.focus({ preventScroll: true })
}

// ---------------------------------------------------------------------------
// Dragging by the grip
// ---------------------------------------------------------------------------

interface Drag {
    from: number
    to: number
    pointerId: number
    startY: number
    lastY: number
    startScroll: number
    rowHeight: number
    travel: number
}

const drag = ref<Drag | null>(null)
// One frame without transitions after a drop: the store has already reordered
// the rows, and animating them back from their make-room offsets would show
// the old order for a moment.
const settling = ref(false)

// $song-item-height. Only used when layout reports nothing (jsdom).
const FALLBACK_ROW_HEIGHT = 72

const scroller = () => document.getElementById('contentscroller')
const root = ref<HTMLElement>()
const listEl = () => root.value
// A little calmer than the mouse drag's defaults: a thumb covers what it is
// about to scroll into view.
const autoScroll = createDragAutoScroller(scroller, { zone: 80, maxSpeed: 16 })

function startDrag(e: PointerEvent, i: number) {
    if (drag.value || busy.value) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()

    const grip = e.currentTarget as HTMLElement
    const row = grip.closest('li')
    drag.value = {
        from: i,
        to: i,
        pointerId: e.pointerId,
        startY: e.clientY,
        lastY: e.clientY,
        startScroll: scroller()?.scrollTop ?? 0,
        rowHeight: row?.offsetHeight || FALLBACK_ROW_HEIGHT,
        travel: 0,
    }

    // Keep the pointer on the grip: without the capture a finger that leaves
    // the grip's box would hand its moves to whatever lies under it.
    try {
        grip.setPointerCapture?.(e.pointerId)
    } catch {
        // No active pointer to capture (a synthetic event) — the window
        // listeners below still see every move.
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    scroller()?.addEventListener('scroll', followFinger, { passive: true })
    navigator.vibrate?.(10)
}

// Where the row is now. The list scrolling under a still finger moves the row
// through it just as much as the finger does, so both count.
function followFinger() {
    const d = drag.value
    if (!d) return
    const scrolled = (scroller()?.scrollTop ?? d.startScroll) - d.startScroll
    const count = rows.value.length
    d.travel = clampTravel(d.from, d.lastY - d.startY + scrolled, d.rowHeight, count)
    d.to = landingIndex(d.from, d.travel, d.rowHeight, count)
}

function onPointerMove(e: PointerEvent) {
    const d = drag.value
    if (!d || e.pointerId !== d.pointerId) return
    d.lastY = e.clientY
    followFinger()
    autoScroll.update(e.clientY)
}

function onPointerUp(e: PointerEvent) {
    if (drag.value && e.pointerId === drag.value.pointerId) endDrag(true)
}

function onPointerCancel(e: PointerEvent) {
    if (drag.value && e.pointerId === drag.value.pointerId) endDrag(false)
}

function endDrag(commit: boolean) {
    const d = drag.value
    if (!d) return

    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    scroller()?.removeEventListener('scroll', followFinger)
    autoScroll.stop()

    const moved = rows.value[d.from]
    settling.value = true
    drag.value = null
    requestAnimationFrame(() => (settling.value = false))

    if (commit && d.to !== d.from) move(d.from, d.to)
    if (moved) focusGrip(moved)
}

function transformOf(i: number): string | undefined {
    const d = drag.value
    if (!d) return undefined
    // The row in the hand tilts; the tilt is the app's "picked up" (#143).
    if (i === d.from) return `translateY(${d.travel}px) rotate(-1.2deg)`
    const shift = makeRoomShift(i, d.from, d.to, d.rowHeight)
    return shift ? `translateY(${shift}px)` : undefined
}

// ---------------------------------------------------------------------------
// Removing, with undo
// ---------------------------------------------------------------------------

// The undo stays on offer as long as the toast carrying it does
// (stores/notification.ts keeps an action toast for 8 s).
const UNDO_MS = 8000

let pending: { track: Track; timer: ReturnType<typeof setTimeout> } | null = null

function remove(track: Track) {
    // One undo at a time: a second removal settles the first.
    commitPending()

    hidden.add(track)
    const timer = setTimeout(commitPending, UNDO_MS)
    pending = { track, timer }

    announcement.value = `Removed ${track.title}`
    new Notification(`Removed “${track.title}”`, NotifType.Info, {
        label: 'Undo',
        handler: () => undo(track),
    })
}

function undo(track: Track) {
    // Too late once it has gone to the server — the toast can outlive the
    // commit by a frame.
    if (pending?.track !== track) return
    clearTimeout(pending.timer)
    pending = null
    hidden.delete(track)
    announcement.value = `Restored ${track.title}`
}

function commitPending() {
    if (!pending) return
    const { track, timer } = pending
    clearTimeout(timer)
    pending = null

    const index = playlist.allTracks.indexOf(track)
    if (index === -1) {
        hidden.delete(track)
        return
    }

    // The row stays hidden while the request runs; if the server refuses, it
    // comes back (the request reports the failure itself).
    removePlaylistTrack(index, false).then(() => hidden.delete(track))
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(async () => {
    if (!playlist.editFocus) return
    await nextTick()
    // Opened from a track's menu: start where that track is.
    // Trackhashes are hex, safe inside the quoted attribute value.
    const row = listEl()?.querySelector<HTMLElement>(`[data-trackhash="${playlist.editFocus}"]`)
    row?.scrollIntoView({ block: 'center' })
    const focused = rows.value.find(t => t.trackhash === playlist.editFocus)
    if (focused) flash(focused)
})

onBeforeUnmount(() => {
    // Leaving — "Done", another page, another playlist — settles what is
    // still waiting for its undo; the removal was asked for.
    if (drag.value) endDrag(false)
    commitPending()
    clearTimeout(droppedTimer)
})

defineExpose({ commitPending })
</script>

<style lang="scss">
.p-edit-list {
    // The list's frame closes at the bottom like the normal list's.
    padding-bottom: $medium;
}

.edit-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

// The row is a song row (`.songlist-item` — plate, band, perforation, frame
// come from SongItem.vue and app-grid.scss), laid out for editing: remove,
// cover, title, grip. The grid needs `!important` to beat the song row's own
// responsive grids, which carry it too.
.edit-list .songlist-item.edit-row {
    grid-template-columns: $bar-control 3rem minmax(0, 1fr) $bar-control !important;
    gap: 0.75rem;
    padding-left: $songlist-lead;
    padding-right: $small;
    cursor: default;
}

.edit-list.is-dragging .edit-row:not(.is-lifted) {
    transition: transform $motion-move $motion-curve-settle;
}

.edit-list.is-settling .edit-row {
    transition: none !important;
}

// The row in the hand: lifted off the list on its own plate, with the hard
// shadow grown (#143, the app's drag state).
.edit-list .edit-row.is-lifted {
    position: relative;
    z-index: 5;
    background-color: $mem-panel;
    background-image: none !important;
    border: $candy-border;
    border-radius: $candy-radius-sm;
    @include candy-shadow(6px, 6px);
}

.edit-list .edit-row.is-dropped {
    // The ripple's length: the same "something landed here" beat.
    animation: edit-row-landed $motion-ripple $motion-curve;
}

@keyframes edit-row-landed {
    from {
        background-color: $mem-yellow;
    }
}

.edit-row .edit-cover {
    width: 3rem;
    height: 3rem;
    object-fit: contain;
    border: $candy-border;
    border-radius: $candy-radius-sm;
    @include candy-shadow(3px, 3px);
    transform: rotate(-2.5deg);
    // An image drags on its own in some browsers; the grip is the only handle.
    pointer-events: none;
}

.edit-row .edit-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.edit-row .edit-title {
    font-weight: 700;
}

.edit-row .edit-artist {
    font-size: small;
    opacity: 0.67;
}

.edit-row .edit-remove,
.edit-row .edit-grip {
    @include btn-quiet($size: $bar-control);
}

// A coral disc with an ink bar: "take this out". Static fills, so the ink is
// right in both themes (see the token note in Global/_buttons.scss).
.edit-row .edit-remove > span {
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    background: linear-gradient($mem-ink, $mem-ink) center / 55% 2.5px no-repeat, $mem-coral;
    border: $candy-border-w solid $mem-ink;
}

// Three ink lines: the grip every phone draws on a row that can be moved.
.edit-row .edit-grip {
    cursor: grab;
    // The finger on the grip moves the ROW, never the page.
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

.p-edit-list .edit-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
}
</style>
