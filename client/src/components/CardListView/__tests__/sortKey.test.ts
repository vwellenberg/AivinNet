import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import SortKey from '@/components/CardListView/SortKey.vue'

const route = reactive({ name: 'X', params: {}, query: {} as Record<string, string> })

vi.mock('vue-router', async () => ({
  ...((await vi.importActual('vue-router')) as object),
  useRoute: () => route,
}))

const ITEMS = [
  { key: 'name', displayName: 'Name' },
  { key: 'count', displayName: 'No. of tracks' },
]

function linkReverse(props: Record<string, unknown>, key: string) {
  const w = mount(SortKey, {
    props: { items: ITEMS, ...props } as any,
    global: { stubs: { RouterLink: RouterLinkStub }, mocks: { $route: route } },
  })
  const link = w.findAllComponents(RouterLinkStub).find(l => l.text().startsWith(ITEMS.find(i => i.key === key)!.displayName))!
  return (link.props('to') as { query: { reverse: string } }).query.reverse
}

describe('SortKey: which direction the active chip flips to', () => {
  it('the album and artist lists flip the URL value, as before (#872 leaves them alone)', () => {
    route.query = {}
    // No `reverse` in the URL reads as "1" on those pages: a click gives "0".
    expect(linkReverse({ sortby: 'name', reverse: false }, 'name')).toBe('0')
    route.query = { sortby: 'name', reverse: '0' }
    expect(linkReverse({ sortby: 'name', reverse: false }, 'name')).toBe('1')
  })

  it('a chip that is not active starts descending', () => {
    route.query = {}
    expect(linkReverse({ sortby: 'name', reverse: false }, 'count')).toBe('1')
  })
})
