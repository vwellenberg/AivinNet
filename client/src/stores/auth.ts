import { User } from '@/interfaces'
import useModal from '@/stores/modal'
import { defineStore } from 'pinia'

import {
    addGuestUser,
    addNewUser,
    deleteUser,
    getLoggedInUser,
    loginUser,
    logoutUser,
    removeProfileImage,
    updateUserProfile,
    uploadProfileImage,
} from '@/requests/auth'
import { NotifType, useToast } from '@/stores/notification'

export default defineStore('authStore', {
    state: () => ({
        user: {} as User,
    }),
    actions: {
        async getLoggedInUser() {
            const res = await getLoggedInUser()
            if (res.status === 200) {
                this.setUser(res.data)
            }
        },
        setUser(user: User) {
            this.user = user
        },
        // toast helpers
        showToast(msg: string, type: NotifType) {
            const toast = useToast()
            toast.showNotification(msg, type)
        },
        showSuccess(msg: string) {
            this.showToast(msg, NotifType.Success)
        },
        showError(msg: string) {
            this.showToast(msg, NotifType.Error)
        },
        showGenericError() {
            this.showError('Failed! Something went wrong!')
        },
        showResMsgOrGenericError(res: any) {
            if (res.data.msg) {
                this.showError(res.data.msg)
            } else {
                this.showGenericError()
            }
        },
        // auth actions
        async login(username: string, password: string) {
            const res = await loginUser(username, password)
            const modal = useModal()

            if (res.status === 200) {
                this.showSuccess(res.data.msg)
                modal.hideModal()
                window.location.reload()
            } else {
                this.showResMsgOrGenericError(res)
            }
        },
        async logout() {
            await logoutUser()
            window.location.reload()
        },
        async addNewUser(user: { [key: string]: any }) {
            const res = await addNewUser(user)

            if (res.status === 200) {
                this.showSuccess('User added successfully!')

                return res.data as User
            }

            this.showResMsgOrGenericError(res)
            return false
        },
        async addGuestUser() {
            const res = await addGuestUser()
            if (res.status === 200) {
                this.showSuccess('Guest user added successfully!')
                return true
            }

            this.showResMsgOrGenericError(res)
            return false
        },
        async updateProfile(user: { [key: string]: any }) {
            const res = await updateUserProfile(user)

            if (res.status === 200) {
                // if we're updating self, update the user object
                // NOTE: self update won't have an id
                // When updating self from accounts, the id == this.user.id
                if (!user.id || user.id === this.user.id) {
                    this.user = res.data
                }
                this.showSuccess('Profile updated successfully!')
                return true
            }

            this.showResMsgOrGenericError(res)
            return false
        },
        async uploadAvatar(file: File) {
            const formData = new FormData()
            formData.append('image', file)

            const res = await uploadProfileImage(formData)

            if (res.status === 200) {
                // Backend re-reads the user from the DB, so the response already
                // carries the new image filename.
                this.user = res.data
                this.showSuccess('Profile picture updated!')
                return true
            }

            if (res.status === 400) {
                this.showError('Unsupported image')
                return false
            }

            this.showResMsgOrGenericError(res)
            return false
        },
        async removeAvatar() {
            const res = await removeProfileImage()

            if (res.status === 200) {
                this.user = res.data
                this.showSuccess('Profile picture removed')
                return true
            }

            this.showResMsgOrGenericError(res)
            return false
        },
        async deleteUser(username: string) {
            const res = await deleteUser(username)

            if (res.status === 200) {
                this.showSuccess(`${username} deleted successfully!`)
                return true
            }

            this.showResMsgOrGenericError(res)
            return false
        },
    },
    getters: {
        is_admin(): boolean {
            if (!this.user.roles) {
                return false
            }
            return this.user.roles.includes('admin')
        },
    },
})
