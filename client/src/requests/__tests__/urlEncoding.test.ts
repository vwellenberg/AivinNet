import { beforeEach, describe, expect, it, vi } from 'vitest'

// Names and folders carry "&", "#", "+" and "/". Interpolated raw into a query
// string they cut the parameter short: "/music/#1 Hits" became "/music/" (the
// whole library), "Simon & Garfunkel" became "Simon ".

const useAxiosMock = vi.fn()
vi.mock('@/requests/useAxios', () => ({ default: (...args: unknown[]) => useAxiosMock(...args) }))

import { getTracksInPath } from '@/requests/folders'
import { searchTracks } from '@/requests/searchMusic'

function sentParam(name: string): string | null {
    const url: string = useAxiosMock.mock.calls[0][0].url
    return new URL(url, 'http://x').searchParams.get(name)
}

describe('query parameters survive special characters', () => {
    beforeEach(() => {
        useAxiosMock.mockReset()
        useAxiosMock.mockResolvedValue({ data: { tracks: [], results: [], more: false }, status: 200 })
    })

    it.each(['/music/#1 Hits', '/music/Simon & Garfunkel', '/music/Florence + the Machine'])(
        'the folder path %s arrives whole',
        async path => {
            await getTracksInPath(path)
            expect(sentParam('path')).toBe(path)
        }
    )

    it.each(['Simon & Garfunkel', 'AC/DC', 'Florence + the Machine', '#1'])(
        'the search term %s arrives whole',
        async q => {
            await searchTracks(q)
            expect(sentParam('q')).toBe(q)
        }
    )
})
