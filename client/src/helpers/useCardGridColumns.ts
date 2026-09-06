import { useElementSize } from '@vueuse/core'
import { computed, Ref } from 'vue'

import { maxAbumCards, win_width } from '@/stores/content-width'
import { cardColumns } from '@/utils/cardColumns'

/**
 * The column count a cover-card grid actually renders, measured from the grid
 * itself (or a zero-height probe of the same width) and run through the CSS
 * auto-fill mirror (utils/cardColumns.ts).
 *
 * Every consumer that PARTITIONS items into rows must use this count, never
 * `maxAbumCards`: the grids carry a column gap ($card-col-gap), and the fetch
 * heuristic deliberately ignores it — near the breakpoints it lands one above
 * the real column count, and the surplus card of every group wraps into a
 * ragged second line inside its row. `maxAbumCards` stays as the pre-measure
 * fallback only.
 */
export default function useCardGridColumns(el: Ref<HTMLElement | null>) {
    const { width } = useElementSize(el)

    return computed(() => {
        if (!width.value) return maxAbumCards.value

        return cardColumns(width.value, win_width.value)
    })
}
