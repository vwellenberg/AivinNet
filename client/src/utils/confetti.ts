// ---------------------------------------------------------------------------
// Konfetti for a moment somebody chose: a device joined the group, the first
// playlist was made. One burst, then the layer is gone. No counter, no loop.
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

export function celebrate(pieces = PIECES): void {
    if (typeof document === 'undefined' || prefersLessMotion()) return

    const styles = getComputedStyle(document.documentElement)
    const colours = ACCENTS.map(name => styles.getPropertyValue(name).trim()).filter(Boolean)

    const layer = document.createElement('div')
    layer.className = 'confetti-layer'
    layer.setAttribute('aria-hidden', 'true')

    for (let i = 0; i < pieces; i++) {
        const piece = document.createElement('span')
        piece.className = `confetti-piece confetti-${SHAPES[i % SHAPES.length]}`
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
