import { nextTick, onMounted, onUnmounted, ref, type Ref } from 'vue'

/**
 * Which ends of a horizontal scroller still have content beyond them, and a
 * way to move it by a page.
 *
 * Shared by every row that scrolls sideways AND shows it: the stat tiles and
 * the chart tab plates on /stats. The row scrolls natively (wheel, trackpad,
 * touch); `canPrev`/`canNext` drive the edge fade and the arrows, which only
 * appear where there is something to scroll to. On a phone a cut-off tab at
 * the edge reads as a clipped layout, not as "more this way" (user,
 * 2026-11-18 for the tiles, 2026-11-23 for the period tabs).
 *
 * The caller binds `sync` to the scroller's `scroll` event and calls it again
 * after its content changes; window resizes are handled here.
 */
export default function useScrollEdges(el: Ref<HTMLElement | null>) {
    const canPrev = ref(false)
    const canNext = ref(false)

    function sync() {
        const box = el.value
        if (!box) return
        canPrev.value = box.scrollLeft > 1
        canNext.value = box.scrollLeft + box.clientWidth < box.scrollWidth - 1
    }

    function page(dir: 1 | -1) {
        el.value?.scrollBy({ left: dir * el.value.clientWidth * 0.8, behavior: 'smooth' })
    }

    onMounted(() => {
        nextTick(sync)
        // Tab labels are words: their width changes once the web font is in,
        // which no resize announces.
        document.fonts?.ready.then(sync)
        window.addEventListener('resize', sync)
    })
    onUnmounted(() => window.removeEventListener('resize', sync))

    return { canPrev, canNext, sync, page }
}
