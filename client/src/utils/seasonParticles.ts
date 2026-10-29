/**
 * The particles a season drifts across the screen (components/SeasonParticles.vue):
 * how many, where, and how fast. Pure: the random source is passed in, so a
 * test can pin the layout. The motion itself is CSS in the component.
 */
import type { Season } from './seasons'

export type ParticleKind = 'flake' | 'bat' | 'ghost' | 'pumpkin'

export interface Particle {
    kind: ParticleKind
    /** The emoji of a Halloween particle; a snowflake is drawn in CSS. */
    glyph: string
    /** Start position, % of the viewport width (flakes, ghosts). */
    left: number
    /** Height, % of the viewport (bats and pumpkins fly across at this height). */
    top: number
    /** Snowflake diameter, or emoji size, in px. */
    size: number
    /** Seconds per cycle. */
    duration: number
    /** Seconds. Positive waits before the first cycle, negative starts part-way through. */
    delay: number
    /** Snow only: sideways sway, in px. */
    drift: number
    /** Seconds per flutter or bob of an emoji. */
    wobble: number
    /** Bats and pumpkins: 1 flies left to right, -1 right to left. */
    dir: 1 | -1
}

/** The most particles on screen at once. Each one is a DOM element with a running animation. */
export const MAX_PARTICLES = 25

/** A dusting, not a blizzard. */
const SNOWFLAKES = 18

/** Halloween: a few, and most of them only now and then. */
const HALLOWEEN: { kind: ParticleKind; glyph: string; count: number }[] = [
    { kind: 'bat', glyph: '🦇', count: 3 },
    { kind: 'ghost', glyph: '👻', count: 2 },
    { kind: 'pumpkin', glyph: '🎃', count: 1 },
]

/** A value between `min` and `max`, from the random source. */
function between(random: () => number, min: number, max: number): number {
    return min + random() * (max - min)
}

function sign(random: () => number): 1 | -1 {
    return random() < 0.5 ? -1 : 1
}

function snowflake(random: () => number): Particle {
    const duration = between(random, 12, 22)
    return {
        kind: 'flake',
        glyph: '',
        left: between(random, 0, 100),
        top: 0,
        size: between(random, 8, 16),
        duration,
        // Negative: each flake starts mid-fall, so the screen is not empty at first.
        delay: -between(random, 0, duration),
        drift: between(random, -40, 40),
        wobble: 0,
        dir: 1,
    }
}

function halloweenParticle(random: () => number, kind: ParticleKind, glyph: string): Particle {
    const base = { kind, glyph, left: 0, top: 0, drift: 0, wobble: 0, dir: sign(random) }
    if (kind === 'bat') {
        // Crosses in about a tenth of its cycle, then is gone for a minute or so.
        return {
            ...base,
            top: between(random, 10, 70),
            size: 24,
            duration: between(random, 60, 90),
            delay: between(random, 0, 40),
            wobble: between(random, 0.9, 1.4),
        }
    }
    if (kind === 'ghost') {
        // Floats up the whole time, slowly.
        const duration = between(random, 45, 60)
        return {
            ...base,
            left: between(random, 5, 95),
            size: 30,
            duration,
            delay: -between(random, 0, duration),
            wobble: between(random, 3, 5),
        }
    }
    // The pumpkin: rare, a long wait, then a slow roll across the lower screen.
    return {
        ...base,
        top: between(random, 55, 80),
        size: 30,
        duration: between(random, 150, 200),
        delay: between(random, 30, 90),
        wobble: between(random, 1.5, 2),
    }
}

/**
 * The particles for one season, at most MAX_PARTICLES. No season, no particles.
 * `random` returns values in [0, 1); tests pass a fixed one.
 */
export function particlesFor(season: Season | null, random: () => number = Math.random): Particle[] {
    const out: Particle[] = []
    if (season === 'christmas') {
        for (let i = 0; i < SNOWFLAKES; i++) out.push(snowflake(random))
    } else if (season === 'halloween') {
        for (const { kind, glyph, count } of HALLOWEEN) {
            for (let i = 0; i < count; i++) out.push(halloweenParticle(random, kind, glyph))
        }
    }
    return out.slice(0, MAX_PARTICLES)
}
