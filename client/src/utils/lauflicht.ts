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

export function lauflichtClasses(level: LauflichtLevel, playing: boolean): Record<string, boolean> {
    return {
        'lauflicht-off': level === 'off',
        'lauflicht-subtle': level === 'subtle',
        'lauflicht-idle': !playing,
    }
}
