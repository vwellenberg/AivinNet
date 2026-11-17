import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// The phone bar's devices button is shown only while this device is in a group
// session (2026-11-17). Solo, cover + transport + devices left the title ~40px
// at 390px, so the button steps out of the bar and lives in Now Playing; joined,
// it comes back green, because a running group must stay one tap away.
//
// Source census: the condition is a template expression, and a render test
// would stub the button away. The three halves have to stay together: the
// phone-bar flag, the silent state and the group's joined flag.

const LEFT = readFileSync('src/components/BottomBar/Left.vue', 'utf8')
const template = LEFT.slice(0, LEFT.indexOf('<script'))
const script = LEFT.slice(LEFT.indexOf('<script'), LEFT.indexOf('</script>'))

// A census over an empty read is green for nothing.
const devicesTag = /<DevicesButton\b[^>]*\/?>/.exec(template)?.[0] ?? ''
const condition = /v-if="([^"]*)"/.exec(devicesTag)?.[1] ?? ''

describe('phone bar shows the devices button only while joined', () => {
    it('reads the files it checks', () => {
        expect(template).toContain('<DevicesButton')
        expect(condition, 'the DevicesButton in Left.vue has no v-if').not.toBe('')
    })

    it('keeps the phone-bar gate', () => {
        expect(condition).toMatch(/\bphoneBar\b/)
    })

    it('keeps the silent step-aside', () => {
        expect(condition).toMatch(/!settings\.is_silent/)
    })

    it('shows the button while the device is joined to a group', () => {
        expect(condition).toMatch(/\bdeviceSync\.joined\b/)
    })

    it('binds deviceSync to the devicesync store the template reads', () => {
        expect(script).toMatch(/import useDeviceSync from '@\/stores\/devicesync'/)
        expect(script).toMatch(/const deviceSync = useDeviceSync\(\)/)
    })
})
