import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { paths } from '@/config'
import useAxios from '@/requests/useAxios'

import { Artist } from '@/interfaces'

/**
 * Everything whose name does not start with A–Z shares one key at the front of
 * the band: digits, "...Und Null Sekunden", the japanese names. Twenty-odd
 * artists that would otherwise be unreachable by letter.
 */
export const OTHER = '#'

export const LETTERS = [OTHER, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]

/**
 * Letters that carry their mark INSIDE the glyph rather than as a combining
 * accent. NFD decomposes "Ó" into O + ◌́ and the accent strips away, but "Ø"
 * has no canonical decomposition at all — it would stay under "#" with the
 * digits, and the count on the O key would have been a lie about it.
 */
const FOLDED: Record<string, string> = {
    Ø: 'O',
    Ł: 'L',
    Đ: 'D',
    Ð: 'D',
    Æ: 'A',
    Œ: 'O',
    Ħ: 'H',
    Ŧ: 'T',
}

/**
 * The band key a name belongs under. Accents fold first, the same way the
 * search store folds them: without that, "Ólafur Arnalds" and "Édith Piaf"
 * land under "#" next to the digits, which is neither where anyone looks for
 * them nor what the count on the O and E keys promised.
 */
export function initialOf(name: string): string {
    const raw = (name || '')
        .trim()
        .charAt(0)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toUpperCase()

    const first = FOLDED[raw] ?? raw

    return /^[A-Z]$/.test(first) ? first : OTHER
}

// The list is fetched whole (names, hashes and image paths — no tracks), so the
// band can state a count per letter and switching letters costs no request.
//
// The page size is large on purpose: the backend re-sorts its whole artist
// store per request, so pages are the expensive axis, not bytes. 2000 is one
// request for any library this app is likely to meet (~50 kB for 500 artists)
// and still bounded for the ones it is not.
const PAGE = 2000

export default defineStore('searchBrowse', () => {
    const artists = ref<Artist[]>([])
    const letter = ref<string | null>(null)
    const loading = ref(false)
    /** Guards against a second fetch while the first is still in flight. */
    const loaded = ref(false)
    const failed = ref(false)
    /**
     * When the list arrived. It goes stale after a while rather than latching
     * for the session: a scan or a tag edit adds and renames artists, and a
     * band whose counts are from before that is a list of promises it cannot
     * keep. Ten minutes is longer than any visit to this page and shorter than
     * the gap between two sessions of tagging.
     */
    let fetchedAt = 0
    const TTL = 10 * 60 * 1000

    /** How many artists sit under each band key. Keys with none are absent. */
    const counts = computed(() => {
        const map: Record<string, number> = {}
        for (const artist of artists.value) {
            const key = initialOf(artist.name)
            map[key] = (map[key] || 0) + 1
        }
        return map
    })

    /**
     * The selected letter's artists. The row renders as many as its grid has
     * columns (CardScroller), so this stays the whole group.
     *
     * There is no "all" state, and that is a measured decision rather than a
     * simplification: showing the list from the top means showing whatever
     * sorts first, and in a real library that is the "#" group — the opening
     * row read "…Und Null Sekunden, 01, 02, 03, 04", none of which is a band
     * anyone went looking for. A letter is always selected instead.
     */
    const shown = computed(() =>
        artists.value.filter(artist => initialOf(artist.name) === letter.value)
    )

    async function fetchArtists() {
        if (loading.value) return
        if (loaded.value && Date.now() - fetchedAt < TTL) return

        loading.value = true
        // `failed` is NOT cleared here: clearing it synchronously unmounted the
        // notice the retry button sits in, so the block went blank for the
        // whole attempt and the button's disabled state was unreachable. It is
        // cleared when the attempt actually succeeds.
        try {
            const all: Artist[] = []

            for (;;) {
                const { status, data } = await useAxios({
                    url:
                        paths.api.getall.artists +
                        `?start=${all.length}&limit=${PAGE}&sortby=name&reverse=0`,
                    method: 'GET',
                })

                // `useAxios` does not throw — it resolves with the status and
                // whatever body came back. A 500 read as "an empty page" would
                // have left the band permanently absent AND marked loaded, so
                // the failure has to be read off the status here.
                if (status !== 200 || !Array.isArray(data?.items) || typeof data.total !== 'number') {
                    failed.value = true
                    return
                }

                all.push(...data.items)

                // Done — including the empty library, where the first page is
                // empty and `total` is 0.
                if (all.length >= data.total) break

                // A page that comes back empty while `total` says there is
                // more ends the loop, or a mismatch between the two would spin
                // here forever. It is NOT a complete load though: committing a
                // truncated list as a good one would cache it for the whole
                // TTL, with every letter past the cut showing no count and
                // refusing to be pressed, and nothing to retry. Show what
                // arrived, leave `loaded` alone so the next visit tries again.
                if (!data.items.length) {
                    if (all.length) artists.value = all
                    else failed.value = true
                    return
                }
            }

            artists.value = all
            loaded.value = true
            failed.value = false
            fetchedAt = Date.now()

            // Open on the first LETTER that has anyone — "A" in any real
            // library. "#" is skipped here even though it sorts first: it is
            // the catch-all for digits and non-latin names, which is the one
            // group nobody opens the page hoping to see.
            //
            // Re-checked on EVERY load, not only the first: a refetch after a
            // tag edit or a rescan can empty the letter that was selected, and
            // the key then rendered pressed and disabled at once over a row of
            // placeholder tiles.
            //
            // Read off `counts`, which is one pass over the list; asking
            // `initialOf` per key per artist is 26 more of them, on the list
            // this store exists to keep whole.
            const tally = counts.value
            if (letter.value === null || !tally[letter.value]) {
                letter.value =
                    LETTERS.filter(key => key !== OTHER).find(key => tally[key]) ??
                    LETTERS.find(key => tally[key]) ??
                    null
            }
        } catch {
            // Belt and braces: `useAxios` swallows network errors, but a
            // malformed body could still throw somewhere in here.
            failed.value = true
        } finally {
            loading.value = false
        }
    }

    // No toggling back to "nothing selected": with no letter there is no row,
    // and a band whose second press empties the page below it is a trap, not a
    // shortcut.
    function selectLetter(key: string) {
        if (counts.value[key]) letter.value = key
    }

    return { artists, letter, loading, loaded, failed, counts, shown, fetchArtists, selectLetter }
})
