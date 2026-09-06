// Per-device audio output offset ("fine-tune sync").
//
// Clock sync can only align what the *player* reports (`audio.currentTime`).
// What a listener hears is delayed further by the output path — Bluetooth
// speakers add 100-200 ms, a TV or a soundbar even more, wired output almost
// nothing. That difference is invisible to the protocol, so it needs a manual
// trim per device (the same knob Sonos/Chromecast expose).
//
// Positive value = this device runs AHEAD of the group anchor, compensating a
// delayed output path.

const KEY = 'aivinnet.audio_offset_ms'

/** Trim range and step of the UI control. */
export const OFFSET_MIN_MS = -1000
export const OFFSET_MAX_MS = 1000
export const OFFSET_STEP_MS = 10

export function clampOffset(ms: number): number {
    if (!Number.isFinite(ms)) return 0
    return Math.max(OFFSET_MIN_MS, Math.min(OFFSET_MAX_MS, Math.round(ms)))
}

export function loadAudioOffset(): number {
    try {
        return clampOffset(parseInt(localStorage.getItem(KEY) || '0', 10) || 0)
    } catch {
        return 0
    }
}

export function saveAudioOffset(ms: number): number {
    const value = clampOffset(ms)
    try {
        localStorage.setItem(KEY, String(value))
    } catch {
        // storage unavailable (private mode) — keep the in-memory value only
    }
    return value
}
