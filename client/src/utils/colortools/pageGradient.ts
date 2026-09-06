import { parseColor } from '@/utils/colortools'
import brandColors from '@/brand-colors.json'
import useSettings from '@/stores/settings'

// AivinNet brand colours — re-exported from the single source of truth
// (src/brand-colors.json, which also feeds SCSS $brand-green / $brand-red via
// vite.config). Import these anywhere a brand colour is needed in TS/Vue.
export const BRAND_GREEN = brandColors.green
export const BRAND_RED = brandColors.red

// Memphis design palette — the TS-side view of the same JSON source that
// feeds the SCSS $mem-* tokens. Use these for any colour set from script.
export const MEMPHIS = brandColors.memphis

/**
 * Single source of truth for the page background of the detail views
 * (Album / Artist / Playlist). The memphis ground (grid + doodles) lives on
 * the content shell (#acontent, app-grid.scss); this paints a LIGHT
 * cover-tinted veil over it — a translucent fade from the extracted cover
 * colour (colors.bg) that lets the grid and doodles show through, echoing
 * the old Spotify-style header fade in a memphis-compatible way.
 *
 * The veil can be switched off in Settings -> Appearance ("Cover-tinted page
 * gradient"), which leaves the bare grid-paper ground on those pages. The
 * setting is read HERE rather than in each view, so the three detail views
 * keep sharing exactly one decision (see CLAUDE.md: do not duplicate the
 * gradient per view). Called during render, so the store read makes the views
 * re-render when the setting flips.
 */
export function pageGradient(bg?: string): string {
    // `none`, not `transparent`: the veil is a background IMAGE now (see
    // `.v-scroll-page .scroller` in app-grid.scss), and `transparent` is not a
    // valid <image> — the whole declaration would be dropped instead of
    // resolving to "no veil".
    if (!bg || !useSettings().use_page_gradient) return 'none'
    const [r, g, b] = parseColor(bg)
    const stop = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`
    // Slightly stronger than the first memphis iteration (0.55/0.25): with the
    // reference-copied doodles the header band needs more wash so the muted
    // metadata lines stay readable over saturated shapes (judge finding).
    return `linear-gradient(180deg, ${stop(0.72)} 0%, ${stop(0.42)} 240px, ${stop(0)} 460px)`
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
