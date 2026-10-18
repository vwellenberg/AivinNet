import { beforeEach, describe, expect, it } from 'vitest'

import {
    applyTileSize,
    normalizeTileSize,
    phoneTileSize,
    TILE_DEFAULT,
    TILE_MAX,
    TILE_MIN,
    tileSize,
} from '../tileSize'

describe('normalizeTileSize', () => {
    it('keeps a valid value', () => {
        expect(normalizeTileSize(160)).toBe(160)
        expect(normalizeTileSize(TILE_MIN)).toBe(TILE_MIN)
        expect(normalizeTileSize(TILE_MAX)).toBe(TILE_MAX)
    })

    it('falls back to the default for anything that is not a finite number', () => {
        // Persisted state is restored from localStorage: hand-edited, truncated
        // or from another build. NaN reaching CSS drops the whole declaration.
        for (const bad of [undefined, null, 'big', '200', NaN, Infinity, {}, []]) {
            expect(normalizeTileSize(bad), String(bad)).toBe(TILE_DEFAULT)
        }
    })

    it('clamps to the slider bounds', () => {
        expect(normalizeTileSize(1)).toBe(TILE_MIN)
        expect(normalizeTileSize(100000)).toBe(TILE_MAX)
    })

    it('snaps to the slider step', () => {
        expect(normalizeTileSize(197)).toBe(200)
        expect(normalizeTileSize(195)).toBe(192)
    })
})

describe('phoneTileSize', () => {
    it('is the old 9rem at the default', () => {
        expect(phoneTileSize(TILE_DEFAULT)).toBe(144)
    })

    it('scales with the chosen size', () => {
        expect(phoneTileSize(256)).toBe(192)
        // 128 * 0.75 = 96 would cut the type label ("PLAYLIST"): floor at 112.
        expect(phoneTileSize(128)).toBe(112)
        expect(phoneTileSize(TILE_MIN)).toBeGreaterThanOrEqual(112)
    })
})

describe('applyTileSize', () => {
    let root: HTMLElement

    beforeEach(() => {
        root = document.createElement('div')
        applyTileSize(TILE_DEFAULT, root)
    })

    it('writes nothing at the default, so an untouched install is unchanged', () => {
        expect(root.style.getPropertyValue('--tile-min')).toBe('')
        expect(root.style.getPropertyValue('--tile-min-phone')).toBe('')
        expect(tileSize.value).toBe(TILE_DEFAULT)
    })

    it('writes both custom properties for another size', () => {
        applyTileSize(256, root)

        expect(root.style.getPropertyValue('--tile-min')).toBe('256px')
        expect(root.style.getPropertyValue('--tile-min-phone')).toBe('192px')
        expect(tileSize.value).toBe(256)
    })

    it('removes them again when the size goes back to the default', () => {
        applyTileSize(256, root)
        applyTileSize(TILE_DEFAULT, root)

        expect(root.style.getPropertyValue('--tile-min')).toBe('')
        expect(root.style.getPropertyValue('--tile-min-phone')).toBe('')
    })

    it('never writes an invalid value', () => {
        applyTileSize(NaN, root)

        expect(root.style.getPropertyValue('--tile-min')).toBe('')
        expect(tileSize.value).toBe(TILE_DEFAULT)
    })
})
