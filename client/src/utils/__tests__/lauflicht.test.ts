import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

import { lauflichtClasses } from '../lauflicht'

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
})

// The class alone does nothing: the stylesheet has to pause BOTH pseudo
// elements, and the reduced-motion exception must not restart them — it forces
// `animation-duration` / `-iteration-count` with !important, never play-state.
// Read with readFileSync: `import.meta.glob(..., { as: 'raw' })` returns '' for .scss.
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
