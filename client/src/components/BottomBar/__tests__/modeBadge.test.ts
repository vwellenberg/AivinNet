import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The phone bar's mode badge: shown only in the phone bar, only while shuffle
// or repeat-one is on, and a tap turns those back off. The settings store is
// the real one, so the group path (`ds.intercept`) is the one under test.

const { dsMock, queueMock } = vi.hoisted(() => ({
    dsMock: { joined: false, applying: false, intercept: vi.fn() },
    queueMock: {
        currenttrackhash: 'h1',
        currenttrack: { trackhash: 'h1', title: 'Song', image: 'x.webp', artists: [], albumartists: [] },
        currenttrackIsFav: false,
        playing: false,
        toggleShuffle: vi.fn(),
    },
}))

vi.mock('@/stores/devicesync', async () => {
    const { reactive: r } = await import('vue')
    const state = r(dsMock)
    return { default: () => state }
})
vi.mock('@/stores/queue', () => ({ default: () => queueMock }))
vi.mock('@/stores/player', () => ({
    audioSource: { playingSource: { src: '' } },
    getUrl: () => '',
    usePlayer: () => ({}),
    buffering: ref(false),
}))
vi.mock('@/stores/content-width', async () => {
    const { ref: r, computed: c } = await import('vue')
    const phoneFlag = r(true)
    return {
        phoneFlag,
        isPhoneBar: c(() => phoneFlag.value),
        isMobile: c(() => true),
        isLargerMobile: c(() => false),
    }
})
vi.mock('@/router', () => ({ router: {}, Routes: { nowPlaying: 'NowPlaying', Lyrics: 'Lyrics' } }))

import useSettings from '@/stores/settings'
import Left from '@/components/BottomBar/Left.vue'
import * as contentWidth from '@/stores/content-width'

// The mock above exports the flag the bar reads; the real module does not.
const { phoneFlag } = contentWidth as unknown as { phoneFlag: Ref<boolean> }

// The cover link renders as a plain anchor, so "the button is not inside it"
// is a DOM fact and not a router one.
const mountBar = () =>
    mount(Left, {
        global: {
            stubs: {
                RouterLink: { template: '<a class="np-link"><slot /></a>' },
                HotKeys: true,
                DevicesButton: true,
                HeartSvg: true,
                MasterFlag: true,
                PlayingMeter: true,
                ArtistName: true,
                Actions: true,
                ExplicitIcon: true,
            },
        },
    })

const badge = (w: ReturnType<typeof mountBar>) => w.find('button.mode-badge')

beforeEach(() => {
    setActivePinia(createPinia())
    phoneFlag.value = true
    dsMock.joined = false
    dsMock.applying = false
    dsMock.intercept.mockClear()
    queueMock.toggleShuffle.mockClear()
})

describe('mode badge: when it shows', () => {
    it('is hidden in the default state (repeat all, no shuffle)', () => {
        expect(badge(mountBar()).exists()).toBe(false)
    })

    it('is hidden for repeat none', () => {
        const settings = useSettings()
        settings.repeat = 'none'

        expect(badge(mountBar()).exists()).toBe(false)
    })

    it('shows for shuffle with its own label and one glyph', async () => {
        const settings = useSettings()
        settings.shuffle = true
        const w = mountBar()

        expect(badge(w).attributes('aria-label')).toBe('Shuffle on — turn off')
        expect(w.find('button.mode-badge svg').exists()).toBe(true)
        expect(w.findAll('button.mode-badge svg')).toHaveLength(1)
    })

    it('shows for repeat one with its own label', () => {
        useSettings().repeat = 'one'
        const w = mountBar()

        expect(badge(w).attributes('aria-label')).toBe('Repeat one on — turn off')
        expect(w.findAll('button.mode-badge svg')).toHaveLength(1)
    })

    it('shows ONE pill with both glyphs when shuffle and repeat one are on', () => {
        const settings = useSettings()
        settings.shuffle = true
        settings.repeat = 'one'
        const w = mountBar()

        expect(w.findAll('button.mode-badge')).toHaveLength(1)
        expect(badge(w).attributes('aria-label')).toBe('Shuffle and repeat one on — turn off')
        expect(w.findAll('button.mode-badge svg')).toHaveLength(2)
    })

    it('appears and disappears as the mode changes', async () => {
        const settings = useSettings()
        const w = mountBar()
        expect(badge(w).exists()).toBe(false)

        settings.shuffle = true
        await w.vm.$nextTick()
        expect(badge(w).exists()).toBe(true)

        settings.shuffle = false
        await w.vm.$nextTick()
        expect(badge(w).exists()).toBe(false)
    })

    it('is never shown on desktop, even with shuffle on', () => {
        phoneFlag.value = false
        const settings = useSettings()
        settings.shuffle = true
        settings.repeat = 'one'

        expect(badge(mountBar()).exists()).toBe(false)
    })
})

describe('mode badge: placement', () => {
    it('is a sibling of the cover link, not inside it, so a tap does not navigate', () => {
        useSettings().shuffle = true
        const w = mountBar()
        const el = badge(w).element as HTMLElement

        expect(el.tagName).toBe('BUTTON')
        expect(el.closest('a')).toBeNull()
        expect(el.parentElement?.classList.contains('np-cover')).toBe(true)
        expect(w.find('a.np-link').element.contains(el)).toBe(false)
    })
})

describe('mode badge: tap', () => {
    it('turns shuffle off through the queue', async () => {
        useSettings().shuffle = true
        const w = mountBar()

        await badge(w).trigger('click')

        expect(queueMock.toggleShuffle).toHaveBeenCalledTimes(1)
    })

    it('turns repeat one back to all', async () => {
        const settings = useSettings()
        settings.repeat = 'one'
        const w = mountBar()

        await badge(w).trigger('click')

        expect(settings.repeat).toBe('all')
        expect(queueMock.toggleShuffle).not.toHaveBeenCalled()
    })

    it('turns both off in one tap', async () => {
        const settings = useSettings()
        settings.shuffle = true
        settings.repeat = 'one'
        const w = mountBar()

        await badge(w).trigger('click')

        expect(queueMock.toggleShuffle).toHaveBeenCalledTimes(1)
        expect(settings.repeat).toBe('all')
    })

    it('leaves repeat none alone when only shuffle is being turned off', async () => {
        const settings = useSettings()
        settings.shuffle = true
        settings.repeat = 'none'
        const w = mountBar()

        await badge(w).trigger('click')

        expect(settings.repeat).toBe('none')
    })

    it('in a group, sends the repeat change through device sync and does not set it locally', async () => {
        const settings = useSettings()
        settings.repeat = 'one'
        dsMock.joined = true
        const w = mountBar()

        await badge(w).trigger('click')

        expect(dsMock.intercept).toHaveBeenCalledWith('toggleRepeat', 'all')
        expect(settings.repeat).toBe('one')
    })

    it('while mirroring another device, writes repeat directly and sends nothing', async () => {
        const settings = useSettings()
        settings.repeat = 'one'
        dsMock.joined = true
        dsMock.applying = true
        const w = mountBar()

        await badge(w).trigger('click')

        expect(dsMock.intercept).not.toHaveBeenCalled()
        expect(settings.repeat).toBe('all')
    })
})
