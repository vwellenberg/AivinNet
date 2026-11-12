import type SongItem from '@/components/shared/SongItem.vue'
import { dropSources } from '@/enums'
import { Track } from '@/interfaces'
import { trackBandFade } from '@/utils/songItemMethods'

type SongItemProps = InstanceType<typeof SongItem>['$props']

/**
 * The props one row of the Now Playing queue hands to `SongItem`.
 *
 * Typed against the component on purpose. The rows are rendered through
 * `v-bind="item.props"` on a dynamic `<component>`, where nothing checks the
 * keys: the view passed `isQueueTrack` for years while the prop was spelled
 * `is_queue_track`. Vue only maps kebab-case to camelCase, never camelCase to
 * snake_case, so the flag never arrived and the row fell back to "current =
 * same trackhash" — a track that is in the queue twice was highlighted twice,
 * and the queue no longer said where it was.
 *
 * `queueIndex` is where the track sits in the queue; `number` is what the row
 * shows. They differ since the list is split into sections that each count
 * from 1.
 */
export function queueRowProps(track: Track, queueIndex: number, number: number, sectionTotal: number) {
    return {
        track,
        index: number,
        is_first: number === 1,
        is_last: number === sectionTotal,
        // The queue highlights a POSITION, not a track.
        queue_index: queueIndex,
        // These rows ARE the queue, so that is the drop source — not the label
        // of wherever the queue was originally filled from. The view overwrites
        // `track.index` with the queue position, so the index the drag carries
        // is a queue index.
        droppable: true,
        source: dropSources.queue,
        band_fade: trackBandFade(number, sectionTotal),
    } satisfies SongItemProps
}

export type QueueRow =
    | { kind: 'caption'; id: string; text: string; count?: number; open?: boolean }
    | { kind: 'track'; id: number; queueIndex: number; props: ReturnType<typeof queueRowProps> }
    | { kind: 'note'; id: string; text: string }

export interface QueueLayout {
    /**
     * Played / Now playing / Up next. Only true while the list order IS the
     * play order: under shuffle the next track is rolled at random, so "above
     * the marker" is not what played and "below it" is not what comes.
     */
    split: boolean
    /** Whether the played section is unfolded. */
    historyOpen: boolean
    /** Repeat-all: after the last track the queue starts over. */
    wraps: boolean
    /**
     * Whether the playing track gets a row of its own. Not on a phone: there the
     * player card fills the screen right above the list, and a row repeating
     * its title pushes "Up next" — what the list is opened for — further down.
     */
    showCurrent: boolean
}

/**
 * The rows of the Now Playing list, top to bottom.
 *
 * Track ids are queue positions in every layout, so unfolding the history adds
 * rows without renaming the ones already measured by the scroller.
 */
export function buildQueueRows(tracks: Track[], current: number, layout: QueueLayout): QueueRow[] {
    const row = (queueIndex: number, number: number, total: number): QueueRow => ({
        kind: 'track',
        id: queueIndex,
        queueIndex,
        props: queueRowProps(tracks[queueIndex], queueIndex, number, total),
    })

    // A position outside the list (empty queue, stale index) has no "before"
    // and "after" to split on.
    if (!layout.split || current < 0 || current >= tracks.length) {
        return tracks.map((_, index) => row(index, index + 1, tracks.length))
    }

    const rows: QueueRow[] = []

    if (current > 0) {
        rows.push({ kind: 'caption', id: 'played', text: 'Played', count: current, open: layout.historyOpen })
        if (layout.historyOpen) {
            for (let index = 0; index < current; index++) rows.push(row(index, index + 1, current))
        }
    }

    if (layout.showCurrent) {
        rows.push({ kind: 'caption', id: 'now', text: 'Now playing' })
        rows.push(row(current, 1, 1))
    }

    const upcoming = tracks.length - current - 1
    rows.push({ kind: 'caption', id: 'next', text: 'Up next', count: upcoming || undefined })
    for (let index = current + 1; index < tracks.length; index++) {
        rows.push(row(index, index - current, upcoming))
    }
    if (!upcoming) {
        rows.push({
            kind: 'note',
            id: 'end',
            text: layout.wraps && tracks.length > 1 ? 'Last track — the queue starts over after this one.' : 'Nothing queued after this one.',
        })
    }

    return rows
}
