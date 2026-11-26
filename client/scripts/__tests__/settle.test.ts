import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// The post-deploy gates measured after a FIXED pause, and on a loaded server
// the section stickers were still "slapping" in (scaled 1.2, turned): the edge
// audit read 279.2 px for a caption that rests at 303 and failed five deploys
// in a row on pages nobody had touched (2026-11-25). scripts/settle.js makes
// the gates wait for the resting page; these tests hold its rules and that the
// gates actually use it.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)
const { untilPageRests } = require('../settle.js') as {
    untilPageRests: (
        options: { timeout: number; quiet: number },
        env: {
            getAnimations: () => FakeAnimation[]
            now: () => number
            sleep: (ms: number) => Promise<void>
            lastMutation: () => number
        },
    ) => Promise<{ settled: boolean; running: string[] }>
}

type FakeAnimation = {
    animationName: string
    playState: string
    pending: boolean
    effect: { getComputedTiming: () => { endTime: number } }
}

/** A clock that only moves when the code under test sleeps. */
function fakeEnv(animations: (t: number) => FakeAnimation[], mutations: number[] = []) {
    let t = 0
    return {
        env: {
            getAnimations: () => animations(t),
            // The latest mutation that has happened by now (0 = the page as loaded).
            lastMutation: () => Math.max(0, ...mutations.filter((m) => m <= t)),
            now: () => t,
            sleep: async (ms: number) => {
                t += ms
            },
        },
        elapsed: () => t,
    }
}

const anim = (name: string, endTime: number, playState = 'running'): FakeAnimation => ({
    animationName: name,
    playState,
    pending: false,
    effect: { getComputedTiming: () => ({ endTime }) },
})

describe('settle: gates measure the resting page', () => {
    it('waits until a running entrance animation has finished, then a quiet window', async () => {
        // The sticker slap runs until t=1200, then the page is still.
        const { env, elapsed } = fakeEnv((t) => (t < 1200 ? [anim('mem-sticker-slap', 600)] : []))
        const rest = await untilPageRests({ timeout: 15000, quiet: 500 }, env)
        expect(rest).toEqual({ settled: true, running: [] })
        // Not before the animation ended, and not before the quiet window passed.
        expect(elapsed()).toBeGreaterThanOrEqual(1200 + 500)
    })

    it('a section mounting late restarts the quiet window (the 2026-11-25 deploys)', async () => {
        // The Favorites sections mount at t=600, but on a starved renderer their
        // stickers' slap only shows up at t=1000 (and runs to 1600). An
        // animation-only wait saw 700 ms of stillness at t=700 and measured
        // keyframe 0; the inserted nodes keep the window open until the slap
        // is visible, so it is waited out.
        const { env, elapsed } = fakeEnv((t) => (t >= 1000 && t < 1600 ? [anim('mem-sticker-slap', 600)] : []), [600])
        const rest = await untilPageRests({ timeout: 15000, quiet: 700 }, env)
        expect(rest.settled).toBe(true)
        expect(elapsed()).toBeGreaterThanOrEqual(1600 + 700)
    })

    it('a page whose DOM keeps changing is reported, not passed', async () => {
        const ticks = Array.from({ length: 100 }, (_, i) => i * 300)
        const { env } = fakeEnv(() => [], ticks)
        const rest = await untilPageRests({ timeout: 2000, quiet: 700 }, env)
        expect(rest).toEqual({ settled: false, running: ['DOM still changing'] })
    })

    it('ignores infinite animations (marquee, season particles) — they never end', async () => {
        const { env, elapsed } = fakeEnv(() => [anim('marquee', Infinity)])
        const rest = await untilPageRests({ timeout: 15000, quiet: 500 }, env)
        expect(rest.settled).toBe(true)
        expect(elapsed()).toBeLessThan(1000)
    })

    it('counts an animation waiting to start (pending), and not a finished one', async () => {
        const pendingUntil = 800
        const { env, elapsed } = fakeEnv((t) => [
            { ...anim('btn-pop', 300, 'paused'), pending: t < pendingUntil },
            anim('done', 300, 'finished'),
        ])
        await untilPageRests({ timeout: 15000, quiet: 500 }, env)
        expect(elapsed()).toBeGreaterThanOrEqual(pendingUntil + 500)
    })

    it('gives up at the timeout and names what is still moving', async () => {
        const { env } = fakeEnv(() => [anim('mem-sticker-slap', 600), anim('mem-sticker-slap', 600), anim('btn-pop', 300)])
        const rest = await untilPageRests({ timeout: 2000, quiet: 500 }, env)
        expect(rest).toEqual({ settled: false, running: ['mem-sticker-slap', 'btn-pop'] })
    })
})

describe('settle: both layout gates call it before measuring', () => {
    it.each(['scripts/edge-audit.js', 'scripts/overflow-check.js'])('%s', (file) => {
        const src = readFileSync(file, 'utf8')
        expect(src).toContain('require("./settle")')
        // After the route is loaded, before the page is measured.
        const loaded = src.indexOf('page.goto(')
        const settled = src.indexOf('await settle(page)')
        const measured = src.indexOf('page.evaluate(', loaded)
        expect(loaded, 'goto missing').toBeGreaterThan(-1)
        expect(settled, `${file} does not wait for rest`).toBeGreaterThan(loaded)
        expect(settled, `${file} measures before it waits for rest`).toBeLessThan(measured)
    })
})
