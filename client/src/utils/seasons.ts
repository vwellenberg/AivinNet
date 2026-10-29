/**
 * SEASONAL SCHEMES (#543). On a few dates the Memphis look changes its
 * colours: pumpkin and violet on 31 October, snow sprinkles on 24–26 December.
 *
 * The date only paints OVER the user's choice. The stored colour scheme
 * (utils/theme.ts) is never written here, so it comes back the next day, and
 * the switch in Settings → Appearance turns the whole overlay off.
 */
import { lookHasPalettes, type Look, type Palette } from './theme'

export type Season = 'halloween' | 'christmas'

/**
 * The palette a season paints. Christmas keeps the chosen scheme and only
 * swaps the sprinkle (Global/_seasons.scss, `html.season-christmas`).
 */
const SEASON_PALETTE: Partial<Record<Season, Palette>> = { halloween: 'halloween' }

/** The season a LOCAL calendar date falls in, or null. `getMonth()` is 0-based. */
export function seasonOn(now: Date = new Date()): Season | null {
    const month = now.getMonth()
    const day = now.getDate()
    if (month === 9 && day === 31) return 'halloween'
    if (month === 11 && day >= 24 && day <= 26) return 'christmas'
    return null
}

/**
 * The season that paints the app now, or null. Only the Memphis look wears
 * one, as it does a colour scheme, and only while the switch is on.
 */
export function activeSeason(now: Date, look: Look, enabled: boolean): Season | null {
    return enabled && lookHasPalettes(look) ? seasonOn(now) : null
}

/** The scheme to paint: the season's own, or the stored choice. */
export function paintedPalette(stored: Palette, season: Season | null): Palette {
    return (season && SEASON_PALETTE[season]) || stored
}
