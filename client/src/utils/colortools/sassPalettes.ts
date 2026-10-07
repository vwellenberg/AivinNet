/**
 * The colour schemes (#395) as a Sass map, for the `additionalData` injection
 * in vite.config.ts that Global/_palettes.scss reads:
 * `("lagune": (light: ("ink": #…, "blush-soft": #…), dark: (…)), …)`.
 *
 * Shared by the build and paletteSchemes.test.ts, so the test checks the key
 * mapping the build really uses: JSON camelCase becomes the kebab-case
 * `--mem-<role>` name. The doodle map stays out — scripts/palette-doodles.mjs
 * applies it to the SVG.
 */
export const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

type Scheme = { light: Record<string, string>; dark: Record<string, string> }

export function sassPalettes(palettes: Record<string, Scheme>): string {
    const map = (obj: Record<string, string>) =>
        '(' +
        Object.entries(obj)
            .map(([k, v]) => `"${kebab(k)}": ${v}`)
            .join(', ') +
        ')'
    return (
        '(' +
        Object.entries(palettes)
            .map(([name, p]) => `"${name}": (light: ${map(p.light)}, dark: ${map(p.dark)})`)
            .join(', ') +
        ')'
    )
}
