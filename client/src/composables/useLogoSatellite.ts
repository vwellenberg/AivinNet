// Easter egg (#544): seven fast clicks on the app icon send a pixel satellite
// once round it. Shared by the desktop logo (Logo.vue) and the phone's top-bar
// icon (NavBar.vue): the phone has no other logo, so with only the desktop one
// the egg could not be found there at all.
import { onUnmounted, ref } from 'vue'

import { useToast } from '@/stores/notification'

export const CLICKS_NEEDED = 7
/** Seven clicks inside this window. 2 s was too tight to hit on purpose. */
export const CLICK_WINDOW_MS = 3000
/** One lap. Must match the `logo-satellite-lap` duration in Logo.vue's stylesheet. */
export const LAP_MS = 2400

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

export function useLogoSatellite() {
    const toast = useToast()
    const flying = ref(false)
    let clicks: number[] = []
    let lapTimer: ReturnType<typeof setTimeout> | null = null

    function launch() {
        // The toast always comes: a satellite in the corner of the eye is easy
        // to miss, and under reduced motion it is the whole answer.
        toast.showNotification('📡 Signal received')
        if (prefersLessMotion() || flying.value) return
        flying.value = true
        playRadioHiss()
        lapTimer = setTimeout(() => {
            flying.value = false
            lapTimer = null
        }, LAP_MS)
    }

    /** Observes a click only; the icon keeps doing whatever its click does. */
    function registerClick() {
        const now = Date.now()
        clicks = [...clicks, now].slice(-CLICKS_NEEDED)
        if (clicks.length < CLICKS_NEEDED || now - clicks[0] > CLICK_WINDOW_MS) return
        clicks = []
        launch()
    }

    onUnmounted(() => {
        if (lapTimer) clearTimeout(lapTimer)
    })

    return { flying, registerClick }
}
