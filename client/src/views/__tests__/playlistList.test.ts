import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'

import PlaylistList from '@/views/PlaylistList.vue'
import usePStore from '@/stores/pages/playlists'
import useSmartPlaylistsStore from '@/stores/pages/smartPlaylists'

const route = reactive({ name: 'Playlists', params: {}, query: {} as Record<string, string> })

vi.mock('vue-router', async () => ({
  ...((await vi.importActual('vue-router')) as object),
  useRoute: () => route,
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

// Renders the link as a plain anchor so the chips can be counted and clicked.
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
        Header: true,
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

  it('renders the sort chips, name first, and no search hit set', () => {
    const w = mountList()
    const chips = w.findAll('.itemsortby .select').map(c => c.text())
    expect(chips).toEqual(
      expect.arrayContaining(['Name', 'No. of tracks', 'Duration', 'Last updated', 'Last played', 'Plays', 'Play duration']),
    )
    expect(w.find('input[type="search"]').attributes('aria-label')).toBe('Search playlists')
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

  it('a library without playlists hides the search and chips and says so', () => {
    usePStore().playlists = []
    const w = mountList()
    expect(w.find('input[type="search"]').exists()).toBe(false)
    expect(w.findAll('.itemsortby').length).toBe(0)
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
