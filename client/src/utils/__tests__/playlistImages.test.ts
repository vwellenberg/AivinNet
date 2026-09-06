import { describe, expect, it } from 'vitest'

import { getCollageImages, imageName } from '../playlistImages'

const d = (image: string) => ({ image, color: '#123' })

describe('imageName', () => {
    it('reads the filename from dict entries', () => {
        expect(imageName(d('a.webp'))).toBe('a.webp')
    })

    it('passes plain string entries through', () => {
        expect(imageName('a.webp')).toBe('a.webp')
    })
})

describe('getCollageImages', () => {
    it('returns the first 4 names for 4 pairwise different covers', () => {
        expect(getCollageImages([d('a'), d('b'), d('c'), d('d')])).toEqual(['a', 'b', 'c', 'd'])
    })

    it('keeps playlist order and ignores entries beyond the first 4', () => {
        expect(getCollageImages([d('a'), d('b'), d('c'), d('d'), d('e')])).toEqual(['a', 'b', 'c', 'd'])
    })

    it('supports plain string entries', () => {
        expect(getCollageImages(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
    })

    it('rejects backend-padded lists (2 covers padded to [a, b, b, a])', () => {
        expect(getCollageImages([d('a'), d('b'), d('b'), d('a')])).toBeNull()
    })

    it('rejects backend-padded lists (3 covers padded to [a, b, c, a])', () => {
        expect(getCollageImages([d('a'), d('b'), d('c'), d('a')])).toBeNull()
    })

    it('rejects a single cover padded 4 times', () => {
        expect(getCollageImages([d('a'), d('a'), d('a'), d('a')])).toBeNull()
    })

    it('rejects lists with fewer than 4 entries', () => {
        expect(getCollageImages([d('a'), d('b'), d('c')])).toBeNull()
    })

    it('rejects empty and missing lists', () => {
        expect(getCollageImages([])).toBeNull()
        expect(getCollageImages(undefined)).toBeNull()
        expect(getCollageImages(null)).toBeNull()
    })

    it('rejects lists containing empty filenames', () => {
        expect(getCollageImages([d('a'), d(''), d('c'), d('d')])).toBeNull()
    })
})
