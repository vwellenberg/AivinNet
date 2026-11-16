import { describe, expect, it } from 'vitest'

import { densePlaceholder } from '@/utils/densePlaceholder'

describe('densePlaceholder', () => {
    it('adds the query to a bare image name', () => {
        expect(densePlaceholder('/img/thumbnail/xsmall/alb1.webp')).toBe('/img/thumbnail/xsmall/alb1.webp?ph=dense')
    })

    it('joins an existing query instead of opening a second one', () => {
        // The real Album.image carries `?pathhash=`, Track.image also `&fb=track`.
        expect(densePlaceholder('/img/thumbnail/xsmall/alb1.webp?pathhash=ph1&fb=track')).toBe(
            '/img/thumbnail/xsmall/alb1.webp?pathhash=ph1&fb=track&ph=dense'
        )
    })

    it('leaves an empty url empty', () => {
        expect(densePlaceholder('')).toBe('')
    })
})
