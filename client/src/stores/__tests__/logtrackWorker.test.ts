import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// The scrobble worker (public/workers/logtrack.js) builds its own POST body, so
// the contract test only reads it as text. These run it: the body it actually
// sends must carry the device that played (#541), and nothing else changes.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('public/workers/logtrack.js', 'utf-8')

/** Runs the worker in a sandbox; returns its onmessage and the fetch mock. */
function loadWorker(response: unknown = { milestone: null }) {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => response }))
    const postMessage = vi.fn()
    const sandbox: Record<string, unknown> = {
        fetch,
        postMessage,
        location: { port: '1970', protocol: 'http:', hostname: 'home', origin: 'http://home:1970' },
        self: { close: vi.fn() },
    }
    vm.runInNewContext(SOURCE, sandbox)
    return { onmessage: sandbox.onmessage as (e: { data: unknown }) => void, fetch, postMessage }
}

/** The worker's fetch and its promise chain are asynchronous: let them settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('logtrack worker: the body it posts', () => {
    it('sends the device that played as device_id, beside the play itself', async () => {
        const worker = loadWorker()

        worker.onmessage({
            data: { trackhash: 't1', duration: 200, source: 'al:alb1', timestamp: 1790000000, deviceId: 'device-phone-1' },
        })
        await settle()

        const [url, init] = worker.fetch.mock.calls[0] as unknown as [string, { body: string }]
        expect(url).toBe('http://home:1970/logger/track/log')
        expect(JSON.parse(init.body as string)).toEqual({
            trackhash: 't1',
            duration: 200,
            source: 'al:alb1',
            timestamp: 1790000000,
            device_id: 'device-phone-1',
        })
    })

    it('leaves device_id out when the play has no device id', async () => {
        const worker = loadWorker()

        worker.onmessage({ data: { trackhash: 't1', duration: 200, source: 'al:alb1', timestamp: 1790000000 } })
        await settle()

        const [, init] = worker.fetch.mock.calls[0] as unknown as [string, { body: string }]
        expect(JSON.parse(init.body as string)).not.toHaveProperty('device_id')
    })

    it('passes a milestone back to the page, and nothing else', async () => {
        const worker = loadWorker({ msg: 'recorded', plays: 1000, milestone: { number: 1000, track: 'Blue' } })

        worker.onmessage({ data: { trackhash: 't1', duration: 200, source: 'al:alb1', timestamp: 1, deviceId: 'd' } })
        await settle()

        expect(worker.postMessage).toHaveBeenCalledWith({ number: 1000, track: 'Blue' })
    })
})
