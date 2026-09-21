/**
 * Which keys a focused control keeps for itself, before the global shortcuts
 * (helpers/useKeyboard.ts) get to see them (#137).
 *
 * ⚠️ The global handler used to take Space everywhere except in text inputs and
 * call `preventDefault()` on it. That cancels a button's own activation — so for
 * anyone on a keyboard, Space did NOTHING on any button in the app and toggled
 * playback instead. Measured on the running build: Space on the album header's
 * overflow button, 0 clicks and 1 play/pause; Space on the sidebar folder
 * header, the folder toggled AND playback started.
 *
 * The line is drawn at how focus ARRIVED, not at focus. A mouse click also
 * leaves focus on a button, and whoever clicks something and then reaches for
 * Space still means "play/pause" — that habit stays. Only a control the
 * keyboard (or code acting for it) moved focus to keeps Space and Enter.
 *
 * ⚠️ Not `:focus-visible`. That was the first version, and it broke exactly the
 * habit above: Chrome turns `:focus-visible` ON the moment a key is pressed on
 * the focused element, so at keydown time it is true after a mouse click too.
 * Measured: master 1 play/pause after click + Space, that version 0.
 */

/** Elements and roles that answer Space/Enter themselves. */
export const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'select',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="link"]',
].join(', ')

const OWNED_KEYS = new Set([' ', 'Enter'])

export function controlOwnsKey(target: EventTarget | null, key: string, keyboardFocused: boolean): boolean {
  if (!OWNED_KEYS.has(key) || !keyboardFocused) return false
  return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null
}

// ---------------------------------------------------------------------------
// Where the current focus came from.
//
// A pointer press moves focus as its default action, in the same task, so a
// focus that lands within a short window after a pointerdown is mouse focus.
// Anything else — Tab, arrow keys in a menu, code that hands focus on — counts
// as keyboard focus.
// ---------------------------------------------------------------------------

const POINTER_FOCUS_WINDOW_MS = 300

let lastPointerDown = Number.NEGATIVE_INFINITY
let focusFromPointer = false

export function trackFocusOrigin(doc: Document = document): void {
  doc.addEventListener('pointerdown', () => (lastPointerDown = performance.now()), true)
  doc.addEventListener('mousedown', () => (lastPointerDown = performance.now()), true)
  doc.addEventListener(
    'focusin',
    () => (focusFromPointer = performance.now() - lastPointerDown < POINTER_FOCUS_WINDOW_MS),
    true
  )
}

export function focusCameFromKeyboard(): boolean {
  return !focusFromPointer
}

/** Test hook: forget the last pointer press. */
export function __resetFocusOrigin(): void {
  lastPointerDown = Number.NEGATIVE_INFINITY
  focusFromPointer = false
}
