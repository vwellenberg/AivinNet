import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The tuner reaches the queue, and the queue reaches the group seam. Stub the
// device-sync stand-in (flip joined per test), the player (real <audio> at
// import) and the request layer; the queue and tracklist stay real.
const { dsMock, getPlaylist, playStatic, showNotification, setDuck } = vi.hoisted(() => ({
    dsMock: { joined: false, applying: false, intercept: vi.fn() },
    getPlaylist: vi.fn(),
    playStatic: vi.fn(() => true),
    showNotification: vi.fn(),
    setDuck: vi.fn(),
}))

vi.mock('@/stores/devicesync', () => ({ default: () => dsMock }))
vi.mock('@/requests/playlists', () => ({ getPlaylist }))
vi.mock('@/utils/radioStatic', () => ({ STATIC_MS: 300, playStatic }))
vi.mock('@/stores/notification', () => ({ useToast: () => ({ showNotification }) }))
vi.mock('@/stores/player', () => ({
    usePlayer: () => ({ playCurrent() {}, clearNextAudio() {}, clearMovingNextTimeout() {}, setDuck }),
    audioSource: { playingSource: { src: '', paused: true, currentTime: 0 } },
    getUrl: () => '',
}))
vi.mock('@/stores/interface', () => ({ default: () => ({ focusCurrentInSidebar() {} }) }))
vi.mock('@/stores/pages/playlists', () => ({ default: () => ({ movePlayedToTop: vi.fn() }) }))

import { crackle, muteForTuning, resumeMusic, tuneStation } from '@/helpers/radio'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'

const station = (id: string, name = id, kind: 'mix' | 'genre' | 'decade' = 'mix') => ({ id, name, kind })
const track = (hash: string): any => ({ trackhash: hash, filepath: `/music/${hash}.mp3`, title: hash, duration: 1 })
const playlistOf = (id: string, hashes: string[]) => ({
    info: { id, name: `Playlist ${id}` },
    tracks: hashes.map(track),
})

/** Run the tune to its end, timers included. */
async function tune(s: ReturnType<typeof station>) {
    const done = tuneStation(s)
    await vi.runAllTimersAsync()
    await done
}

describe('the radio tuner', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        dsMock.joined = false
        dsMock.applying = false
        dsMock.intercept.mockReset()
        getPlaylist.mockReset()
        playStatic.mockClear()
        showNotification.mockClear()
        setDuck.mockClear()
    })

    it('tunes in alone: the static plays once, then the station starts from its first track', async () => {
        getPlaylist.mockResolvedValue(playlistOf('mix1', ['a', 'b']))

        await tune(station('mix1'))

        expect(getPlaylist).toHaveBeenCalledWith('mix1', false, 0, -1)
        expect(playStatic).toHaveBeenCalledTimes(1)
        expect(useTracklist().tracklist.map(t => t.trackhash)).toEqual(['a', 'b'])
        expect(useQueue().playing).toBe(true)
        expect(useQueue().currentindex).toBe(0)
    })

    it('fades the music out before the static and brings it back before the station starts', async () => {
        getPlaylist.mockResolvedValue(playlistOf('mix1', ['a']))

        await tune(station('mix1'))

        const levels = setDuck.mock.calls.map(([gain]) => gain)
        expect(levels[0]).toBeLessThan(1)
        expect(levels[levels.length - 1]).toBe(1)
        // Every fade step is between the two ends, never past them.
        expect(levels.every(gain => gain >= 0 && gain <= 1)).toBe(true)
    })

    it('goes through the group seam when a group is joined: intercept gets the station, the local queue does not play', async () => {
        dsMock.joined = true
        getPlaylist.mockResolvedValue(playlistOf('mix2', ['x', 'y', 'z']))
        // The tracklist is already set when the seam sees the play.
        dsMock.intercept.mockImplementation(() => {
            expect(useTracklist().tracklist.map(t => t.trackhash)).toEqual(['x', 'y', 'z'])
        })

        await tune(station('mix2'))

        expect(dsMock.intercept).toHaveBeenCalledWith('play', 0)
        expect(useQueue().playing).toBe(false)
    })

    it('a genre station plays through the same path as a mix: its playlist, then the queue', async () => {
        getPlaylist.mockResolvedValue(playlistOf('genre1', ['r1', 'r2']))

        await tune(station('genre1', 'rock', 'genre'))

        expect(getPlaylist).toHaveBeenCalledWith('genre1', false, 0, -1)
        expect(useTracklist().tracklist.map(t => t.trackhash)).toEqual(['r1', 'r2'])
        expect(useQueue().playing).toBe(true)
        expect(useQueue().currentindex).toBe(0)
    })

    it('a decade station in a group goes through the group seam, as a mix does', async () => {
        dsMock.joined = true
        getPlaylist.mockResolvedValue(playlistOf('decade1', ['d1', 'd2']))

        await tune(station('decade1', '1990s', 'decade'))

        expect(getPlaylist).toHaveBeenCalledWith('decade1', false, 0, -1)
        expect(dsMock.intercept).toHaveBeenCalledWith('play', 0)
        expect(useQueue().playing).toBe(false)
    })

    it('a newer tune supersedes an older one that is still on its way', async () => {
        getPlaylist.mockResolvedValue(playlistOf('mix2', ['b']))

        const first = tuneStation(station('mix1'))
        const second = tuneStation(station('mix2'))
        await vi.runAllTimersAsync()
        await Promise.all([first, second])

        expect(getPlaylist).toHaveBeenCalledTimes(1)
        expect(getPlaylist).toHaveBeenCalledWith('mix2', false, 0, -1)
    })

    it('a station with no tracks says so and leaves the music at full level', async () => {
        getPlaylist.mockResolvedValue(playlistOf('mix3', []))

        await tune(station('mix3', 'Mix 3'))

        expect(showNotification).toHaveBeenCalledWith('Mix 3 has no tracks yet', expect.anything())
        expect(setDuck).toHaveBeenLastCalledWith(1)
        expect(useQueue().playing).toBe(false)
    })

    it('a failed request is not reported as an empty station', async () => {
        getPlaylist.mockResolvedValue(undefined)

        await tune(station('mix4', 'Mix 4'))

        expect(showNotification).toHaveBeenCalledWith('Could not tune in Mix 4', expect.anything())
        expect(setDuck).toHaveBeenLastCalledWith(1)
    })

    it('muteForTuning ducks the music, resumeMusic brings it back', async () => {
        muteForTuning()
        await vi.runAllTimersAsync()
        expect(setDuck).toHaveBeenLastCalledWith(0)

        resumeMusic()
        await vi.runAllTimersAsync()
        expect(setDuck).toHaveBeenLastCalledWith(1)
    })

    it('crackle plays a static burst for one step of the dial', () => {
        crackle()

        expect(playStatic).toHaveBeenCalledTimes(1)
    })
})
