import { describe, expect, it } from 'vitest'

import { gainDb, HEADROOM_DB, parseGainDb, parseR128Db, replayGainFactor } from '@/utils/replayGain'

// `extra` as the server sends it: tinytag 2 gives every tag as a list of
// strings (taglib.get_tags), keys in lower case.
const TAGGED = {
    replaygain_track_gain: ['-6.54 dB'],
    replaygain_track_peak: ['0.988'],
    replaygain_album_gain: ['-7.10 dB'],
    replaygain_album_peak: ['0.999'],
}

const db = (factor: number) => 20 * Math.log10(factor)

describe('parseGainDb', () => {
    it('reads the tag as tinytag hands it over', () => {
        expect(parseGainDb(['-6.54 dB'])).toBeCloseTo(-6.54)
        expect(parseGainDb(['+2.10 dB'])).toBeCloseTo(2.1)
        expect(parseGainDb('-3 dB')).toBe(-3)
        expect(parseGainDb(['-3.5'])).toBe(-3.5)
        expect(parseGainDb(['-3,5 dB'])).toBe(-3.5)
    })

    it('returns null for anything that is not a gain', () => {
        expect(parseGainDb(undefined)).toBeNull()
        expect(parseGainDb([])).toBeNull()
        expect(parseGainDb([''])).toBeNull()
        expect(parseGainDb(['loud'])).toBeNull()
        expect(parseGainDb(['-999 dB'])).toBeNull()
    })
})

describe('parseR128Db (Opus)', () => {
    it('converts 1/256 dB at -23 LUFS into ReplayGain dB', () => {
        // -1792/256 = -7 dB at -23 LUFS = -2 dB at the ReplayGain reference.
        expect(parseR128Db(['-1792'])).toBeCloseTo(-2)
        expect(parseR128Db(['0'])).toBeCloseTo(5)
        expect(parseR128Db(['-7 dB'])).toBeNull()
    })
})

describe('gainDb', () => {
    it('track mode reads the track gain', () => {
        expect(gainDb(TAGGED, 'track')).toBeCloseTo(-6.54)
    })

    it('album mode reads the album gain, and falls back to the track gain', () => {
        expect(gainDb(TAGGED, 'album')).toBeCloseTo(-7.1)
        expect(gainDb({ replaygain_track_gain: ['-4 dB'] }, 'album')).toBe(-4)
    })

    it('reads Opus R128 tags when there is no ReplayGain tag', () => {
        expect(gainDb({ r128_track_gain: ['-1792'] }, 'track')).toBeCloseTo(-2)
    })

    it('off, untagged and missing extra all give no gain', () => {
        expect(gainDb(TAGGED, 'off')).toBeNull()
        expect(gainDb({ encoder: ['Lavf'] }, 'track')).toBeNull()
        expect(gainDb(undefined, 'track')).toBeNull()
    })
})

describe('replayGainFactor', () => {
    it('off leaves the volume alone', () => {
        expect(replayGainFactor(TAGGED, 'off')).toBe(1)
    })

    it('applies the tagged gain plus the headroom', () => {
        expect(db(replayGainFactor(TAGGED, 'track'))).toBeCloseTo(-6.54 + HEADROOM_DB)
        expect(db(replayGainFactor(TAGGED, 'album'))).toBeCloseTo(-7.1 + HEADROOM_DB)
    })

    it('lets a quiet track catch up within the headroom', () => {
        expect(db(replayGainFactor({ replaygain_track_gain: ['+4 dB'] }, 'track'))).toBeCloseTo(4 + HEADROOM_DB)
    })

    it('never boosts past the volume setting (audio.volume stops at 1)', () => {
        expect(replayGainFactor({ replaygain_track_gain: ['+12 dB'] }, 'track')).toBe(1)
    })

    it('turns an untagged track down by the headroom alone, so it does not jump above its neighbours', () => {
        expect(db(replayGainFactor({}, 'track'))).toBeCloseTo(HEADROOM_DB)
        expect(db(replayGainFactor(undefined, 'album'))).toBeCloseTo(HEADROOM_DB)
    })
})
