// Several throwaway stub components in one test file, props untyped on purpose.
/* eslint-disable vue/one-component-per-file, vue/require-prop-types */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'

import PlaylistList from '@/views/PlaylistList.vue'
import usePStore from '@/stores/pages/playlists'
import useSmartPlaylistsStore from '@/stores/pages/smartPlaylists'

const route = reactive({ name: 'Playlists', params: {}, query: {} as Record<string, string> })
const replace = vi.fn()

vi.mock('vue-router', async () => ({
  ...((await vi.importActual('vue-router')) as object),
  useRoute: () => route,
  useRouter: () => ({ replace }),
}))

// The cards are not what this test is about: a tile that shows its name is
// enough to count what the page renders.
vi.mock('@/components/PlaylistsList/PlaylistCard.vue', async () => {
  const { defineComponent, h } = await vi.importActual<typeof import('vue')>('vue')
  return {
    default: defineComponent({
      props: ['playlist'],
      render() {
        return h('div', { class: 'stub-card' }, (this as any).playlist.name)
      },
    }),
  }
})
vi.mock('@/components/PlaylistsList/SmartPlaylistCard.vue', async () => {
  const { defineComponent, h } = await vi.importActual<typeof import('vue')>('vue')
  return {
    default: defineComponent({
      props: ['playlist'],
      render() {
        return h('div', { class: 'stub-card smart' }, (this as any).playlist.name)
      },
    }),
  }
})

// Renders the link as a plain anchor (the sort menu no longer uses links).
const RouterLinkStub = defineComponent({
  props: ['to'],
  render() {
    return h('a', { class: 'router-link-stub' }, this.$slots.default?.())
  },
})

function playlist(id: number, name: string, pinned = false) {
  return {
    id,
    name,
    pinned,
    image: '',
    has_image: false,
    tracks: [],
    count: id,
    _last_updated: '',
    thumb: '',
    duration: 0,
    settings: {},
    images: [],
  } as any
}

function mountList() {
  return mount(PlaylistList, {
    global: {
      stubs: {
        // The head is not under test, but the search field stands in its
        // #lead slot on the desktop, so the stub renders that slot.
        Header: { render() { return h('div', this.$slots.lead?.()) } },
        NoItems: {
          props: ['flag', 'title'],
          render() {
            return this.flag ? h('div', { class: 'no-items' }, this.title) : null
          },
        },
        RouterLink: RouterLinkStub,
      },
    },
  })
}

const cardNames = (w: ReturnType<typeof mountList>) =>
  w.findAll('.stub-card').map(c => c.text())

describe('Playlists page: search and sort', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    route.query = {}
    const store = usePStore()
    store.playlists = [
      playlist(1, 'Road Trip'),
      playlist(2, 'Café Jazz'),
      playlist(3, 'Workout', true),
      playlist(4, 'Sleep'),
    ]
    useSmartPlaylistsStore().playlists = [] as any
  })

  it('renders one sort menu, showing Name by default, next to the search field', () => {
    const w = mountList()
    const menus = w.findAll('.smdropdown')
    expect(menus.length).toBe(1)
    expect(menus[0].find('.selected').text()).toBe('Sort: Name')
    expect(w.find('input[type="search"]').attributes('aria-label')).toBe('Search playlists')
  })

  it('the menu offers all seven keys in order', async () => {
    const w = mountList()
    await w.find('.smdropdown .selected').trigger('click')
    const options = w.findAll('.smdropdown .option').map(o => o.text())
    expect(options).toEqual([
      'Name',
      'No. of tracks',
      'Duration',
      'Last updated',
      'Last played',
      'Plays',
      'Play duration',
    ])
  })

  it('picking an option writes the sort into the URL with the new key’s start direction', async () => {
    const w = mountList()
    await w.find('.smdropdown .selected').trigger('click')
    const plays = w.findAll('.smdropdown .option').find(o => o.text() === 'Plays')!
    await plays.trigger('click')
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ query: { sortby: 'playcount', reverse: '1' } }),
    )
  })

  it('the Pinned caption carries the pin icon, the other captions do not', () => {
    const w = mountList()
    const captions = w.findAll('.playlistcardgroup h3')
    const pinned = captions.find(c => c.text() === 'Pinned')!
    const other = captions.find(c => c.text() === 'Other Playlists')!
    expect(pinned.find('svg').exists()).toBe(true)
    expect(other.find('svg').exists()).toBe(false)
  })

  it('default order is name ascending, pinned group first', () => {
    const w = mountList()
    // Pinned comes from its own group, then the rest by name.
    expect(cardNames(w)).toEqual(['Workout', 'Café Jazz', 'Road Trip', 'Sleep'])
  })

  it('typing narrows the rendered cards across the groups, accent-insensitively', async () => {
    const w = mountList()
    await w.find('input[type="search"]').setValue('cafe')
    expect(cardNames(w)).toEqual(['Café Jazz'])

    await w.find('input[type="search"]').setValue('  WORK ')
    expect(cardNames(w)).toEqual(['Workout'])
  })

  it('shows a "no match" message when nothing matches but playlists exist', async () => {
    const w = mountList()
    await w.find('input[type="search"]').setValue('zzz')
    expect(cardNames(w)).toEqual([])
    expect(w.find('.no-items').text()).toBe('No playlists match “zzz”')
  })

  it('a library without playlists hides the search and the sort menu and says so', () => {
    usePStore().playlists = []
    const w = mountList()
    expect(w.find('input[type="search"]').exists()).toBe(false)
    expect(w.find('.smdropdown').exists()).toBe(false)
    expect(w.find('.no-items').text()).toBe('No playlists found')
  })

  it('a sort in the URL reorders the cards without touching the store', async () => {
    route.query = { sortby: 'count', reverse: '1' }
    const w = mountList()
    // count = id in the fixture: descending puts Sleep (4) before Café (2)
    // before Road Trip (1) in the "Other" group; Workout is its own group.
    expect(cardNames(w)).toEqual(['Workout', 'Sleep', 'Café Jazz', 'Road Trip'])
    // The store's array keeps its order: the sidebar shares it.
    expect(usePStore().playlists.map(p => p.name)).toEqual(['Road Trip', 'Café Jazz', 'Workout', 'Sleep'])
  })
})
