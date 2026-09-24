// The arithmetic of reordering a list by dragging one row with a finger (the
// playlist edit mode, components/PlaylistView/EditList.vue).
//
// All rows are the same height, so the dragged row's travel alone decides where
// it lands, and every other row either stays or steps one row out of the way.
// Kept pure so it can be tested without a DOM: jsdom lays nothing out, every
// height there is 0.

/**
 * The travel clamped to the list: the row can go up to the top slot and down
 * to the bottom one, never past either end.
 */
export function clampTravel(from: number, travel: number, rowHeight: number, count: number): number {
  if (rowHeight <= 0 || count <= 0) return 0
  const min = -from * rowHeight
  const max = (count - 1 - from) * rowHeight
  return Math.max(min, Math.min(max, travel))
}

/**
 * The slot the row lands in — an index into the list as it will be AFTER the
 * move. It changes once the row has travelled half a row, the point at which it
 * covers more of the next slot than of its own.
 */
export function landingIndex(from: number, travel: number, rowHeight: number, count: number): number {
  if (rowHeight <= 0 || count <= 0) return from
  const clamped = clampTravel(from, travel, rowHeight, count)
  return Math.max(0, Math.min(count - 1, from + Math.round(clamped / rowHeight)))
}

/**
 * How far row `i` moves to make room while the row from `from` hovers over
 * `to`: the rows between the two step one row towards the gap it left.
 */
export function makeRoomShift(i: number, from: number, to: number, rowHeight: number): number {
  if (i === from) return 0
  if (from < to && i > from && i <= to) return -rowHeight
  if (to < from && i >= to && i < from) return rowHeight
  return 0
}

/**
 * Translate a move made in the list ON SCREEN into the store's terms.
 *
 * The screen can show fewer rows than the store holds — the edit mode hides a
 * row whose removal is still waiting for its undo to run out — so the two
 * indices differ. The move is therefore expressed by what it means: the row
 * lands in front of whichever visible row follows it afterwards. `gap` is that
 * row's index in `all` (or `all.length` at the very end), which is exactly the
 * drop-gap convention `resolveMove()` and the playlist store take
 * (utils/playlistMove.ts). Rows are compared by reference, never by trackhash:
 * a playlist may hold the same track twice.
 *
 * Returns null when there is nothing to move.
 */
export function landingGap<T>(all: T[], visible: T[], from: number, to: number): { from: number; gap: number } | null {
  if (from === to || from < 0 || from >= visible.length || to < 0 || to >= visible.length) return null

  const moved = visible[from]
  const next = visible.filter((_, i) => i !== from)[to]

  const fromAll = all.indexOf(moved)
  if (fromAll === -1) return null

  const gap = next === undefined ? all.length : all.indexOf(next)
  if (gap === -1) return null

  return { from: fromAll, gap }
}
