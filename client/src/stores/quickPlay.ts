import { ref } from 'vue'

/**
 * Open state of the Quick play box (Ctrl/Cmd+P, components/QuickPlay.vue).
 *
 * A plain module, not a store: useKeyboard opens the box without importing the
 * component, and the component is mounted once in App.vue.
 */
export const open = ref(false)

/**
 * Bumped on every open request. A request while the box is already open does
 * not change `open`, so the component watches this to re-focus its input.
 */
export const focusRequest = ref(0)

/**
 * Ctrl+P, or Cmd+P on macOS — not with Shift or Alt. `code` as well as `key`:
 * on a Cyrillic or Greek layout `key` is the local letter, and the browser's
 * print dialog opened instead.
 */
export function isQuickPlayShortcut(e: KeyboardEvent): boolean {
    return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'p' || e.code === 'KeyP')
}

export function openQuickPlay() {
    open.value = true
    focusRequest.value++
}

export function closeQuickPlay() {
    open.value = false
}
