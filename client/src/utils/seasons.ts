/**
 * SEASONAL SCHEMES (#543). On a few dates the Memphis look changes its
 * colours: pumpkin and violet in the week up to Halloween (24–31 October, and
 * 1 November when that is a Sunday), snow sprinkles from 10 to 30 December, and
 * midnight blue and gold on New Year's Eve and Day (#674).
 *
 * The date only paints OVER the user's choice. The stored colour scheme
 * (utils/theme.ts) is never written here, so it comes back the next day, and
 * the switch in Settings → Appearance turns the whole overlay off.
 */
import { ref } from 'vue'
import { lookHasPalettes, type Look, type Palette } from './theme'

export type Season = 'halloween' | 'christmas' | 'newyear'

/**
 * The season Settings → Appearance forces for this tab, in place of the date.
 * Never stored: a reload clears it, and the stored scheme is not touched.
 */
export const seasonPreview = ref<Season | null>(null)

export function setSeasonPreview(season: Season | null): void {
    seasonPreview.value = season
}

/**
 * The palette a season paints. Christmas also swaps the sprinkle
 * (Global/_seasons.scss, `html.season-christmas`).
 */
const SEASON_PALETTE: Partial<Record<Season, Palette>> = { halloween: 'halloween', christmas: 'christmas', newyear: 'newyear' }

/** The season a LOCAL calendar date falls in, or null. `getMonth()` is 0-based. */
export function seasonOn(now: Date = new Date()): Season | null {
    const month = now.getMonth()
    const day = now.getDate()
    // Halloween ends on Halloween itself (user, 2026-11-05, reverting the week
    // after from #673), but a Halloween on a Saturday keeps its weekend: the
    // Sunday after still counts. `getDay()` is 0 on a Sunday. Christmas from
    // the 10th to the 30th; New Year's Eve has the 31st and New Year's Day (#674).
    if (month === 9 && day >= 24) return 'halloween'
    if (month === 10 && day === 1 && now.getDay() === 0) return 'halloween'
    if (month === 11 && day >= 10 && day <= 30) return 'christmas'
    if ((month === 11 && day === 31) || (month === 0 && day === 1)) return 'newyear'
    return null
}

/**
 * The season that paints the app now, or null. Only the Memphis look wears
 * one, as it does a colour scheme. A preview stands in for the date and does
 * not wait for the switch: choosing a season there is the explicit request.
 */
export function activeSeason(now: Date, look: Look, enabled: boolean): Season | null {
    if (!lookHasPalettes(look)) return null
    if (seasonPreview.value) return seasonPreview.value
    return enabled ? seasonOn(now) : null
}

/** The scheme to paint: the season's own, or the stored choice. */
export function paintedPalette(stored: Palette, season: Season | null): Palette {
    return (season && SEASON_PALETTE[season]) || stored
}
