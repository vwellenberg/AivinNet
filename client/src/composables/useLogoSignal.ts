// Easter egg (#544): seven fast clicks on the app icon send a signal. Radio
// waves ring out of the planet, a trace runs across the top of the page, and
// the screen loses its picture for a moment like an old TV. Shared by the
// desktop logo (Logo.vue) and the phone's top-bar icon (NavBar.vue); the burst
// itself is drawn once, by SignalBurst.vue in App.vue.
//
// Two satellites came first: one on the logo's hover orbit, a dot next to the
// orbit's own moon, and one flying across the page. The user wanted neither,
// but the signal around them; so the signal is the whole effect now.
import { readonly, ref } from 'vue'

import { useToast } from '@/stores/notification'

export const CLICKS_NEEDED = 7
/** Seven clicks inside this window. 2 s was too tight to hit on purpose. */
export const CLICK_WINDOW_MS = 3000
/** The whole burst, from the first wave to the last of the static. */
export const BURST_MS = 2600

/** Where a burst starts (the centre of the icon that was clicked), in viewport px. */
export type SignalBurst = { id: number; x: number; y: number }

// Module state, not per component: the desktop logo and the phone icon both
// launch the one burst the layer in App.vue draws.
const burst = ref<SignalBurst | null>(null)
let burstTimer: ReturnType<typeof setTimeout> | null = null
let nextId = 1

/** The burst in progress, or null. Read by SignalBurst.vue. */
export function useSignalBurst() {
    return readonly(burst)
}

/** Test hook (testing.md: no module-registry resets with Pinia). */
export function __resetSignalTestState() {
    if (burstTimer) clearTimeout(burstTimer)
    burstTimer = null
    burst.value = null
}

function prefersLessMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A short, quiet burst of radio hiss, generated with Web Audio. Best effort:
 * without an AudioContext the burst is silent.
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
        // No audio is not an error: the picture still answers.
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
    if (prefersLessMotion() || burst.value) return
    burst.value = { id: nextId++, ...centreOf(origin) }
    playRadioHiss()
    burstTimer = setTimeout(() => {
        burst.value = null
        burstTimer = null
    }, BURST_MS)
}

export function useLogoSignal() {
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
