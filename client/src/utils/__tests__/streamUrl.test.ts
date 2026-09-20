import { describe, expect, it } from 'vitest'

import { getUrl } from '../streamUrl'

// ---------------------------------------------------------------------------
// The playback URL is the contract with the server, and until now no test
// looked at it: every suite mocked `getUrl` away because it lived in the player
// store, which cannot be imported under test. So the dead transcoding
// parameters (#181) could sit in it for months without a single red line.
// ---------------------------------------------------------------------------

describe('getUrl', () => {
    it('points at the one streaming endpoint the server has', () => {
        const url = getUrl('/music/Artist/Album/01 Track.flac', 'abc123')

        expect(url).toContain('/file/abc123/legacy')
    })

    it('carries the filepath, encoded', () => {
        const url = getUrl('/music/A & B/01 Track #1.flac', 'abc123')

        expect(url).toContain(`filepath=${encodeURIComponent('/music/A & B/01 Track #1.flac')}`)
        // Spaces and & would end the parameter, or start a new one.
        expect(url).not.toContain('/music/A & B')
    })

    it('carries nothing the endpoint does not read', () => {
        // `container` and `quality` described a transcoder that no longer
        // exists; `use_legacy` was a parameter with one possible value.
        const url = getUrl('/music/Track.flac', 'abc123')

        expect(url).not.toContain('container=')
        expect(url).not.toContain('quality=')
    })
})
