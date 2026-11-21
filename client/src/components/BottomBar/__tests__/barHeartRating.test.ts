import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The desktop bar's heart rates the PLAYING track on right-click (user,
// 2026-11-21). Mounted through the real Left.vue, so the wiring is under test:
// the hash comes from the queue, the fallback from the queue's copy of the
// track, and the click still goes to the favourite handler.

const { queueMock, setTrackRating } = vi.hoisted(() => ({
    queueMock: {
        currenttrackhash: '9f86d081884c7d65',
        currenttrack: {
            trackhash: '9f86d081884c7d65',
            title: 'Echo Beach',
            image: '9f86d081884c7d65.webp?pathhash=4a1f0c',
            artists: [{ name: 'Martha and the Muffins', artisthash: 'b6589fc6ab0dc82c' }],
            albumartists: [{ name: 'Martha and the Muffins', artisthash: 'b6589fc6ab0dc82c' }],
            rating: 3,
            bitrate: 320,
        },
        currenttrackIsFav: true,
        playing: true,
        toggleShuffle: vi.fn(),
    },
    setTrackRating: vi.fn(),
}))

vi.mock('@/requests/rating', () => ({
    setTrackRating,
    clearTrackRating: vi.fn(),
    getAllTrackRatings: vi.fn(),
}))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false, intercept: vi.fn() }) }))
vi.mock('@/stores/queue', () => ({ default: () => queueMock }))
vi.mock('@/stores/player', () => ({
    audioSource: { playingSource: { src: '' } },
    getUrl: () => '',
    usePlayer: () => ({}),
    buffering: ref(false),
}))
vi.mock('@/stores/content-width', async () => {
    const { computed: c } = await import('vue')
    return {
        isPhoneBar: c(() => false),
        isMobile: c(() => false),
        isLargerMobile: c(() => false),
        isSmallPhone: c(() => false),
    }
})
vi.mock('@/router', () => ({ router: {}, Routes: { nowPlaying: 'NowPlaying', Lyrics: 'Lyrics' } }))

import vContextMenu from '@/directives/vContextMenu'
import useRatings, { __resetRatingsTestState } from '@/stores/ratings'
import Left from '@/components/BottomBar/Left.vue'

const mountBar = () =>
    mount(Left, {
        attachTo: document.body,
        global: {
            directives: { 'context-menu': vContextMenu, tooltip: {}, 'auto-animate': {} },
            stubs: {
                RouterLink: { template: '<a><slot /></a>' },
                HotKeys: true,
                DevicesButton: true,
                MasterFlag: true,
                PlayingMeter: true,
                ArtistName: true,
                MarqueeText: { template: '<span><slot /></span>' },
                Actions: true,
                ExplicitIcon: true,
            },
        },
    })

let bar: ReturnType<typeof mountBar> | null = null

beforeEach(() => {
    setActivePinia(createPinia())
    __resetRatingsTestState()
    setTrackRating.mockReset().mockResolvedValue(true)
})

afterEach(() => {
    bar?.unmount()
    bar = null
    document.body.innerHTML = ''
})

describe('player bar heart: rating', () => {
    it('rates the playing track from a right-click, without toggling the favourite', async () => {
        bar = mountBar()
        const rate = vi.spyOn(useRatings(), 'rate')
        const heart = bar.find('button.np-fav')
        expect(heart.exists()).toBe(true)

        heart.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 870 }))
        await flushPromises()
        const stars = document.querySelectorAll<HTMLButtonElement>('.heart-rating-picker .rating-star')
        expect(stars).toHaveLength(5)
        // The queue's copy is rated 3: that star is the pressed one.
        expect(stars[2].getAttribute('aria-pressed')).toBe('true')

        stars[4].click()
        await flushPromises()

        expect(rate).toHaveBeenCalledWith('9f86d081884c7d65', 5, 3)
        expect(setTrackRating).toHaveBeenCalledWith('9f86d081884c7d65', 5)
        expect(bar.emitted('handleFav')).toBeUndefined()
        expect(bar.find('button.np-fav').attributes('title')).toContain('Rated 5 of 5')
    })

    it('still sends a click to the favourite handler', async () => {
        bar = mountBar()

        await bar.find('button.np-fav').trigger('click')

        expect(bar.emitted('handleFav')).toHaveLength(1)
    })
})

describe('player bar heart: both hosts', () => {
    // The phone bar's larger-phone group (Right.vue) renders the other heart of
    // the bar. Both must take the rating gesture, or it works on one screen only.
    it.each(['Left.vue', 'Right.vue'])('%s renders the bar heart as RatableHeart on the playing track', file => {
        const src = readFileSync(`src/components/BottomBar/${file}`, 'utf8')
        const template = src.slice(0, src.indexOf('<script'))

        expect(template).not.toMatch(/<HeartSvg\b/)
        expect(template).toMatch(/<RatableHeart[^>]*:trackhash="queue\.currenttrackhash"/s)
        expect(template).toMatch(/<RatableHeart[^>]*:rating="queue\.currenttrack\?\.rating \?\? null"/s)
    })
})
