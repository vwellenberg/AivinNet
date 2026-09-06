import { subPath } from '@/interfaces'

/**
 * Breaks a path into breadcrumb sub-paths.
 *
 * When `rootDirs` is provided and one of them is a prefix of `newpath`, the
 * breadcrumb is CLAMPED to that root dir: the first crumb is the root dir's
 * last segment and every crumb uses an absolute path. This keeps the library
 * root (e.g. `music`) as the breadcrumb base, so the user can't navigate above
 * it into paths the backend rejects (which showed up as "folder is empty").
 *
 * @param newpath  the new (absolute) path to break into sub-paths.
 * @param oldpath  the previous path (used by the legacy fallback below).
 * @param rootDirs configured library root dirs; pass `settings.root_dirs`.
 */
export default function createSubPaths(
    newpath: string,
    oldpath: string,
    rootDirs: string[] = []
): [string, subPath[]] {
    if (oldpath === undefined) oldpath = ''
    if (newpath === undefined) newpath = ''

    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
    const np = norm(newpath)

    // Clamp to a configured root dir when one is a prefix of the current path.
    const root = rootDirs
        .map(norm)
        .filter(Boolean)
        .find(r => np === r || np.startsWith(r + '/'))

    if (root) {
        const rootSegs = root.split('/').filter(Boolean)
        const rootName = rootSegs[rootSegs.length - 1]
        const below = np.slice(root.length).split('/').filter(Boolean)

        const crumbs: subPath[] = [{ active: below.length === 0, name: rootName, path: root }]
        let acc = root
        below.forEach((seg, i) => {
            acc = acc + '/' + seg
            crumbs.push({ active: i === below.length - 1, name: seg, path: acc })
        })
        return [np, crumbs]
    }

    // ---- legacy fallback (e.g. the virtual $home listing or multi-root) ----
    newpath = newpath.replace(/\\/g, '/')
    oldpath = oldpath.replace(/\\/g, '/')

    if (newpath.endsWith('/')) newpath = newpath.slice(0, -1)
    if (oldpath.endsWith('/')) oldpath = oldpath.slice(0, -1)
    if (oldpath.startsWith('/')) oldpath = oldpath.replace('/', '')
    if (newpath.startsWith('/')) newpath = newpath.replace('/', '')

    const newlist = newpath.split('/').filter(Boolean)

    if (oldpath.includes(newpath)) {
        const oldlist = oldpath.split('/').filter(Boolean)
        const current = newlist.slice(-1)[0]
        return [oldpath, createSubs(oldlist, current)]
    } else {
        const current = newlist.slice(-1)[0]
        return [newpath, createSubs(newlist, current)]
    }

    function createSubs(list: string[], current: string) {
        const paths = list
            .map((path, index) => {
                return {
                    active: false,
                    name: path,
                    path: list.slice(0, index + 1).join('/'),
                }
            })
            .filter(item => item.name)

        paths.reverse()

        for (let i = 0; i < paths.length; i++) {
            if (paths[i].name === current) {
                paths[i].active = true
                break
            }
        }

        return paths.reverse()
    }
}
