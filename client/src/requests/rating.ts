import { paths } from '@/config'
import { NotifType } from '@/enums'
import useAxios from './useAxios'

import { useToast as notif } from '@/stores/notification'

/**
 * Sets the current user's rating (1-5) of a track. Resolves to true on success.
 * A failure is reported to the user here; the caller rolls its own state back.
 */
export async function setTrackRating(trackhash: string, rating: number): Promise<boolean> {
    const { error } = await useAxios({
        url: paths.api.setRating,
        props: { trackhash, rating },
    })

    if (error) {
        notif().showNotification('Rating could not be saved', NotifType.Error)
        return false
    }

    return true
}

/** Removes the current user's rating of a track. Resolves to true on success. */
export async function clearTrackRating(trackhash: string): Promise<boolean> {
    const { error } = await useAxios({
        url: paths.api.clearRating,
        props: { trackhash },
    })

    if (error) {
        notif().showNotification('Rating could not be removed', NotifType.Error)
        return false
    }

    return true
}

/** Every track the current user has rated, as `trackhash -> rating`. */
export async function getAllTrackRatings(): Promise<Record<string, number>> {
    const { data, error } = await useAxios({
        url: paths.api.allRatings,
        method: 'GET',
    })

    if (error || !data) return {}

    return (data as { ratings: Record<string, number> }).ratings ?? {}
}
