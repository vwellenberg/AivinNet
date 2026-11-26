import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const route = { name: 'AlbumList', query: {} as Record<string, string> }
const replace = vi.fn()

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
vi.mock('@/router', () => ({ Routes: { AlbumList: 'AlbumList', ArtistList: 'ArtistList' }, router: {} }))

import SortBanner from '@/components/CardListView/SortBanner.vue'
import { useAlbumList } from '@/stores/pages/itemlist'

async function openMenu() {
  const w = mount(SortBanner)
  await w.find('.smdropdown .selected').trigger('click')
  return w
}

describe('Albums/Artists sort menu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    replace.mockClear()
    route.name = 'AlbumList'
  })

  it('is one menu that names the current sort, not a row of chips', () => {
    const w = mount(SortBanner)
    expect(w.findAll('.smdropdown').length).toBe(1)
    expect(w.find('.itemsortby').exists()).toBe(false)
    // The store's default: newest first.
    expect(w.find('.smdropdown .selected').text()).toBe('Sort: Date added')
  })

  it('offers the album keys on Albums and the artist keys on Artists', async () => {
    expect((await openMenu()).findAll('.option').map(o => o.text())).toEqual([
      'Title', 'Artist', 'Year released', 'No. of tracks', 'Duration', 'Date added', 'Last played', 'Plays', 'Play duration',
    ])
    route.name = 'ArtistList'
    expect((await openMenu()).findAll('.option').map(o => o.text())).toEqual([
      'Name', 'No. of albums', 'No. of tracks', 'Duration', 'Date added', 'Last played', 'Plays', 'Play duration',
    ])
  })

  it('a pick writes the sort into the URL: titles A to Z, the active key flips', async () => {
    let w = await openMenu()
    await w.findAll('.option').find(o => o.text() === 'Title')!.trigger('click')
    expect(replace).toHaveBeenLastCalledWith({ name: 'AlbumList', query: { sortby: 'title', reverse: '0' } })

    useAlbumList().sortby = 'playcount'
    useAlbumList().reverse = true
    w = await openMenu()
    await w.findAll('.option').find(o => o.text() === 'Plays')!.trigger('click')
    expect(replace).toHaveBeenLastCalledWith({ name: 'AlbumList', query: { sortby: 'playcount', reverse: '0' } })
  })
})
