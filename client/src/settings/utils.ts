import useAuth from "@/stores/auth"

export const loggedInUserIsAdmin = () => {
    const auth = useAuth()
    return auth.is_admin
}

// One guest account is shared by every guest, so the server refuses it the
// per-account writes (the Home layout answers 403): no page for those.
export const loggedInUserIsGuest = () => {
    const auth = useAuth()
    return (auth.user.roles ?? []).includes("guest")
}
