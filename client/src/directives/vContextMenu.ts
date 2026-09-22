import type { Directive } from "vue";

// ---------------------------------------------------------------------------
// `v-context-menu="handler"` — the one way an element opens its context menu.
//
// It binds `contextmenu` (right-click, the context-menu key, Android's
// long-press) AND a long-press of its own, because iOS Safari never fires
// `contextmenu` for a touch. The tiles carry no ⋮ button by design
// (Global/cards.scss), so on an iPhone `@contextmenu` alone left every tile
// menu unreachable. Binding both in one place is the point: a tile cannot
// wire up the right-click and forget the touch (census: cardAnatomy.test.ts).
//
// The long-press hands the handler a real `contextmenu` MouseEvent, dispatched
// on the element — so `currentTarget` is set and the menu is anchored at the
// finger rather than falling back to the element's corner (stores/context.ts).
// ---------------------------------------------------------------------------

type Handler = (e: MouseEvent) => void;

/** How long a stationary finger has to stay down. The platform convention. */
export const LONG_PRESS_MS = 500;
/** How far it may drift before the gesture counts as a scroll or a drag. */
export const MOVE_TOLERANCE_PX = 10;
/** How long after the finger lifts a click still counts as that finger's. */
const CLICK_WINDOW_MS = 700;

interface State {
  handler: Handler;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Where the finger went down — null while no touch is in progress. */
  start: { x: number; y: number } | null;
  /**
   * The current (or just-lifted) touch has opened the menu — by our timer or
   * by the browser's own event. Reset only by the next touchstart: a gesture
   * that opened the menu stays "opened" even if a scroll or a drifting finger
   * cancels it afterwards.
   */
  fired: boolean;
  /** When that touch lifted — a `contextmenu` shortly after still belongs to it. */
  endedAt: number;
  /**
   * Until when a click is the lifted finger's and gets eaten — it would follow
   * the link. A deadline rather than a flag: when the browser honours the
   * cancelled touchend, no click comes at all, and a flag would sit there and
   * eat the next real one (a mouse click, Enter on the focused tile).
   */
  swallowUntil: number;
  unbind: () => void;
}

const states = new WeakMap<HTMLElement, State>();

function bind(el: HTMLElement, handler: Handler): State {
  const state: State = {
    handler,
    timer: undefined,
    start: null,
    fired: false,
    endedAt: 0,
    swallowUntil: 0,
    unbind: () => {},
  };

  const clearTimer = () => {
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
  };

  // The gesture ends without a menu: the finger moved, the page scrolled, a
  // second finger joined, or the browser took the touch over.
  const cancel = () => {
    clearTimer();
    state.start = null;
    window.removeEventListener("scroll", cancel, true);
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();

    // Android fires its own `contextmenu` for a long-press, at about the same
    // moment as the timer below; Chrome on a Windows touchscreen fires it only
    // on release, after touchend. Whichever comes first opens the menu; the
    // other would toggle it shut again (showContextMenu closes an open menu),
    // so it is dropped.
    const touching = state.start !== null;
    const justLifted = state.fired && Date.now() - state.endedAt <= CLICK_WINDOW_MS;
    if (touching || justLifted) {
      if (state.fired) return;
      state.fired = true;
      clearTimer();
    }

    state.handler(e);
  };

  const onTouchStart = (e: TouchEvent) => {
    cancel();
    state.fired = false;
    state.endedAt = 0;
    state.swallowUntil = 0;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    state.start = { x: touch.clientX, y: touch.clientY };
    // `scroll` does not bubble, but a capturing listener on window sees it
    // from every scroller — the card rows scroll sideways, the page downwards.
    window.addEventListener("scroll", cancel, { capture: true, passive: true });

    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (!state.start) return;
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: false,
          cancelable: true,
          clientX: state.start.x,
          clientY: state.start.y,
        })
      );
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!state.start) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - state.start.x;
    const dy = touch.clientY - state.start.y;
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) cancel();
  };

  const onTouchEnd = (e: TouchEvent) => {
    // `fired`, not `start`: once the menu is open, a scroll (the menu taking
    // focus can scroll) or a finger sliding towards it cancels the gesture —
    // and the click it would still produce must be eaten all the same.
    const opened = state.fired;
    cancel();
    // Cancelling touchend stops the browser from synthesising the mouse
    // events and the click for this touch — the click would follow the tile's
    // link and, a moment later, count as a click outside the menu that just
    // opened (ContextMenu.vue), closing it again.
    if (!opened) return;
    state.endedAt = Date.now();
    state.swallowUntil = state.endedAt + CLICK_WINDOW_MS;
    if (e.cancelable) e.preventDefault();
  };

  // Belt and braces for the same click, for a browser that sends it anyway.
  // Capture phase, so it runs before the RouterLink's own handler.
  const onClick = (e: MouseEvent) => {
    if (Date.now() > state.swallowUntil) return;
    state.swallowUntil = 0;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // Hook for the stylesheet (Global/basic.scss), which keeps the element
  // inert to the platform's own long-press — no iOS link preview or "Save
  // image" sheet, and on touch no selection handles. A stylesheet rather than
  // inline styles, so selection can stay on for the mouse.
  el.setAttribute("data-context-menu", "");

  el.addEventListener("contextmenu", onContextMenu);
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: true });
  el.addEventListener("touchend", onTouchEnd);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("click", onClick, true);

  state.unbind = () => {
    cancel();
    el.removeAttribute("data-context-menu");
    el.removeEventListener("contextmenu", onContextMenu);
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", cancel);
    el.removeEventListener("click", onClick, true);
  };

  return state;
}

const vContextMenu: Directive<HTMLElement, Handler> = {
  mounted(el, binding) {
    states.set(el, bind(el, binding.value));
  },
  updated(el, binding) {
    const state = states.get(el);
    if (state) state.handler = binding.value;
  },
  unmounted(el) {
    states.get(el)?.unbind();
    states.delete(el);
  },
};

export default vContextMenu;
