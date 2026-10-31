/**
 * The particles a season drifts across the screen (components/SeasonParticles.vue):
 * how many, where, and how fast. Pure: the random source is passed in, so a
 * test can pin the layout. The motion itself is CSS in the component.
 */
import type { Season } from './seasons'

export type ParticleKind = 'flake' | 'bat' | 'ghost' | 'pumpkin' | 'vampire' | 'chase' | 'frankenstein'

export interface Particle {
    kind: ParticleKind
    /**
     * The emoji of a Halloween particle, one span each, in order. A chase has
     * several (the runner first). Empty for a snowflake and for Frankenstein's
     * monster, which are drawn in CSS.
     */
    group: string[]
    /** Start position, % of the viewport width (flakes, ghosts). */
    left: number
    /** Height, % of the viewport (everything that crosses does so at this height). */
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
    /** Everything that crosses: 1 goes left to right, -1 right to left. */
    dir: 1 | -1
}

/** The most particles on screen at once. Each one is a DOM element with a running animation. */
export const MAX_PARTICLES = 25

/** A dusting, not a blizzard. */
const SNOWFLAKES = 18

/**
 * The chase: a person running in front, the zombies a little behind. Person
 * first, so the leftmost span is the runner (the chase crosses right to left).
 */
export const CHASE_GROUP = ['🏃', '\u{1F9DF}', '\u{1F9DF}\u200D\u2642\uFE0F']

/** Halloween: a few, and most of them only now and then. */
const HALLOWEEN: { kind: ParticleKind; group: string[]; count: number }[] = [
    { kind: 'bat', group: ['🦇'], count: 3 },
    { kind: 'ghost', group: ['👻'], count: 2 },
    { kind: 'pumpkin', group: ['🎃'], count: 1 },
    { kind: 'vampire', group: ['🧛'], count: 1 },
    { kind: 'chase', group: CHASE_GROUP, count: 1 },
    // No emoji for the monster: a pixel head in CSS (components/SeasonParticles.vue).
    { kind: 'frankenstein', group: [], count: 1 },
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
        group: [],
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

/**
 * How much rarer than the first cut the crossers come by (user, 2026-10-30:
 * "a little less often"). Their cycles are this much longer, and the crossing
 * takes that much less of a cycle (`season-cross` in SeasonParticles.vue, 8 %
 * instead of 12 %), so each one crosses as fast as before, only less often.
 */
export const HALLOWEEN_RARITY = 1.5

function halloweenParticle(random: () => number, kind: ParticleKind, group: string[]): Particle {
    const base = { kind, group, left: 0, top: 0, drift: 0, wobble: 0, dir: sign(random) }
    const rare = HALLOWEEN_RARITY
    if (kind === 'bat') {
        // Crosses in a short part of its cycle, then is gone for a while. Always
        // right to left: the 🦇 emoji faces left, and one flying backwards looked
        // wrong (user, 2026-10-30).
        return {
            ...base,
            dir: -1,
            top: between(random, 10, 70),
            size: 24,
            duration: between(random, 60, 90) * rare,
            delay: between(random, 0, 40),
            wobble: between(random, 0.9, 1.4),
        }
    }
    if (kind === 'ghost') {
        // Floats up in the first half of its cycle (`season-rise`), slowly, then
        // stays away for as long again: half as often as when it never stopped.
        const duration = between(random, 45, 60) * 2
        return {
            ...base,
            left: between(random, 5, 95),
            size: 30,
            duration,
            delay: -between(random, 0, duration),
            wobble: between(random, 3, 5),
        }
    }
    if (kind === 'vampire') {
        // Swoops across high up like the bats, only slower and less often.
        return {
            ...base,
            top: between(random, 8, 35),
            size: 32,
            duration: between(random, 90, 120) * rare,
            delay: between(random, 20, 60),
            wobble: between(random, 1.6, 2.2),
        }
    }
    if (kind === 'chase') {
        // The runner and the zombies cross the bottom band, now and then, as one
        // group. Always right to left: the runner faces the way it runs, and the
        // zombies follow it. The timing is the old lone zombie's, so the chase is
        // no more frequent than the zombie was.
        return {
            ...base,
            dir: -1,
            top: between(random, 72, 84),
            size: 34,
            duration: between(random, 120, 160) * rare,
            delay: between(random, 10, 40),
            wobble: between(random, 0.7, 1),
        }
    }
    if (kind === 'frankenstein') {
        // Shamble along the bottom of the screen, now and then, one at a time,
        // and after the chase: the monster waits longer than the chase does.
        return {
            ...base,
            top: between(random, 72, 84),
            size: 34,
            duration: between(random, 120, 160) * rare,
            delay: between(random, 50, 90),
            wobble: between(random, 0.7, 1),
        }
    }
    // The pumpkin: rare, a long wait, then a slow roll across the lower screen.
    return {
        ...base,
        top: between(random, 55, 80),
        size: 30,
        duration: between(random, 150, 200) * rare,
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
        for (const { kind, group, count } of HALLOWEEN) {
            for (let i = 0; i < count; i++) out.push(halloweenParticle(random, kind, group))
        }
    }
    return out.slice(0, MAX_PARTICLES)
}
