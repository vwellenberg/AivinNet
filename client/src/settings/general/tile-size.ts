import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'
import useSettings from '@/stores/settings'
import { TILE_MAX, TILE_MIN, TILE_STEP } from '@/utils/tileSize'

const settings = useSettings

const tileSize: Setting = {
    title: 'Tile size',
    desc: 'How big the playlist, album and artist tiles are. Hold the slider to see the page behind this window.',
    type: SettingType.range,
    range: {
        min: TILE_MIN,
        max: TILE_MAX,
        step: TILE_STEP,
        format: value => `${value} px`,
    },
    peek: true,
    preview: 'tiles',
    state: () => settings().tile_size,
    // The row's text is clickable like every settings row (Group.vue calls
    // `action()` with no argument); for a slider that must do nothing, not reset.
    action: (value?: number) => {
        if (typeof value === 'number') settings().setTileSize(value)
    },
}

export default [tileSize]
