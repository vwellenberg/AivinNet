import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'

const restore: Setting = {
    title: 'Backup now',
    desc: 'Backup directory: ~/aivinnet.backup',
    type: SettingType.backup,
    state: () => true,
    action: () => {},
}

export default [restore]
