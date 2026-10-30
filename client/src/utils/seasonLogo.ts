/**
 * The logo planet dresses up for the seasons (utils/seasons.ts): a carved
 * pumpkin for Halloween, a Christmas bauble for Christmas. Same pixel grid as
 * the planet, so the outline, the hover spin and the orbit fit unchanged.
 *
 * App.vue owns the active season (it already reads date, look and the switch in
 * Settings → Appearance) and provides it; both logos read it from there, so a
 * turned-off overlay or a Settings preview reaches the logo too.
 */
import { computed, inject, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'

import christmasLogo from '@/assets/icons/logos/logo-christmas.png'
import halloweenLogo from '@/assets/icons/logos/logo-halloween.png'
import planetLogo from '@/assets/icons/logos/logo-subspaceradio.png'
import type { Season } from './seasons'

export const SEASON_KEY: InjectionKey<Ref<Season | null>> = Symbol('season')

const LOGOS: Record<Season, string> = { halloween: halloweenLogo, christmas: christmasLogo }

export function logoFor(season: Season | null): string {
    return season ? LOGOS[season] : planetLogo
}

/** The logo for the season App.vue provides; the plain planet without one. */
export function useSeasonLogo(): ComputedRef<string> {
    const season = inject(SEASON_KEY, ref(null))
    return computed(() => logoFor(season.value))
}
