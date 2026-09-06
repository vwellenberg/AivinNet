import { brightness } from '@nextcss/color-tools'
import rgb2Hex from '@/utils/colortools/rgb2Hex'

export function getTypeColor(color: string) {
    const lightness = brightness(rgb2Hex(color))
    const is_light = lightness > 50
    return is_light ? 'rgb(109, 69, 16)' : '#ac8e68'
}

/**
 * Parses a colour string in either `#rgb`, `#rrggbb` or `rgb(r, g, b)` form
 * into a `[r, g, b]` tuple (each 0–255). Returns black on anything unparseable.
 */
export function parseColor(c: string): [number, number, number] {
    if (!c) return [0, 0, 0]
    c = c.trim()
    if (c.startsWith('#')) {
        if (c.length === 4) {
            const r = parseInt(c[1] + c[1], 16)
            const g = parseInt(c[2] + c[2], 16)
            const b = parseInt(c[3] + c[3], 16)
            return [r, g, b]
        }
        return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
    }
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
    return [0, 0, 0]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
    let h = 0, s = 0
    const l = (max + min) / 2
    if (delta !== 0) {
        s = delta / (1 - Math.abs(2 * l - 1))
        if (max === r) h = ((g - b) / delta + 6) % 6
        else if (max === g) h = (b - r) / delta + 2
        else h = (r - g) / delta + 4
        h /= 6
    }
    return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs((h * 6) % 2 - 1))
    const m = l - c / 2
    let r = 0, g = 0, b = 0
    const sector = Math.floor(h * 6)
    switch (sector) {
        case 0: r = c; g = x; b = 0; break
        case 1: r = x; g = c; b = 0; break
        case 2: r = 0; g = c; b = x; break
        case 3: r = 0; g = x; b = c; break
        case 4: r = x; g = 0; b = c; break
        default: r = c; g = 0; b = x; break
    }
    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Returns a dark, rich `#rrggbb` version of the given colour: keeps the hue,
 * ensures a saturation floor (so it doesn't wash out to grey) and forces the
 * lightness to `lightnessPct` (default 16 %). Used to build the dark, Spotify-
 * style page gradient that fades to the page background.
 */
export function darkenHex(color: string, lightnessPct = 16, satFloor = 0.5): string {
    if (!color) return ''
    const [r, g, b] = parseColor(color)
    const [h, s] = rgbToHsl(r, g, b)
    return hslToHex(h, Math.max(s, satFloor), lightnessPct / 100)
}

export function vibrateHex(hex: string): string {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return hex
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min

    let h = 0, s = 0
    let l = (max + min) / 2

    if (delta !== 0) {
        s = delta / (1 - Math.abs(2 * l - 1))
        if (max === r) h = ((g - b) / delta + 6) % 6
        else if (max === g) h = (b - r) / delta + 2
        else h = (r - g) / delta + 4
        h /= 6
    }

    // boost saturation to at least 65%, clamp lightness to 25-40% for vivid visible gradient
    s = Math.max(s, 0.65)
    l = Math.min(Math.max(l, 0.25), 0.40)

    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs((h * 6) % 2 - 1))
    const m = l - c / 2

    let r1 = 0, g1 = 0, b1 = 0
    const sector = Math.floor(h * 6)
    switch (sector) {
        case 0: r1 = c; g1 = x; b1 = 0; break
        case 1: r1 = x; g1 = c; b1 = 0; break
        case 2: r1 = 0; g1 = c; b1 = x; break
        case 3: r1 = 0; g1 = x; b1 = c; break
        case 4: r1 = x; g1 = 0; b1 = c; break
        default: r1 = c; g1 = 0; b1 = x; break
    }

    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
    return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`
}