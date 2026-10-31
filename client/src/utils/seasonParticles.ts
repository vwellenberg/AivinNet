/**
 * The particles a season drifts across the screen (components/SeasonParticles.vue):
 * how many, where, and how fast. Pure: the random source is passed in, so a
 * test can pin the layout. The motion itself is CSS in the component.
 */
import type { Season } from './seasons'

export type ParticleKind = 'flake' | 'bat' | 'ghost' | 'pumpkin' | 'chase' | 'spider' | 'sleigh'

export interface Particle {
    kind: ParticleKind
    /**
     * The emoji of a Halloween particle, one span each, in order. A chase has
     * several, the runner FIRST (the leftmost: a chase runs right to left, so it
     * leads). Empty for a snowflake.
     */
    group: string[]
    /** Start position, % of the viewport width (flakes, ghosts, spiders). */
    left: number
    /**
     * Height, % of the viewport, for the sky lanes (bats, flakes). Zero for the
     * ground lane (`ground`), which is anchored to the player bar instead, and
     * for spiders, which hang from the top edge.
     */
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
    /**
     * The ground lane: the group stands on the player bar's top edge, lifted
     * by `lift` rem above it, so no part of it is ever drawn under the bar
     * (components/SeasonParticles.vue, `bottom` from the bar's own tokens).
     */
    ground: boolean
    /** Ground lane only: rem above the player bar's top edge. */
    lift: number
    /** Spider only: how far the thread lets it down, % of the viewport height. */
    drop: number
    /**
     * Chase only: where each glyph stands, parallel to `group`, in glyph sizes from
     * the runner's spot: x to the right, y up (never positive, so no glyph drops
     * below the ground lane). The runner is (0, 0). Empty for every other group,
     * which is a plain row.
     */
    offsets: GlyphOffset[]
    /** Chase only: the box the cluster needs, in glyph sizes (w to the right of the runner, h up from the ground). */
    extent: { w: number; h: number }
}

/** A glyph's place in a cluster (see Particle.offsets). */
export interface GlyphOffset {
    x: number
    y: number
}

/** The most particles on screen at once. Each one is a DOM element with a running animation. */
export const MAX_PARTICLES = 25

/** A dusting, not a blizzard. */
const SNOWFLAKES = 18

/*
 * The chase: the runner in front, then a horde of zombies clustered behind it
 * (`chaseHorde`). The runner is the FIRST span, the leftmost, because the chase
 * always goes right to left (`dir` is -1 for every chase) and the 🏃 emoji faces
 * LEFT: it runs the way it looks.
 *
 * ⚠️ It went left to right once, on the claim that 🏃 faces right. It faces
 * left — Unicode 15.1 added "person running facing right" (🏃‍➡️) precisely
 * because the plain one does not — and in the running app the runner ran
 * backwards behind the zombies (user, 2026-10-31). Not 🏃‍➡️ either: a font
 * without the 15.1 sequence draws it as 🏃 plus an arrow.
 */
/** The chase's zombies: the plain one and the two gendered ones, mixed at random. */
export const ZOMBIE_GLYPHS = ['\u{1F9DF}', '\u{1F9DF}‍♂️', '\u{1F9DF}‍♀️']

/**
 * How many zombies a horde brings: 8 to 10 in most chases (CHASE_ZOMBIES_MIN to
 * CHASE_ZOMBIES_TYPICAL_MAX), and in one chase of three a bigger one, 11 to
 * CHASE_ZOMBIES_MAX (`chaseZombieCount`).
 */
export const CHASE_ZOMBIES_MIN = 8
export const CHASE_ZOMBIES_TYPICAL_MAX = 10
export const CHASE_ZOMBIES_MAX = 16
/** The share of chases with the bigger horde: one in three (user, 2026-10-31: "teils noch mehr"). */
export const CHASE_BIG_SHARE = 1 / 3

/**
 * The cluster behind the runner. Zombies fill it column by column, HORDE_ROWS to a
 * column: the front row on the ground, the rows behind it raised by HORDE_ROW_RISE
 * each, so it reads as a crowd and not as a line. Every other row steps half a
 * column, so the glyphs pack like a blob. HORDE_JITTER loosens every glyph.
 */
const HORDE_ROWS = 3
const HORDE_COLUMN_STEP = 0.75
const HORDE_ROW_RISE = 0.45
const HORDE_JITTER = 0.15
/**
 * The runner's lead over the horde, in glyph sizes: it runs AHEAD of them. Without
 * it the first column stood on the runner's heels and half covered it (the runner
 * is drawn a third bigger, SeasonParticles.vue).
 */
const HORDE_LEAD = 0.6

/** A whole number in [0, n), from the random source. */
function pick(random: () => number, n: number): number {
    return Math.min(n - 1, Math.floor(random() * n))
}

/** How many zombies one chase brings: 8 to 10 in two chases of three, 11 to 16 in the third. */
export function chaseZombieCount(random: () => number): number {
    if (random() >= CHASE_BIG_SHARE) {
        return CHASE_ZOMBIES_MIN + pick(random, CHASE_ZOMBIES_TYPICAL_MAX - CHASE_ZOMBIES_MIN + 1)
    }
    return CHASE_ZOMBIES_TYPICAL_MAX + 1 + pick(random, CHASE_ZOMBIES_MAX - CHASE_ZOMBIES_TYPICAL_MAX)
}

/** One chase: the runner first, then its zombies, with where each stands and the box the cluster needs. */
export interface ChaseHorde {
    group: string[]
    offsets: GlyphOffset[]
    extent: { w: number; h: number }
}

/** A chase's horde: the runner at (0, 0) in front, the zombies clustered behind it (see HORDE_ROWS). */
export function chaseHorde(random: () => number): ChaseHorde {
    const zombies = chaseZombieCount(random)
    const group = ['🏃']
    const offsets: GlyphOffset[] = [{ x: 0, y: 0 }]
    for (let j = 0; j < zombies; j++) {
        group.push(ZOMBIE_GLYPHS[pick(random, ZOMBIE_GLYPHS.length)])
        const column = Math.floor(j / HORDE_ROWS) + 1
        const row = j % HORDE_ROWS
        const stagger = row % 2 === 1 ? HORDE_COLUMN_STEP / 2 : 0
        offsets.push({
            x: HORDE_LEAD + column * HORDE_COLUMN_STEP + stagger + (random() * 2 - 1) * HORDE_JITTER,
            // Never positive: a zombie rises from the ground lane, it does not sink into the bar.
            y: -row * HORDE_ROW_RISE - random() * HORDE_JITTER,
        })
    }
    const w = Math.max(...offsets.map((o) => o.x)) + 1
    const h = -Math.min(...offsets.map((o) => o.y)) + 1
    return { group, offsets, extent: { w, h } }
}

/** The spider, on its thread: U+1F577 and the emoji presentation selector. */
export const SPIDER_GLYPH = '\u{1F577}️'

/**
 * The sleigh, left to right on screen: two reindeer, the sled, Santa at the back.
 * It always flies right to left (`dir` -1), so the reindeer are in front, on the
 * left, and the 🦌 emoji faces left by default: it looks the way it flies.
 */
export const SLEIGH_GROUP = ['🦌', '🦌', '🛷', '🎅']

/** Halloween: a few, and most of them only now and then. */
const HALLOWEEN: { kind: ParticleKind; group: string[]; count: number }[] = [
    { kind: 'bat', group: ['🦇'], count: 3 },
    { kind: 'ghost', group: ['👻'], count: 2 },
    { kind: 'pumpkin', group: ['🎃'], count: 1 },
    // The group is drawn per chase (chaseHorde), so it is empty here.
    { kind: 'chase', group: [], count: 1 },
    { kind: 'spider', group: [SPIDER_GLYPH], count: 1 },
]

/** Christmas: the snowflakes, and now and then the sleigh across the upper sky. */
const CHRISTMAS: { kind: ParticleKind; group: string[]; count: number }[] = [
    { kind: 'sleigh', group: SLEIGH_GROUP, count: 1 },
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
        ground: false,
        lift: 0,
        drop: 0,
        offsets: [],
        extent: { w: 0, h: 0 },
    }
}

/**
 * How much rarer than the first cut the crossers come by (user, 2026-10-30:
 * "a little less often"). Their cycles are this much longer, and the crossing
 * takes that much less of a cycle (`season-cross` in SeasonParticles.vue, 8 %
 * instead of 12 %), so each one crosses as fast as before, only less often.
 */
export const CROSSER_RARITY = 1.5

function crosserParticle(random: () => number, kind: ParticleKind, group: string[]): Particle {
    const base = {
        kind,
        group,
        left: 0,
        top: 0,
        drift: 0,
        wobble: 0,
        dir: sign(random),
        ground: false,
        lift: 0,
        drop: 0,
        offsets: [] as GlyphOffset[],
        extent: { w: 0, h: 0 },
    }
    const rare = CROSSER_RARITY
    if (kind === 'bat') {
        // Crosses in a short part of its cycle, then is gone for a while. Always
        // right to left: the 🦇 emoji faces left, and one flying backwards looked
        // wrong (user, 2026-10-30).
        return {
            ...base,
            dir: -1,
            top: between(random, 10, 70),
            // 32, up from 24: "bisserl größer" (user, 2026-10-31).
            size: 32,
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
    if (kind === 'chase') {
        // The runner and its horde cross the bottom lane now and then, as one
        // group, right to left: the runner leads, so it faces the way it runs.
        // The timing is the old lone zombie's, so the chase is no more frequent
        // than the zombie was. The horde is a cluster behind the runner (chaseHorde).
        return {
            ...base,
            ...chaseHorde(random),
            dir: -1,
            ground: true,
            lift: between(random, 2.5, 6),
            size: 30,
            duration: between(random, 120, 160) * rare,
            delay: between(random, 10, 40),
            wobble: between(random, 0.7, 1),
        }
    }
    if (kind === 'sleigh') {
        // Across the upper sky, now and then, always right to left: the reindeer
        // lead. Same rhythm as the chase, so it is exactly as rare; the flight is
        // measured from the group's own width (`crossing`), so it leaves whole.
        return {
            ...base,
            dir: -1,
            top: between(random, 14, 32),
            size: 28,
            duration: between(random, 120, 160) * rare,
            delay: between(random, 10, 60),
            wobble: between(random, 0.8, 1.2),
        }
    }
    if (kind === 'spider') {
        // A spider lets itself down on its thread from the top edge, hangs and
        // sways, and climbs back up. Rare: only a short part of each cycle is
        // visible (season-spider in SeasonParticles.vue).
        return {
            ...base,
            dir: 1,
            left: between(random, 5, 95),
            drop: between(random, 25, 55),
            size: 26,
            duration: between(random, 80, 100) * rare,
            delay: between(random, 10, 60),
            wobble: between(random, 1.6, 2.2),
        }
    }
    // The pumpkin: rare, a long wait, then a slow roll along the lower screen,
    // on the ground lane above the player bar.
    return {
        ...base,
        ground: true,
        lift: between(random, 4, 10),
        size: 30,
        duration: between(random, 150, 200) * rare,
        delay: between(random, 30, 90),
        wobble: between(random, 1.5, 2),
    }
}

/**
 * Where a crosser starts and ends its `translate`, as CSS lengths
 * (SeasonParticles.vue). A single glyph goes from one side of the screen to the
 * other, 12 vw past each edge. A group — the sleigh, the chase — is a whole row
 * of glyphs, wider than that margin at a phone's width (the chase is ~115 px
 * against 47 px of margin at 390 px, so it popped in and out at the edges), so
 * it is measured from its own width instead (`%` in `translate` is the
 * element's own box): it starts and ends fully off screen.
 */
export function crossing(p: Particle): { from: string; to: string } {
    if (p.kind === 'sleigh' || p.kind === 'chase') {
        const off = 'calc(-100% - 1rem)'
        const past = '100vw'
        return p.dir > 0 ? { from: off, to: past } : { from: past, to: off }
    }
    return p.dir > 0 ? { from: '-12vw', to: '112vw' } : { from: '112vw', to: '-12vw' }
}

/**
 * The particles for one season, at most MAX_PARTICLES. No season, no particles.
 * `random` returns values in [0, 1); tests pass a fixed one.
 */
export function particlesFor(season: Season | null, random: () => number = Math.random): Particle[] {
    const out: Particle[] = []
    if (season === 'christmas') {
        for (let i = 0; i < SNOWFLAKES; i++) out.push(snowflake(random))
        for (const { kind, group, count } of CHRISTMAS) {
            for (let i = 0; i < count; i++) out.push(crosserParticle(random, kind, group))
        }
    } else if (season === 'halloween') {
        for (const { kind, group, count } of HALLOWEEN) {
            for (let i = 0; i < count; i++) out.push(crosserParticle(random, kind, group))
        }
    }
    return out.slice(0, MAX_PARTICLES)
}
