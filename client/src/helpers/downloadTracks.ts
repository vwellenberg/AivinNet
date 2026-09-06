import { getBaseUrl, paths } from '@/config'
import { Track } from '@/interfaces'
import { NotifType, Notification } from '@/stores/notification'

/**
 * Milliseconds between downloads.
 *
 * The server answers ONE request at a time, so firing a whole album at once
 * would queue every other listener behind it. This is also what keeps browsers
 * from treating the burst as a popup attack — they throttle or silently drop
 * rapid-fire downloads.
 */
const GAP_MS = 400

/**
 * Download each track as its own file, one after another.
 *
 * The alternative — and what the other menu entry still does — is a ZIP. On a
 * desktop that is the better shape: one file, album intact. On a phone it is
 * the worse one: it lands in Downloads, needs an unzip app, and the files end
 * up somewhere the music player may never index.
 *
 * Individual files skip all of that. They arrive playable, and since the server
 * names them from the tags (`Artist - Album - 07 Title.mp3`) they stay
 * identifiable even lying loose in one folder.
 *
 * ⚠️ No progress bar is possible here. A browser download started this way is
 * fire-and-forget: the page is not told when it finishes, or whether it did.
 * Reading the bytes in JavaScript instead would give us progress and cost us
 * the whole album in memory — the exact trade the backend just stopped making.
 * So the notifications count what was STARTED, and say so.
 */
export async function downloadTracksIndividually(tracks: Track[], what: string) {
    if (!tracks.length) {
        new Notification(`${what} has no tracks to download`, NotifType.Error)
        return
    }

    new Notification(
        `Starting ${tracks.length} downloads — your browser may ask to allow multiple files`,
    )

    for (const track of tracks) {
        const a = document.createElement('a')
        a.href = getBaseUrl() + paths.api.download + `/track/${track.trackhash}`

        // Appended before clicking: a detached anchor works for a single click
        // in most browsers, but not reliably for a series of them.
        document.body.appendChild(a)
        a.click()
        a.remove()

        await new Promise(resolve => setTimeout(resolve, GAP_MS))
    }

    new Notification(`${tracks.length} downloads started`, NotifType.Success)
}
