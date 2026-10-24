import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { getLastFmApiSig, md5 } from '@/context_menus/hashing'

// The client used Node's `crypto` through a browser polyfill for this one
// MD5. The replacement must give the same digests, or Last.fm rejects the
// signed request as "Invalid method signature".
describe('md5', () => {
    it('matches the RFC 1321 test suite', () => {
        expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
        expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
        expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
        expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
        expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b')
        expect(md5('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe(
            'd174ab98d277d9f5a5611c2c9f419d9f'
        )
        expect(md5('1234567890'.repeat(8))).toBe('57edf4a22be3c955ac49da2e2107b67a')
    })

    it('agrees with Node across the padding boundaries and on non-ASCII text', () => {
        // 55/56/63/64/65 bytes are where the length field spills into an extra block.
        const inputs = [55, 56, 63, 64, 65, 119, 120, 1000].map((n) => 'x'.repeat(n))
        inputs.push('Motörhead — 東京', '🎵'.repeat(20))
        for (const text of inputs) {
            expect(md5(text)).toBe(createHash('md5').update(text).digest('hex'))
        }
    })
})

describe('getLastFmApiSig', () => {
    it('signs the sorted parameters followed by the secret', () => {
        const sig = getLastFmApiSig({ method: 'auth.getToken', api_key: 'key123' }, 's3cret')
        expect(sig).toBe(createHash('md5').update('api_keykey123methodauth.getTokens3cret').digest('hex'))
    })
})
