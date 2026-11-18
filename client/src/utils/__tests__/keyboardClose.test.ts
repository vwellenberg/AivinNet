import { describe, expect, it } from 'vitest'

import { KEYBOARD_MIN_HEIGHT, keyboardTracker } from '@/utils/keyboardClose'

// Readings as a Galaxy S22 in Vivaldi would report them: 360 CSS px wide,
// ~640 px of visual viewport with both browser bars, ~330 px with the keyboard.
describe('keyboardTracker', () => {
    it('reports the close after an open, once', () => {
        const reading = keyboardTracker()
        expect(reading(360, 640)).toBe(false) // first reading
        expect(reading(360, 330)).toBe(false) // keyboard opens
        expect(reading(360, 640)).toBe(true) // keyboard closes
        expect(reading(360, 640)).toBe(false) // nothing new
    })

    it('follows a keyboard that opens in steps (suggestion strip)', () => {
        const reading = keyboardTracker()
        reading(360, 640)
        expect(reading(360, 380)).toBe(false)
        expect(reading(360, 330)).toBe(false)
        expect(reading(360, 640)).toBe(true)
    })

    it('a browser toolbar hiding or showing is no keyboard', () => {
        const reading = keyboardTracker()
        reading(360, 640)
        expect(reading(360, 640 - 56)).toBe(false)
        expect(reading(360, 640)).toBe(false)
        expect(reading(360, 640 - (KEYBOARD_MIN_HEIGHT - 1))).toBe(false)
        expect(reading(360, 640)).toBe(false)
    })

    it('a rotation starts over instead of reading as a keyboard', () => {
        const reading = keyboardTracker()
        reading(360, 640)
        reading(360, 330) // keyboard open in portrait
        expect(reading(780, 300)).toBe(false) // rotated: new width
        expect(reading(360, 640)).toBe(false) // back: new width again
    })

    it('a page that loads with the keyboard already up learns the full height later', () => {
        const reading = keyboardTracker()
        reading(360, 330) // keyboard open at the first reading
        expect(reading(360, 640)).toBe(false) // can't know it was open
        expect(reading(360, 330)).toBe(false)
        expect(reading(360, 640)).toBe(true)
    })
})
