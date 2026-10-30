// Easter egg (#544): seven fast clicks on the app icon launch a pixel satellite
// that flies across the whole screen, with radio waves and a burst of static.
// Shared by the desktop logo (Logo.vue) and the phone's top-bar icon
// (NavBar.vue); the flight itself is drawn once, by SatelliteFlyby.vue in App.vue.
//
// It used to circle the logo on the hover orbit, as a dot the size of the orbit's
// own moon — next to the hover ring nobody could tell the two apart. Off the
// orbit and across the page it cannot be mistaken for anything.
import { readonly, ref } from 'vue'

import { useToast } from '@/stores/notification'

export const CLICKS_NEEDED = 7
/** Seven clicks inside this window. 2 s was too tight to hit on purpose. */
export const CLICK_WINDOW_MS = 3000
/** The whole flight, from the planet to past the right edge. */
export const FLIGHT_MS = 3000

/** Where a flight starts (the centre of the icon that was clicked), in viewport px. */
export type SatelliteFlight = { id: number; x: number; y: number }

// Module state, not per component: the desktop logo and the phone icon both
// launch the one flight the layer in App.vue draws.
const flight = ref<SatelliteFlight | null>(null)
let flightTimer: ReturnType<typeof setTimeout> | null = null
let nextId = 1

/** The flight in progress, or null. Read by SatelliteFlyby.vue. */
export function useSatelliteFlight() {
    return readonly(flight)
}

/** Test hook (testing.md: no module-registry resets with Pinia). */
export function __resetSatelliteTestState() {
    if (flightTimer) clearTimeout(flightTimer)
    flightTimer = null
    flight.value = null
}

function prefersLessMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A short, quiet burst of radio hiss, generated with Web Audio. Best effort:
 * without an AudioContext the satellite flies silently.
 */
function playRadioHiss(seconds = 1.2, volume = 0.04) {
    try {
        const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
        if (!Ctx) return
        const ctx: AudioContext = new Ctx()
        const rate = ctx.sampleRate
        const frames = Math.floor(rate * seconds)
        const buffer = ctx.createBuffer(1, frames, rate)
        const data = buffer.getChannelData(0)
        const fadeIn = rate * 0.05
        const fadeOut = rate * 0.3
        for (let i = 0; i < frames; i++) {
            const env = Math.min(1, i / fadeIn, (frames - i) / fadeOut)
            data[i] = (Math.random() * 2 - 1) * env
        }
        const source = ctx.createBufferSource()
        source.buffer = buffer
        const band = ctx.createBiquadFilter()
        band.type = 'bandpass'
        band.frequency.value = 2200
        band.Q.value = 0.8
        const gain = ctx.createGain()
        gain.gain.value = volume
        source.connect(band).connect(gain).connect(ctx.destination)
        source.onended = () => void ctx.close()
        source.start()
    } catch {
        // No audio is not an error: the satellite still flies.
    }
}

function centreOf(origin: Element | null | undefined): { x: number; y: number } {
    if (!origin) return { x: 40, y: 40 }
    const r = origin.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function launch(origin: Element | null | undefined) {
    // The toast always comes; under reduced motion it is the whole answer.
    useToast().showNotification('📡 Signal received')
    if (prefersLessMotion() || flight.value) return
    flight.value = { id: nextId++, ...centreOf(origin) }
    playRadioHiss()
    flightTimer = setTimeout(() => {
        flight.value = null
        flightTimer = null
    }, FLIGHT_MS)
}

export function useLogoSatellite() {
    let clicks: number[] = []

    /** Observes a click only; the icon keeps doing whatever its click does. */
    function registerClick(origin?: Element | null) {
        const now = Date.now()
        clicks = [...clicks, now].slice(-CLICKS_NEEDED)
        if (clicks.length < CLICKS_NEEDED || now - clicks[0] > CLICK_WINDOW_MS) return
        clicks = []
        launch(origin)
    }

    return { registerClick }
}
