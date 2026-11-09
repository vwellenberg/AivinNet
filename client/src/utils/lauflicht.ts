/**
 * Body classes for the Lauflicht (running light around the now-playing cover).
 *
 * `lauflicht-off` / `lauflicht-subtle` come from the setting. `lauflicht-idle`
 * pauses both animations while nothing plays: the comet spins a registered
 * `--np-angle` into a conic-gradient, which the browser can only repaint on the
 * main thread — every frame, for as long as the tab is visible. It was the one
 * animation running forever on an otherwise idle page, even with playback
 * stopped. Paused (not hidden), the ring still shows where it was; it resumes
 * the moment playback does, which is also what the ring means: "this is playing".
 */
export type LauflichtLevel = 'off' | 'subtle' | 'normal'

export function lauflichtClasses(
    level: LauflichtLevel,
    playing: boolean,
    party: boolean = false,
): Record<string, boolean> {
    return {
        'lauflicht-off': level === 'off',
        'lauflicht-subtle': level === 'subtle',
        'lauflicht-idle': !playing,
        // A group of three or more devices runs the light a notch faster (#548).
        'lauflicht-party': party,
    }
}

/** The keyframes of the Lauflicht (Global/lauflicht.scss). */
export const LAUFLICHT_ANIMATIONS = ['np-comet-spin', 'np-comet-breathe'] as const

/**
 * Put every Lauflicht on the page in step: the comet on the player-bar cover,
 * on the big Now Playing cover and on the playing row's cover all stand at
 * the same angle.
 *
 * A CSS animation starts when its element gets the style, so a cover that
 * appears later (opening Now Playing, the next row turning current, the
 * setting going from `off` to on) ran its comet at its own phase. Copying the
 * `currentTime` of the longest-running copy aligns it once; from then on the
 * shared duration keeps them together, also across the level and party speed
 * changes (the phase is `currentTime / duration` for all of them alike).
 *
 * One-off, no per-frame cost: it reads the animation list and writes a time.
 * `currentTime` and not `startTime` or `play()`: those take the play state over
 * from CSS, and `body.lauflicht-idle` could no longer pause the light.
 */
export function syncLauflicht(doc: Pick<Document, 'getAnimations'> | undefined = globalThis.document): void {
    if (!doc || typeof doc.getAnimations !== 'function') return

    const byName = new Map<string, Animation[]>()
    for (const animation of doc.getAnimations()) {
        // `CSSAnimation` is not a global the lint config knows; its one field is enough.
        const name = (animation as Animation & { animationName?: string }).animationName ?? ''
        if (!(LAUFLICHT_ANIMATIONS as readonly string[]).includes(name)) continue
        byName.set(name, [...(byName.get(name) ?? []), animation])
    }

    for (const copies of byName.values()) {
        if (copies.length < 2) continue
        const time = (a: Animation) => Number(a.currentTime ?? 0)
        const reference = copies.reduce((a, b) => (time(b) > time(a) ? b : a))
        for (const animation of copies) {
            if (animation !== reference) animation.currentTime = reference.currentTime
        }
    }
}
