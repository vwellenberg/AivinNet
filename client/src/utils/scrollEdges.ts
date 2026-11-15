/**
 * Which edges of a scroller still have content beyond them.
 *
 * `top`: the list is scrolled away from its first row.
 * `bottom`: more rows follow below the visible part.
 *
 * The 1px slack absorbs sub-pixel rounding, so a list resting exactly at its
 * end does not report a phantom edge. Pure, so the sidebar's fade classes can
 * be tested without a DOM.
 */
export function scrollEdges(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number
): { top: boolean; bottom: boolean } {
  return {
    top: scrollTop > 1,
    bottom: scrollTop + clientHeight < scrollHeight - 1,
  }
}
