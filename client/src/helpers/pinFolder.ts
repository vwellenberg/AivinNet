import { pinUnpinFolder } from '@/requests/folders'
import usePinnedFolders from '@/stores/pages/pinnedFolders'
import { NotifType, useToast } from '@/stores/notification'

/**
 * Pin/unpin a music folder in the library sidebar.
 *
 * A fresh pin is read back from the server instead of being built here: the
 * server decides the stored spelling (resolved, so a folder reached through a
 * symlink is one pin) and counts the tracks, and neither is known on the client.
 *
 * @returns true if the server call succeeded.
 */
export async function toggleFolderPin(path: string): Promise<boolean> {
    const result = await pinUnpinFolder(path)
    if (result === null) {
        useToast().showNotification("Couldn't change the folder's pin", NotifType.Error)
        return false
    }

    const store = usePinnedFolders()
    if (result.pinned) {
        await store.fetchAll()
    } else {
        store.removeFolder(result.path)
    }

    return true
}
