import { parseColor } from '@/utils/colortools'
import brandColors from '@/brand-colors.json'
import useSettings from '@/stores/settings'

// AivinNet brand colours — re-exported from the single source of truth
// (src/brand-colors.json, which also feeds SCSS $brand-green / $brand-red via
// vite.config). Import these anywhere a brand colour is needed in TS/Vue.
export const BRAND_GREEN = brandColors.green
export const BRAND_RED = brandColors.red

// Memphis design palette — the TS-side view of the same JSON source that
// feeds the SCSS $mem-* tokens. These are the MEMPHIS LITERALS: a colour set
// from script that should follow the colour scheme reads `var(--mem-<role>)`
// instead (#395, paletteTokens.test.ts). Use these only where a var() cannot
// resolve, e.g. an SVG attribute.
export const MEMPHIS = brandColors.memphis

/**
 * Single source of truth for the page TINT of the detail views (Album /
 * Artist / Playlist / Now Playing). The memphis ground (grid + doodles) lives
 * on the content shell (#acontent, app-grid.scss); the views put the extracted
 * cover colour (colors.bg) on `--page-tint`, and `.v-scroll-page` paints a
 * translucent fade of it over the ground that lets the grid and doodles show
 * through.
 *
 * A colour, not a gradient: `--page-tint` is a registered <color> property
 * (app-grid.scss), so the browser can TRANSITION it. A gradient image cannot
 * be transitioned — a switch from one playlist to the next jumped from one
 * colour to none (the store resets while the new cover is read) and then to
 * the next, a visible flicker. Now it fades out and the new colour fades in.
 *
 * The veil can be switched off in Settings -> Appearance ("Cover-tinted page
 * gradient"), which leaves the bare grid-paper ground on those pages. The
 * setting is read HERE rather than in each view, so the detail views keep
 * sharing exactly one decision (see CLAUDE.md: do not duplicate the gradient
 * per view). Called during render, so the store read makes the views re-render
 * when the setting flips.
 */
export function pageTint(bg?: string): string {
    // `transparent`, the property's initial value: "no veil" fades out like a
    // colour change does.
    if (!bg || !useSettings().use_page_gradient) return 'transparent'
    const [r, g, b] = parseColor(bg)
    return `rgb(${r}, ${g}, ${b})`
}

/**
 * Page background for the top-level library pages (Home, Favorites,
 * Playlists, Stats). Transparent like the detail views — the shared
 * grid-paper ground lives on the content shell.
 */
export function brandGradient(color: string = BRAND_GREEN): string {
    void color
    return 'transparent'
}
