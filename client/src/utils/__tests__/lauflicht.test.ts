import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

import { lauflichtClasses, syncLauflicht } from '../lauflicht'

describe('lauflichtClasses', () => {
    it('pauses the Lauflicht while nothing plays', () => {
        expect(lauflichtClasses('normal', false)['lauflicht-idle']).toBe(true)
        expect(lauflichtClasses('subtle', false)['lauflicht-idle']).toBe(true)
    })

    it('lets it run during playback', () => {
        expect(lauflichtClasses('normal', true)['lauflicht-idle']).toBe(false)
    })

    it('maps the level setting as before', () => {
        expect(lauflichtClasses('off', true)).toMatchObject({ 'lauflicht-off': true, 'lauflicht-subtle': false })
        expect(lauflichtClasses('subtle', true)).toMatchObject({ 'lauflicht-off': false, 'lauflicht-subtle': true })
        expect(lauflichtClasses('normal', true)).toMatchObject({ 'lauflicht-off': false, 'lauflicht-subtle': false })
    })

    // Party (#548): three or more devices in the group switch the speed class on and off.
    it('toggles the party speed class with the group size', () => {
        expect(lauflichtClasses('normal', true, true)['lauflicht-party']).toBe(true)
        expect(lauflichtClasses('subtle', true, true)['lauflicht-party']).toBe(true)
        expect(lauflichtClasses('normal', true, false)['lauflicht-party']).toBe(false)
        expect(lauflichtClasses('normal', true)['lauflicht-party']).toBe(false)
    })

    it('keeps the party class apart from the level and idle classes', () => {
        expect(lauflichtClasses('subtle', false, true)).toMatchObject({
            'lauflicht-subtle': true,
            'lauflicht-idle': true,
            'lauflicht-party': true,
        })
    })
})

// A notch faster for the party, and only for the comet (::before): the glimmer
// keeps its own timing. Subtle + party is its own rule, as the subtle level has
// a longer comet than normal.
describe('lauflicht party stylesheet', () => {
    const css = readFileSync('src/assets/scss/Global/lauflicht.scss', 'utf8')

    it('runs the comet faster under the party class', () => {
        const block = css.match(/body\.lauflicht-party \.lauflicht-rim \{\s*&::before \{\s*animation-duration: (\d+)s;/)
        expect(block, 'body.lauflicht-party .lauflicht-rim::before block').not.toBeNull()
        expect(Number(block![1])).toBeLessThan(11)
    })

    it('keeps subtle + party faster than subtle alone', () => {
        const block = css.match(/body\.lauflicht-party\.lauflicht-subtle \.lauflicht-rim \{\s*&::before \{\s*animation-duration: (\d+)s;/)
        expect(block, 'subtle + party block').not.toBeNull()
        expect(Number(block![1])).toBeLessThan(16)
    })
})

// The class alone does nothing: the stylesheet has to pause BOTH pseudo
// elements, and the reduced-motion exception must not restart them — it forces
// `animation-duration` / `-iteration-count` with !important, never play-state.
// Read with readFileSync: `import.meta.glob(..., { query: '?raw', import: 'default' })` returns '' for .scss.
describe('lauflicht stylesheet', () => {
    const css = readFileSync('src/assets/scss/Global/lauflicht.scss', 'utf8')
    const policy = readFileSync('src/assets/scss/Global/motion-policy.scss', 'utf8')

    it('pauses comet and glow under body.lauflicht-idle', () => {
        const block = css.match(/body\.lauflicht-idle \.lauflicht-rim \{([\s\S]*?)\n\}/)
        expect(block, 'body.lauflicht-idle .lauflicht-rim block').not.toBeNull()
        expect(block![1]).toMatch(/&::before,\s*&::after\s*\{\s*animation-play-state:\s*paused;/)
    })

    it('is not overridden by the reduced-motion policy', () => {
        expect(policy).not.toMatch(/animation-play-state/)
    })
})

// The comet on a cover that appears later (opening Now Playing, the next row
// turning current) used to start at its own angle: two lights on screen, two
// phases. The sync copies the longest-running copy's time onto the others.
describe('syncLauflicht', () => {
    type Fake = { animationName: string; currentTime: number | null }
    const anim = (animationName: string, currentTime: number | null): Fake => ({ animationName, currentTime })
    const doc = (list: Fake[]) => ({ getAnimations: () => list as unknown as Animation[] })

    it('puts a newly started comet at the angle of the running one', () => {
        const bar = anim('np-comet-spin', 93_400)
        const big = anim('np-comet-spin', 12)
        syncLauflicht(doc([big, bar]))
        expect(big.currentTime).toBe(93_400)
        expect(bar.currentTime).toBe(93_400)
    })

    it('syncs each keyframe set on its own and leaves other animations alone', () => {
        const spinOld = anim('np-comet-spin', 5_000)
        const spinNew = anim('np-comet-spin', 0)
        const breathe = anim('np-comet-breathe', 40)
        const arrival = anim('mem-step-in', 1)
        syncLauflicht(doc([spinOld, spinNew, breathe, arrival]))
        expect(spinNew.currentTime).toBe(5_000)
        // A single copy has nothing to follow — not pulled to the comet's time.
        expect(breathe.currentTime).toBe(40)
        expect(arrival.currentTime).toBe(1)
    })

    it('is a no-op where the browser has no animation list', () => {
        expect(() => syncLauflicht({} as Pick<Document, 'getAnimations'>)).not.toThrow()
        expect(() => syncLauflicht(undefined)).not.toThrow()
    })
})

// The big cover's ring and its ink frame must share one corner: with the
// frame on a tighter radius than the ring, its corner stuck out past the light.
describe('Now Playing cover rim', () => {
    const header = readFileSync('src/components/NowPlaying/Header.vue', 'utf8')
    const block = header.match(/\.np-image \{([\s\S]*?)\n {8}img \{([\s\S]*?)\n {8}\}/)

    it('draws the ring outside the frame on a concentric radius', () => {
        expect(block, '.np-image block in Header.vue').not.toBeNull()
        const [, rim, img] = block!
        expect(img).toMatch(/border: \$candy-border;/)
        // The image takes its radius from `.rounded` ($candy-radius) in the template.
        expect(header).toMatch(/<img class="rounded"/)
        expect(rim).toMatch(/padding: \$rim-bleed;/)
        expect(rim).toMatch(/border-radius: calc\(#\{\$candy-radius\} \+ #\{\$rim-bleed\}\);/)
    })
})
