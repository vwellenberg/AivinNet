import { Option, SmartPlaylist } from '@/interfaces'
import { DeleteIcon, PencilIcon, PlaylistIcon } from '@/icons'
import useModalStore from '@/stores/modal'

/**
 * The entries of a smart playlist's menu: the card's right-click and the
 * page's overflow button share them. What a smart playlist can do is edit its
 * rules, freeze them into a playlist, or delete the rules. It holds no tracks
 * of its own, so there is no add, remove or reorder here.
 */
export default (smart: SmartPlaylist): Option[] => {
    const modal = useModalStore()

    const edit: Option = {
        label: 'Edit rules',
        icon: PencilIcon,
        action: () => modal.showSmartPlaylistEditor({ playlist: smart }),
    }

    const saveAs: Option = {
        label: 'Save as playlist',
        icon: PlaylistIcon,
        action: () => modal.showSaveSmartPlaylistModal(smart.id, smart.name),
    }

    const remove: Option = {
        label: 'Delete',
        icon: DeleteIcon,
        critical: true,
        action: () => modal.showDeleteSmartPlaylistModal(smart.id),
    }

    return [edit, saveAs, remove]
}
