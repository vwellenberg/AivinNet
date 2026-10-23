import { paths } from '@/config'
import useAxios from './useAxios'

export async function getRecents(path: string, limit: number) {
    const { data } = await useAxios({
        url: path + '?limit=' + limit,
        method: 'GET',
    })

    return data
}

export async function getRecentlyAdded(limit: number) {
    return getRecents(paths.api.home.recentlyAdded, limit)
}

export async function getRecentlyPlayed(limit: number) {
    return getRecents(paths.api.home.recentlyPlayed, limit)
}

export async function getHomePageData(limit: number) {
    const { data } = await useAxios({
        url: paths.api.home.base + '/?limit=' + limit,
        method: 'GET',
    })

    return data
}

/** A random album from the whole library, for Home's "Surprise me". */
export async function getSurpriseAlbum(): Promise<string | null> {
    const { data } = await useAxios({
        url: paths.api.home.surprise,
        method: 'GET',
    })

    return data?.albumhash ?? null
}

/** One Home row as the settings list it (#532). */
export interface HomeLayoutRow {
    key: string
    title: string
    description: string
    visible: boolean
    // Shown or hidden, never moved: "Continue listening" is drawn on top anyway.
    pinned: boolean
}

/** The user's Home rows in their order, with which of them are shown. */
export async function getHomeLayout() {
    return await useAxios({
        url: paths.api.home.layout,
        method: 'GET',
    })
}

/**
 * Store the user's Home layout: every row key in order, and the hidden ones.
 * The server answers with the layout as it kept it (unknown keys dropped).
 */
export async function setHomeLayout(order: string[], hidden: string[]) {
    return await useAxios({
        url: paths.api.home.layout,
        method: 'PUT',
        props: { order, hidden },
    })
}
