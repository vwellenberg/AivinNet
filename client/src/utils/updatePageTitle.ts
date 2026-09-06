// The tab always names the PAGE. It used to be a setting ("Show Now Playing
// track on tab title") whose on-state silenced every caller below and let the
// media-session handler write the running track instead — so with it on, the
// tab said the same thing the player bar already says, and no page could name
// itself.
export default (title: string) => {
    const base = 'AivinNet'

    if (title) {
        document.title = `${title} | ${base}`
    } else {
        document.title = base
    }
}
