import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import useFuse from '@/utils/useFuse'

const tracks = [
    { title: 'Alice Blue', artist: 'Nina' },
    { title: 'Bobs Dream', artist: 'Oskar' },
    { title: 'The Long Song Title', artist: 'Petra' },
]

const titles = (results: { item: { title: string } }[]) => results.map(r => r.item.title)

describe('useFuse', () => {
    it('finds items that match the term', () => {
        const results = useFuse('alice', tracks, { keys: ['title'] })
        expect(titles(results.value)).toEqual(['Alice Blue'])
    })

    it('matches a term in the middle of a long field (ignoreLocation)', () => {
        const results = useFuse('Title', tracks, { keys: ['title'] })
        expect(titles(results.value)).toContain('The Long Song Title')
    })

    it('returns every item, wrapped with its index, for an empty term', () => {
        const results = useFuse('', tracks, { keys: ['title'] })
        expect(results.value).toEqual([
            { item: tracks[0], refIndex: 0 },
            { item: tracks[1], refIndex: 1 },
            { item: tracks[2], refIndex: 2 },
        ])
    })

    it('returns every item for an absent term too', () => {
        const results = useFuse(undefined as unknown as string, tracks, { keys: ['title'] })
        expect(results.value.map(r => r.refIndex)).toEqual([0, 1, 2])
    })

    it('recomputes when the search term changes', () => {
        const query = ref('')
        const results = useFuse(query, tracks, { keys: ['title'] })
        expect(results.value).toHaveLength(3)

        query.value = 'bobs'
        expect(titles(results.value)).toEqual(['Bobs Dream'])
    })

    it('follows the list when items are added or changed', async () => {
        const list = ref([...tracks])
        const results = useFuse('quiet', list, { keys: ['title'] })
        expect(results.value).toEqual([])

        list.value.push({ title: 'Quiet Storm', artist: 'Lena' })
        await nextTick()
        await nextTick()
        expect(titles(results.value)).toEqual(['Quiet Storm'])
    })

    it('an empty term over a changed list returns the new list', async () => {
        const list = ref([...tracks])
        const results = useFuse('', list, { keys: ['title'] })
        list.value.push({ title: 'Last One', artist: 'Mo' })
        await nextTick()
        expect(results.value).toHaveLength(4)
        expect(results.value[3]).toEqual({ item: { title: 'Last One', artist: 'Mo' }, refIndex: 3 })
    })

    it('accepts a getter for the term and the list', () => {
        const query = ref('petra')
        const list = ref(tracks)
        const results = useFuse(() => query.value, () => list.value, { keys: ['artist'] })
        expect(results.value.map(r => r.item.artist)).toEqual(['Petra'])
    })

    it('does not change the input list', () => {
        const input = [...tracks]
        useFuse('alice', input, { keys: ['title'] }).value
        expect(input).toEqual(tracks)
    })
})
