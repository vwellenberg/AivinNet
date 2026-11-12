import SongItem from '@/components/shared/SongItem.vue'
import { dropSources } from '@/enums'
import { Track } from '@/interfaces'
import { trackBandFade } from '@/utils/songItemMethods'

type SongItemProps = InstanceType<typeof SongItem>['$props']

/**
 * The props one row of the Now Playing queue hands to `SongItem`.
 *
 * Typed against the component on purpose. The rows are rendered through
 * `v-bind="item.props"` on a dynamic `<component>`, where nothing checks the
 * keys: the view passed `isQueueTrack` for years while the prop is spelled
 * `is_queue_track`. Vue only maps kebab-case to camelCase, never camelCase to
 * snake_case, so the flag never arrived and the row fell back to "current =
 * same trackhash" — a track that is in the queue twice was highlighted twice,
 * and the queue no longer said where it was.
 */
export function queueRowProps(track: Track, index: number, total: number) {
    return {
        track,
        index: index + 1,
        is_first: index === 0,
        is_last: index === total - 1,
        // The queue highlights a POSITION, not a track.
        is_queue_track: true,
        // These rows ARE the queue, so that is the drop source — not the label
        // of wherever the queue was originally filled from. The view overwrites
        // `track.index` with the queue position, so the index the drag carries
        // is a queue index.
        droppable: true,
        source: dropSources.queue,
        band_fade: trackBandFade(index + 1, total),
    } satisfies SongItemProps
}
