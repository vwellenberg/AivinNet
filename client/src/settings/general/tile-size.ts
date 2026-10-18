import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'
import useSettings from '@/stores/settings'
import { TILE_DEFAULT, TILE_MAX, TILE_MIN, TILE_STEP } from '@/utils/tileSize'

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
    action: (value: number) => settings().setTileSize(value),
    // A click on the row's text resets it, like the other rows' defaultAction.
    defaultAction: () => settings().setTileSize(TILE_DEFAULT),
}

export default [tileSize]
