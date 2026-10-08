import { afterEach, describe, expect, it, vi } from 'vitest'

import { PLACEHOLDER_HEADER, coverIsPlaceholder } from '../placeholderCover'

// The server marks every placeholder response with X-Aivinnet-Placeholder
// (api/imgserver.py, tests_api/test_imgserver_fallback.py). The pixels cannot
// tell — real covers and artist cut-outs can be transparent too — so the
// client asks, with HEAD, and treats anything it cannot read as a cover.

const respond = (init: { ok?: boolean; header?: string | null }) =>
    vi.fn().mockResolvedValue({
        ok: init.ok ?? true,
        headers: new Headers(init.header ? { [PLACEHOLDER_HEADER]: init.header } : {}),
    })

describe('coverIsPlaceholder', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('is true when the server marks the image, and asks with HEAD', async () => {
        const fetch = respond({ header: 'album' })
        vi.stubGlobal('fetch', fetch)
        expect(await coverIsPlaceholder('/img/thumbnail/medium/x.webp?pathhash=p')).toBe(true)
        expect(fetch).toHaveBeenCalledWith('/img/thumbnail/medium/x.webp?pathhash=p', { method: 'HEAD' })
    })

    it('is false for real artwork, which carries no marker', async () => {
        vi.stubGlobal('fetch', respond({ header: null }))
        expect(await coverIsPlaceholder('/img/thumbnail/medium/real.webp')).toBe(false)
    })

    it('is false when the answer cannot be read', async () => {
        vi.stubGlobal('fetch', respond({ ok: false, header: 'album' }))
        expect(await coverIsPlaceholder('/x')).toBe(false)
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
        expect(await coverIsPlaceholder('/x')).toBe(false)
    })
})
