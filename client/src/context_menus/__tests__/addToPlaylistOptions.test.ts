import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Option, Playlist } from '@/interfaces'

const getAllPlaylistsMock = vi.fn()

vi.mock('@/requests/playlists', () => ({ getAllPlaylists: () => getAllPlaylistsMock() }))
vi.mock('@/stores/modal', () => ({ default: () => ({ showNewPlaylistModal: vi.fn() }) }))
vi.mock('@/stores/pages/artist', () => ({ default: () => ({ info: { name: '' } }) }))
vi.mock('@/icons', () => ({ SearchIcon: {} }))

import { getAddToPlaylistOptions } from '@/context_menus/utils'
import { recordRecentPlaylist } from '@/utils/recentPlaylists'

const playlist = (id: number, name: string) => ({ id, name }) as Playlist
const labels = (options: Option[]) => options.map(o => (o.type === 'separator' ? '—' : o.label))

describe('"Add to playlist" suggestions', () => {
    beforeEach(() => {
        localStorage.clear()
        getAllPlaylistsMock.mockResolvedValue([playlist(1, 'Chill'), playlist(2, 'Gym'), playlist(9, 'Road trip')])
    })

    it('puts a playlist that was just created on top, above the full list', async () => {
        recordRecentPlaylist(2) // something was added to "Gym" earlier
        recordRecentPlaylist(9) // then "Road trip" was created (createNewPlaylist records it)

        const options = await getAddToPlaylistOptions(() => {})
        expect(labels(options)).toEqual(['New playlist', '—', 'Road trip', 'Gym', '—', 'Chill', 'Gym', 'Road trip'])
    })

    it('offers "New playlist" alone when the playlists could not be loaded', async () => {
        getAllPlaylistsMock.mockResolvedValue(null)

        const options = await getAddToPlaylistOptions(() => {})
        expect(labels(options)).toEqual(['New playlist'])
    })
})
