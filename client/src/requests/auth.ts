import { paths } from '@/config'
import useAxios from './useAxios'
import { User, UserSimplified } from '@/interfaces'

export async function getAllUsers<T extends boolean>(simple: T = true as T) {
    interface Response {
        users: T extends true ? UserSimplified[] : User[]
        settings: { [key: string]: any }
    }
    const res = await useAxios({
        url: paths.api.auth.allUsers + (simple ? '?simplified=true' : ''),
        method: 'GET',
    })

    if (res.status === 200) {
        return res.data as Response
    }

    if (res.status === 401) {
        const res = await logoutUser()

        if (res.status === 200) {
            return await getAllUsers()
        }
    }

    return {
        users: [],
        settings: {},
    }
}

export async function loginUser(username: string, password: string) {
    const res = await useAxios({
        url: paths.api.auth.login,
        props: {
            username,
            password,
        },
    })

    return res
}

export async function logoutUser() {
    const res = await useAxios({
        url: paths.api.auth.logout,
        method: 'GET',
    })

    return res
}

export async function getLoggedInUser() {
    const res = await useAxios({
        url: paths.api.auth.currentUser,
        method: 'GET',
    })

    return res
}

export async function updateUserProfile(user: any) {
    const res = await useAxios({
        url: paths.api.auth.updateProfile,
        method: 'PUT',
        props: user,
    })

    return res
}

export async function uploadProfileImage(formData: FormData) {
    return await useAxios({
        url: paths.api.auth.updateProfileImage,
        method: 'PUT',
        props: formData,
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    })
}

export async function removeProfileImage() {
    return await useAxios({
        url: paths.api.auth.updateProfileImage,
        method: 'DELETE',
    })
}

export async function addNewUser(user: any) {
    const res = await useAxios({
        url: paths.api.auth.addUser,
        method: 'POST',
        props: user,
    })

    return res
}

export async function addGuestUser() {
    return await useAxios({
        url: paths.api.auth.addGuestUser,
        method: 'POST',
    })
}

export async function deleteUser(username: string) {
    return await useAxios({
        url: paths.api.auth.deleteUser,
        method: 'DELETE',
        props: {
            username,
        },
    })
}

export async function sendPairRequest() {
    return await useAxios({
        url: paths.api.auth.pair,
        method: 'GET',
    })
}

/**
 * Redeem a pairing code (QR deep-link flow). `setcookie=true` makes the
 * backend set the auth cookie on the response, logging this browser in.
 */
export async function pairWithCode(code: string) {
    return await useAxios({
        url: paths.api.auth.redeemPair + '?code=' + encodeURIComponent(code) + '&setcookie=true',
        method: 'GET',
    })
}