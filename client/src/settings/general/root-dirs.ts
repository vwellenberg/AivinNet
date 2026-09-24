import { Setting } from '@/interfaces/settings'
import { addRootDirs as editRootDirs, triggerScan } from '@/requests/settings/rootdirs'
import { SettingType } from '../enums'
import { manageRootDirsStrings as data } from '../strings'

import useModalStore from '@/stores/modal'
import settings from '@/stores/settings'

const text = data.settings

const change_root_dirs: Setting = {
    title: text.change,
    type: SettingType.button,
    state: null,
    button_text: () => `\xa0 \xa0 ${settings().root_dirs.length ? 'Modify' : 'Configure'} \xa0 \xa0`,
    action: () => useModalStore().showRootDirsPromptModal(),
}

const list_root_dirs: Setting = {
    title: text.list_root_dirs,
    type: SettingType.root_dirs,
    state: () =>
        settings().root_dirs.map(d => ({
            title: d,
            action: () => {
                editRootDirs([], [d]).then(all_dirs => {
                    settings().setRootDirs(all_dirs)
                })
            },
        })),
    defaultAction: () => {},
    action: () => triggerScan(),
}

export default [change_root_dirs, list_root_dirs]
