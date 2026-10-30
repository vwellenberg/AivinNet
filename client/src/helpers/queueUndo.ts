import useDeviceSync from '@/stores/devicesync'
import { NotifType, useToast } from '@/stores/notification'

// ---------------------------------------------------------------------------
// "Removed … / Undo" for the queue (#644).
//
// Removing a row from the queue, or clearing it, happens at once — the audio,
// the shuffle bookkeeping and the group seam all follow the removal. The undo
// is therefore a RESTORE through the same store actions that did the removal
// (`insertAt`, and the restore actions beside it in stores/queue/tracklist.ts),
// not a second copy of the queue state. The toast is the existing action toast
// (`useToast().showNotification(…, { label, handler })`), the same one the
// playlist edit mode uses; its deferred-commit model does not fit here, because
// the queue cannot wait 6 s to be changed.
//
// Only the LATEST removal is undoable: a second one settles the first.
// ---------------------------------------------------------------------------

/** Lifetime of the undo toast and of the offer behind it. */
export const QUEUE_UNDO_MS = 6000

interface Pending {
    toast: number
    timer: ReturnType<typeof setTimeout> | undefined
    /** The queue as the removal left it. Undo only runs against exactly that state. */
    after: string
    read: () => string
    restore: () => void
}

let pending: Pending | null = null

/** Identity of a queue's content by trackhash, in order — what undo compares. */
export function trackKey(tracks: { trackhash: string }[]): string {
    return tracks.map(t => t.trackhash).join('\n')
}

function forget(entry: Pending) {
    clearTimeout(entry.timer)
    if (pending === entry) pending = null
}

/**
 * Offer to take back the change that was just made to the queue.
 *
 * `read` gives the queue's present content (by `trackKey`), `after` the content
 * the change left it with. If the queue has moved on in between — a track was
 * added, a row moved — the restore would put back a list nobody removed from,
 * so the undo is dropped instead.
 *
 * Callers must not offer in group mode (see `undoAvailable`).
 */
export function offerQueueUndo(opts: {
    text: string
    after: string
    read: () => string
    restore: () => void
}) {
    // A new removal replaces the undo state: the old toast's Undo would no longer
    // restore anything it can promise.
    if (pending) {
        clearTimeout(pending.timer)
        useToast().dismiss(pending.toast)
        pending = null
    }

    const entry: Pending = {
        toast: 0,
        timer: undefined,
        after: opts.after,
        read: opts.read,
        restore: opts.restore,
    }

    entry.toast = useToast().showNotification(
        opts.text,
        NotifType.Info,
        { label: 'Undo', handler: () => runUndo(entry) },
        undefined,
        QUEUE_UNDO_MS
    )

    entry.timer = setTimeout(() => forget(entry), QUEUE_UNDO_MS)
    pending = entry
}

/**
 * Whether a removal may be offered as an undo at all.
 *
 * Joined to a group the change went out as a broadcast, and taking it back
 * would have to broadcast again: the server's queue, the playing track and the
 * other devices would all have to follow a restore whose position is only known
 * here. Doing that half-right is the desync the seam exists to prevent, so a
 * group gets the plain toast (or none) instead. This also covers the mirror
 * applying a remote change (`applying`), which is never the person's to undo.
 */
export function undoAvailable(): boolean {
    return !useDeviceSync().joined
}

/**
 * The confirmation a group change gets instead of an undo: the same toast,
 * without the action, so the person still sees that the removal happened.
 */
export function confirmWithoutUndo(text: string) {
    useToast().showNotification(text, NotifType.Info)
}

function runUndo(entry: Pending) {
    // Lapsed (window over) or replaced by a newer removal: nothing to restore.
    if (pending !== entry) return
    forget(entry)

    // Joined since the removal: the restore would have to go out as a broadcast,
    // which this path does not do (see undoAvailable). Drop it, do nothing local.
    if (useDeviceSync().joined) return

    // The queue changed after the removal — something was added or moved. A
    // restore now would be a guess at the position.
    if (entry.read() !== entry.after) return

    entry.restore()
}
