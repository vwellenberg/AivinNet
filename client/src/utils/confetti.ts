// ---------------------------------------------------------------------------
// Konfetti for a moment somebody chose: a device joined the group, the first
// playlist was made. One burst, then the layer is gone. No counter, no loop.
// The one exception is the New Year's shower (celebrateNewYear): a few waves in
// a row, still no loop, each wave its own short-lived layer.
//
// The movement lives in the stylesheet (Global/confetti.scss), like every other
// movement in the app. Here only the pieces are made and aimed.
//
// Under "less motion" nothing is made at all. A piece that only sits at the
// centre of the screen would read as a stain, not as a celebration.
// ---------------------------------------------------------------------------

/** Longer than the burst (0.9s in confetti.scss), so the layer outlives the last piece. */
const LIFETIME_MS = 1000
const PIECES = 26
const SHAPES = ['square', 'circle', 'triangle'] as const
/** The Memphis accents, read from the live palette so a colour scheme recolours the burst. */
const ACCENTS = ['--mem-teal', '--mem-coral', '--mem-yellow', '--mem-lavender', '--mem-blush']

function prefersLessMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * One burst. `from` is the point it flies out of, in viewport pixels (the
 * Rewind card on Home, #572); without one, the middle of the screen.
 */
export function celebrate(pieces = PIECES, from?: { x: number; y: number }): void {
    if (typeof document === 'undefined' || prefersLessMotion()) return

    const styles = getComputedStyle(document.documentElement)
    const colours = ACCENTS.map(name => styles.getPropertyValue(name).trim()).filter(Boolean)

    const layer = document.createElement('div')
    layer.className = 'confetti-layer'
    layer.setAttribute('aria-hidden', 'true')

    for (let i = 0; i < pieces; i++) {
        const piece = document.createElement('span')
        piece.className = `confetti-piece confetti-${SHAPES[i % SHAPES.length]}`
        if (from) {
            piece.style.left = `${Math.round(from.x)}px`
            piece.style.top = `${Math.round(from.y)}px`
        }
        // A fan upwards, about 63 degrees either side of straight up.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4
        const distance = 90 + Math.random() * 130
        // The 90px pull is gravity: the fan falls back down as it spreads.
        piece.style.setProperty('--x', `${Math.round(Math.cos(angle) * distance)}px`)
        piece.style.setProperty('--y', `${Math.round(Math.sin(angle) * distance + 90)}px`)
        piece.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`)
        if (colours.length) piece.style.background = colours[i % colours.length]
        layer.appendChild(piece)
    }

    document.body.appendChild(layer)
    window.setTimeout(() => layer.remove(), LIFETIME_MS)
}

/** The New Year's shower: five waves, one every 600 ms, so the last ends about 3.4 s in. */
const SHOWER_WAVES = 5
const SHOWER_GAP_MS = 600
const SHOWER_PIECES = 35

/**
 * The shower for 1 January (the New Year's pill, #674). Each wave comes from a new point
 * across the upper part of the screen, so the confetti does not fall from one spot.
 *
 * Nothing is made under "less motion", and no timer is scheduled either: the check
 * comes before the first wave, and every later wave is scheduled only after it.
 *
 * Unmounting the pill mid-shower does not cancel the remaining waves. They are
 * short-lived, own no state, and each removes its own layer, so a cancel would only
 * add a handle to keep for no visible gain. The cost: a wave may land after the page
 * has moved on, which is the intended effect of a celebration, not a leak.
 */
export function celebrateNewYear(): void {
    if (typeof document === 'undefined' || prefersLessMotion()) return

    const origin = (): { x: number; y: number } => ({
        x: window.innerWidth * (0.15 + Math.random() * 0.7),
        y: window.innerHeight * (0.1 + Math.random() * 0.3),
    })

    celebrate(SHOWER_PIECES, origin())
    for (let wave = 1; wave < SHOWER_WAVES; wave++) {
        window.setTimeout(() => celebrate(SHOWER_PIECES, origin()), wave * SHOWER_GAP_MS)
    }
}
