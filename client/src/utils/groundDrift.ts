// ---------------------------------------------------------------------------
// Does the page ground drift on this navigation?
//
// The ground (#acontent) drifts a little against the page's own entrance
// (Global/_button-classes.scss, mem-ground-drift). That is the feel of a PAGE
// change. Switching between two playlists, or two albums, is the same page with
// another entity: the route name stays, only its params change. Drifting there
// wobbles the whole ground under every switch, so it does not drift.
//
// The first navigation (from the start location, which has no name) drifts, as
// the page arrives for the first time.
// ---------------------------------------------------------------------------

export function groundDrifts(to: { name?: unknown }, from: { name?: unknown }): boolean {
    if (from.name === undefined) return true
    return to.name !== from.name
}
