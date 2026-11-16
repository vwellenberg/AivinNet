/**
 * Cmd/Ctrl+F for pages whose list the browser's own find cannot search.
 *
 * Long lists render through a virtual scroller (only the rows in view exist in
 * the DOM) and load page by page, so the browser's find never sees a track
 * further down: it reported no match for a song that was in the playlist. A
 * page with its own search registers a handler here, and the shortcut opens
 * that search instead. Every other page keeps the browser's find.
 *
 * The handler answers whether it took the shortcut. When it declines (nothing
 * to search, or a mode whose list is a plain one), the browser's find opens as
 * usual — the shortcut is only swallowed when something answers it.
 */
type FindHandler = () => boolean

let handler: FindHandler | null = null

/** Register the page's search. Returns the matching unregister. */
export function registerPageFind(fn: FindHandler): () => void {
    handler = fn
    return () => {
        if (handler === fn) handler = null
    }
}

/** Cmd+F on macOS, Ctrl+F elsewhere — and not with Shift or Alt, which mean other things. */
export function isFindShortcut(e: KeyboardEvent): boolean {
    return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f'
}

/** Hand the shortcut to the page's search. True when it was taken (and the browser's find suppressed). */
export function handleFindShortcut(e: KeyboardEvent): boolean {
    if (!handler || !isFindShortcut(e)) return false
    if (!handler()) return false
    e.preventDefault()
    return true
}
