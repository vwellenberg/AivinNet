/**
 * `v-wave`: the click ripple of the mobile nav rows (LeftSidebar/MobileNav.vue).
 *
 * Replaces the v-wave package, which the app used with two options only: the
 * theme's ink line as colour and a 0.35 s duration. Its other defaults (opacity
 * 0.2 to 0.1, a quick dissolve, ease-out) are kept here.
 *
 * One difference on purpose: the ripple does not wait for the finger to lift.
 * It scales out over DURATION_MS, dissolves over DISSOLVE_MS and removes itself.
 * Nothing is left behind on the element, and the host only gets the two styles
 * a ripple needs (position + overflow) while a ripple is running.
 *
 * With prefers-reduced-motion nothing is drawn at all.
 */
import type { Directive } from 'vue'

// Mirrored as $motion-ripple in assets/scss/_motion.scss.
export const WAVE_COLOR = 'var(--mem-line)'
export const DURATION_MS = 350
export const DISSOLVE_MS = 150
const INITIAL_OPACITY = 0.2
const FINAL_OPACITY = 0.1

interface Claim {
    count: number
    position: string
    overflow: string
}

// Ripples running on one host. The host's own styles come back when the last one ends.
const claims = new WeakMap<HTMLElement, Claim>()
const listeners = new WeakMap<HTMLElement, (event: Event) => void>()

function reducedMotion(): boolean {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The distance from the pointer to the farthest corner: the ripple must cover the whole host. */
function furthestCorner(x: number, y: number, width: number, height: number): number {
    return Math.max(
        Math.hypot(x, y),
        Math.hypot(width - x, y),
        Math.hypot(x, height - y),
        Math.hypot(width - x, height - y),
    )
}

function claim(el: HTMLElement): void {
    let state = claims.get(el)
    if (!state) {
        state = { count: 0, position: el.style.position, overflow: el.style.overflow }
        claims.set(el, state)
        // The ripple is absolutely placed, so the host must be a containing block,
        // and it is clipped to the host's (rounded) corners.
        const style = getComputedStyle(el)
        if (!style.position || style.position === 'static') el.style.position = 'relative'
        if (style.overflow !== 'hidden') el.style.overflow = 'hidden'
    }
    state.count++
}

function release(el: HTMLElement): void {
    const state = claims.get(el)
    if (!state) return
    state.count--
    if (state.count > 0) return
    el.style.position = state.position
    el.style.overflow = state.overflow
    claims.delete(el)
}

function ripple(event: PointerEvent, el: HTMLElement): void {
    if (reducedMotion()) return

    const box = el.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const size = 2.05 * furthestCorner(x, y, box.width, box.height) // 2.05: the same overshoot v-wave used

    const span = document.createElement('span')
    span.setAttribute('aria-hidden', 'true')
    Object.assign(span.style, {
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: WAVE_COLOR,
        pointerEvents: 'none',
        // The resting state, so a browser without the Web Animations API shows nothing.
        transform: 'translate(-50%, -50%) scale(0)',
        opacity: String(INITIAL_OPACITY),
    })

    const total = DURATION_MS + DISSOLVE_MS
    claim(el)
    el.appendChild(span)

    if (typeof span.animate === 'function') {
        span.animate(
            [
                { transform: 'translate(-50%, -50%) scale(0)', opacity: INITIAL_OPACITY, easing: 'ease-out' },
                { offset: DURATION_MS / total, transform: 'translate(-50%, -50%) scale(1)', opacity: FINAL_OPACITY, easing: 'linear' },
                { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
            ],
            { duration: total, fill: 'forwards' },
        )
    }

    // The timer, not the animation's finish event, removes the span: it also
    // works where there is no Web Animations API, and in tests without timers.
    setTimeout(() => {
        span.remove()
        release(el)
    }, total)
}

const vWave: Directive<HTMLElement> = {
    mounted(el) {
        const onPointerDown = (event: Event) => ripple(event as PointerEvent, el)
        listeners.set(el, onPointerDown)
        el.addEventListener('pointerdown', onPointerDown)
    },
    unmounted(el) {
        const onPointerDown = listeners.get(el)
        if (onPointerDown) el.removeEventListener('pointerdown', onPointerDown)
        listeners.delete(el)
    },
}

export default vWave
