// Edge auto-scroll for HTML5 drag-and-drop inside a scroll container.
//
// Reordering a playlist by dragging a row is painful when the target sits off
// screen: the browser does NOT auto-scroll during a native drag, so the user
// has to hold the drag AND two-finger-scroll the touchpad at the same time —
// which is janky because every scroll frame re-recycles the virtual list. The
// fix is the standard drag UX: when the pointer nears the top/bottom edge of
// the scroller, scroll it automatically at a speed that ramps up the deeper
// into the edge zone the pointer is. The scroll is driven by a single
// requestAnimationFrame loop, so its smoothness is DECOUPLED from how often the
// (throttled, bursty) dragover event fires.

export interface EdgeScrollOptions {
  /** Height of the hot zone at each edge, in px (default 64). */
  zone?: number
  /** Scroll speed at the very edge / beyond it, in px per frame (default 22). */
  maxSpeed?: number
  /** Scroll speed at the inner boundary of the zone, in px per frame (default 4). */
  minSpeed?: number
}

const DEFAULT_ZONE = 64
const DEFAULT_MAX_SPEED = 22
const DEFAULT_MIN_SPEED = 4

/**
 * Pure velocity calculation for edge auto-scroll.
 *
 * Given the pointer's Y position and the scroll container's bounding rect,
 * returns the scroll velocity in px per frame:
 *   - negative -> scroll up (pointer in the top zone)
 *   - positive -> scroll down (pointer in the bottom zone)
 *   - 0        -> pointer outside both zones
 *
 * The magnitude ramps linearly from `minSpeed` at the inner edge of the zone to
 * `maxSpeed` at the container border, and clamps to `maxSpeed` beyond the
 * border (so dragging past the edge keeps top speed). On very short containers
 * the zone is capped at half the height so the two zones never overlap.
 */
export function computeEdgeScrollVelocity(
  pointerY: number,
  rectTop: number,
  rectHeight: number,
  options: EdgeScrollOptions = {}
): number {
  const zone = options.zone ?? DEFAULT_ZONE
  const maxSpeed = options.maxSpeed ?? DEFAULT_MAX_SPEED
  const minSpeed = options.minSpeed ?? DEFAULT_MIN_SPEED

  const effectiveZone = Math.min(zone, rectHeight / 2)
  if (effectiveZone <= 0) return 0

  const rectBottom = rectTop + rectHeight

  // Depth into the top zone (positive once past the inner boundary).
  const topDepth = rectTop + effectiveZone - pointerY
  if (topDepth > 0) {
    const t = Math.min(topDepth / effectiveZone, 1)
    return -(minSpeed + (maxSpeed - minSpeed) * t)
  }

  // Depth into the bottom zone.
  const bottomDepth = pointerY - (rectBottom - effectiveZone)
  if (bottomDepth > 0) {
    const t = Math.min(bottomDepth / effectiveZone, 1)
    return minSpeed + (maxSpeed - minSpeed) * t
  }

  return 0
}

export interface DragAutoScroller {
  /** Feed the current pointer clientY (typically from a dragover event). */
  update(pointerY: number): void
  /** Stop scrolling and cancel the rAF loop (call on drop/dragend/leave). */
  stop(): void
}

/**
 * Wires {@link computeEdgeScrollVelocity} to a scroll container via a single
 * requestAnimationFrame loop. `getScrollEl` is called lazily each frame so the
 * element may mount/unmount without stale references.
 */
export function createDragAutoScroller(
  getScrollEl: () => HTMLElement | null,
  options: EdgeScrollOptions = {}
): DragAutoScroller {
  let rafId = 0
  let velocity = 0

  function tick() {
    rafId = 0
    if (velocity === 0) return

    const el = getScrollEl()
    if (!el) {
      velocity = 0
      return
    }

    el.scrollTop += velocity
    // Keep looping as long as we still want to scroll; the loop is self
    // sustaining so a stationary pointer at the edge keeps scrolling even
    // though dragover has gone quiet.
    rafId = requestAnimationFrame(tick)
  }

  function update(pointerY: number) {
    const el = getScrollEl()
    if (!el) {
      stop()
      return
    }

    const rect = el.getBoundingClientRect()
    velocity = computeEdgeScrollVelocity(pointerY, rect.top, rect.height, options)

    if (velocity !== 0 && rafId === 0) {
      rafId = requestAnimationFrame(tick)
    }
  }

  function stop() {
    velocity = 0
    if (rafId !== 0) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  return { update, stop }
}
