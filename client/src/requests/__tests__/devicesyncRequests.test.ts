import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A transport command carries a deadline, and the calls that run on their own
// (poll once a second, register, commands, the calibration log) do not flip
// the busy cursor (#298): a hung booking left the group silent at the end of a
// track, and the poll showed the progress cursor a quarter of the time.

const { sent } = vi.hoisted(() => ({ sent: [] as any[] }))
vi.mock('axios', () => {
    const axios: any = vi.fn(async (config: any) => {
        sent.push(config)
        return { data: {}, status: 200 }
    })
    axios.defaults = {}
    return { default: axios }
})

import * as sync from '@/requests/devicesync'
import useLoaderStore from '@/stores/loader'

describe('device-sync requests', () => {
    beforeEach(() => {
        sent.length = 0
        setActivePinia(createPinia())
        document.documentElement.classList.remove('loading')
    })

    it('a transport command gives up after SYNC_TIMEOUT_MS; the poll waits (one request at a time)', async () => {
        await sync.sendCommand({ device_id: 'd', type: 'play', payload: {} })
        await sync.pollSession({ device_id: 'd', known_version: 0, client_sent_ms: 0, volume: 1, mute: false })
        expect(sent[0].timeout).toBe(sync.SYNC_TIMEOUT_MS)
        // A poll timing out behind a long request would read as a lost
        // connection and dissolve the group.
        expect(sent[1].timeout).toBeUndefined()
    })

    it('the background calls leave the busy cursor alone; join and leave still show it', async () => {
        const loader = useLoaderStore()
        const start = vi.spyOn(loader, 'startLoading')

        await sync.pollSession({ device_id: 'd', known_version: 0, client_sent_ms: 0, volume: 1, mute: false })
        await sync.sendCommand({ device_id: 'd', type: 'play', payload: {} })
        await sync.registerDevice('d', 'n', 'desktop')
        await sync.logCalibration({ device_id: 'd', run: 'r', devices: [], details: {} })
        expect(start).not.toHaveBeenCalled()
        expect(document.documentElement.classList.contains('loading')).toBe(false)

        await sync.joinGroup('d')
        expect(start).toHaveBeenCalledTimes(1)
    })
})
