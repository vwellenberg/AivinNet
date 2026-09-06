// Stable per-browser device identity for the device-sync feature.
//
// Pure module (no store / no network). The id is persisted in localStorage;
// the name/type are derived from the user agent for a friendly device label.

const DEVICE_ID_KEY = 'aivinnet.device_id'

export type DeviceType = 'mobile' | 'desktop'

/** RFC-4122 v4 UUID, preferring the platform crypto and falling back to Math.random. */
function uuidv4(): string {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined

    if (c && typeof c.randomUUID === 'function') {
        return c.randomUUID()
    }

    // Manual fallback for environments without crypto.randomUUID.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const r = (Math.random() * 16) | 0
        const v = char === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

/**
 * Returns this browser's stable device id, creating and persisting one on
 * first use. Survives reloads via localStorage; degrades to a per-session id
 * if storage is unavailable (private mode / SSR).
 */
export function getOrCreateDeviceId(): string {
    let id: string | null = null

    try {
        id = localStorage.getItem(DEVICE_ID_KEY)
    } catch {
        // localStorage unavailable — fall through and mint a fresh id.
    }

    if (id) {
        return id
    }

    id = uuidv4()

    try {
        localStorage.setItem(DEVICE_ID_KEY, id)
    } catch {
        // Best-effort persistence; a non-persisted id still works this session.
    }

    return id
}

function currentUserAgent(): string {
    return typeof navigator !== 'undefined' ? navigator.userAgent : ''
}

/**
 * Friendly device name like "Chrome on Windows", derived from the user agent.
 * Falls back to "Browser" when neither browser nor OS can be identified.
 */
export function detectDeviceName(userAgent: string = currentUserAgent()): string {
    const ua = userAgent || ''

    let browser = 'Browser'
    if (/Edge?\//.test(ua)) {
        // Both Chromium Edge ("Edg/") and legacy Edge ("Edge/").
        browser = 'Edge'
    } else if (/Firefox\//.test(ua)) {
        browser = 'Firefox'
    } else if (/Chrome\//.test(ua)) {
        browser = 'Chrome'
    } else if (/Safari\//.test(ua)) {
        browser = 'Safari'
    }

    // Order matters: Android UAs contain "Linux", and iPhone/iPad UAs contain
    // "Mac OS X" — the more specific token must be tested first.
    let os = ''
    if (/Windows/i.test(ua)) {
        os = 'Windows'
    } else if (/Android/i.test(ua)) {
        os = 'Android'
    } else if (/iPhone/i.test(ua)) {
        os = 'iPhone'
    } else if (/iPad/i.test(ua)) {
        os = 'iPad'
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
        os = 'macOS'
    } else if (/Linux/i.test(ua)) {
        os = 'Linux'
    }

    return os ? `${browser} on ${os}` : browser
}

/** Coarse device class used for the device-list icon: mobile vs desktop. */
export function detectDeviceType(userAgent: string = currentUserAgent()): DeviceType {
    return /Mobi|Android|iPhone|iPad/i.test(userAgent) ? 'mobile' : 'desktop'
}
