// ---------------------------------------------------------------------------
// Does the page play its entrance on this navigation?
//
// The content of #acontent slides in on a PAGE change (Global/_button-classes.scss,
// mem-page-enter). Switching between two playlists, or two albums, is the same
// page with another entity: the route name stays, only its params change, and
// the page does not enter again.
//
// The first navigation (from the start location, which has no name) enters, as
// the page arrives for the first time.
//
// The ground behind it holds still on every navigation. It drifted against the
// entrance until 2026-10 (#473 gated it to page changes, then it was reported
// as "the background wobbles on a screen change" and went).
// ---------------------------------------------------------------------------

export function pageEnters(to: { name?: unknown }, from: { name?: unknown }): boolean {
    if (from.name === undefined) return true
    return to.name !== from.name
}
