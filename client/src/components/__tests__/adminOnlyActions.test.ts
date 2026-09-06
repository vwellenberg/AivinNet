import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Some backend routes rewrite the SHARED library — the covers every account
// sees, the tags in the files on disk, the scan that can drop tracks, the
// accounts themselves. They are `@admin_required()` since AivinNet#105, so
// offering them to a guest produces an error toast and nothing else.
//
// This is a test rather than a comment because the gap was invisible per file:
// the track context menu already gated its tag editor, and right below it
// offered "Find cover online" to everyone. Each file read as finished; only the
// list of admin-only endpoints, held against every caller, showed the holes.
//
// The point of the census is the last two assertions: a new caller nobody
// classified fails the suite, and so does a classification that has gone stale.
// A fixed list of files would have rotted the first time someone added a button.
// ---------------------------------------------------------------------------

// Read through Vite rather than `fs`, so the test sees exactly what the build sees.
const SOURCES = import.meta.glob('/src/**/*.{vue,ts}', { as: 'raw', eager: true }) as Record<string, string>

/**
 * Request helpers whose endpoint the backend refuses for a non-admin.
 *
 * Kept as the FULL set, not just the ones that were reported. Two rounds of
 * review found holes here and nowhere else: the first version knew only about
 * covers, the scan and the tag editor (missing the root-dir prompt, which
 * `App.vue` opened for every account), the second still missed the backup and
 * account routes. A helper listed here that has no backend route is just as
 * wrong — `removeRootDirs` was in this list until the route turned out not to
 * exist at all.
 */
const ADMIN_ONLY_REQUESTS = [
    // library mutations
    'triggerScan',
    'fetchCoverFromMusicBrainz',
    'fetchMissingCovers',
    'saveOnlineCoverForAlbum',
    'undoAlbumCover',
    'removeAlbumCover',
    'uploadAlbumCover',
    'editTrackTags',
    // server configuration
    'addRootDirs',
    'getFolders',
    'updateConfig',
    // backups
    'backupNow',
    'getBackups',
    'restoreBackup',
    'deleteBackup',
    // accounts
    'addNewUser',
    'addGuestUser',
    'deleteUser',
    // plugins
    'pluginSetActive',
    'updatePluginSettings',
]

/** The path table names every endpoint but calls none of them. */
const NOT_A_CALL_SITE = ['/src/config.ts']

/** How a caller may satisfy the boundary. */
type Gate =
    /** The file decides for itself — it must evaluate a gate. */
    | 'self'
    /**
     * A settings module, gated by the CATEGORY that owns it. `exportName` is the
     * category's export: matching the file as a whole would not do, because one
     * file exports both the gated `library` and the ungated `general`, and moving
     * a group between them must not go unnoticed.
     */
    | { category: string; exportName: string }
    /**
     * Plumbing reached only through gated entry points; it renders no control of
     * its own. EVERY entry point is listed and every one must stay gated — with a
     * single one recorded, removing the gate from another would leave this suite
     * green while the control is back on screen.
     */
    | { reachedVia: string[] }

// ⚠️ The track context menu and App.vue are NOT in here, and that is not an
// oversight: they OFFER admin-only controls but call none of the requests — they
// open a modal, and the request lives there. Both are gated ENTRY POINTS (see
// `reachedVia`), which the first test checks, rather than callers. Listing them
// here instead would fail the staleness check, since neither ever touches an
// admin-only helper directly.
const CALLERS: Record<string, Gate> = {
    '/src/components/nav/ProfileDropdown.vue': 'self',
    '/src/components/AlbumView/Header/Buttons.vue': 'self',
    '/src/context_menus/album.ts': 'self',

    // Settings modules, all inside the admin-gated `library` category.
    '/src/settings/general/root-dirs.ts': { category: '/src/settings/general/index.ts', exportName: 'library' },
    '/src/settings/general/musicbrainz.ts': { category: '/src/settings/general/index.ts', exportName: 'library' },
    '/src/settings/general/separators.ts': { category: '/src/settings/general/index.ts', exportName: 'library' },
    // Declares the backup rows only — the requests live in the component below,
    // so this file is an ENTRY POINT rather than a caller.
    '/src/settings/general/backup.ts': { category: '/src/settings/general/index.ts', exportName: 'library' },

    '/src/components/modals/settings/custom/Accounts.vue': {
        category: '/src/settings/accounts/index.ts',
        exportName: 'default',
    },

    // Rendered only by the backup setting row of the same gated category.
    '/src/components/SettingsView/Components/BackupRestore.vue': {
        reachedVia: ['/src/settings/general/backup.ts'],
    },

    // The setup assistant and its directory browser: pure admin tooling. Reachable
    // from the first-run prompt AND from the settings screen, so both are listed.
    '/src/components/modals/RootDirsPrompt.vue': {
        reachedVia: ['/src/App.vue', '/src/settings/general/root-dirs.ts'],
    },
    '/src/components/modals/SetRootDirs.vue': {
        reachedVia: ['/src/App.vue', '/src/settings/general/root-dirs.ts'],
    },

    // Stores and modal plumbing: they route the action, they do not offer it.
    '/src/stores/musicbrainz.ts': { reachedVia: ['/src/settings/general/musicbrainz.ts'] },
    '/src/stores/settings/index.ts': { reachedVia: ['/src/settings/general/separators.ts'] },
    '/src/stores/auth.ts': { reachedVia: ['/src/components/modals/settings/custom/Accounts.vue'] },
    // ⚠️ Rendered from TWO places — the gated accounts screen and the ungated
    // profile category — so "reached via a gated file" is not the whole truth.
    // What actually keeps `addNewUser` out of reach is the `adding_user` prop:
    // without it the component edits your own profile and never calls it. The
    // separate test below pins that only the gated site passes it.
    '/src/components/modals/settings/Profile.vue': {
        reachedVia: ['/src/components/modals/settings/custom/Accounts.vue'],
    },
    '/src/components/modal.vue': { reachedVia: ['/src/context_menus/track.ts'] },
    '/src/components/modals/EditTrack.vue': { reachedVia: ['/src/context_menus/track.ts'] },
    '/src/stores/modal.ts': { reachedVia: ['/src/context_menus/track.ts'] },

    // The cover gallery serves albums AND playlists. A playlist cover is the
    // user's own and stays open to everyone, so this modal must NOT gate itself —
    // the album half is unreachable because both entry points are gated.
    '/src/components/modals/FindCoverOnline.vue': {
        reachedVia: ['/src/context_menus/album.ts', '/src/context_menus/track.ts'],
    },
}

/**
 * A gate has to be EVALUATED, not merely imported.
 *
 * The first version matched the bare identifier, and a mutation run showed what
 * that is worth: rewriting `if (loggedInUserIsAdmin())` to `if (true)` left the
 * import standing, so the census stayed green while the menu was open to
 * everyone. Import lines are therefore stripped, and the call form needs its
 * parenthesis.
 *
 * ⚠️ Known limit: `is_admin` matches anywhere in the file. A file with a second,
 * unrelated role check could have the relevant one deleted and stay green. Only
 * mounting the component would close that, which no test in this repo does; the
 * `reachedVia` lists keep the blast radius to one file at a time.
 */
const GATE_PATTERN = /\bis_admin\b|\bloggedInUserIsAdmin\s*\(/

/** A category hands the predicate over instead of calling it. */
const CATEGORY_GATE_PATTERN = /show_if:\s*loggedInUserIsAdmin\b/

function withoutImports(source: string): string {
    return source
        .split('\n')
        .filter(line => !/^\s*import\b/.test(line))
        .join('\n')
}

function hasGate(source: string): boolean {
    return GATE_PATTERN.test(withoutImports(source))
}

/**
 * The body of `export const <name> = …` (or of `export default`, for the
 * categories written that way), up to the next top-level export.
 */
function exportBlock(source: string, name: string): string | null {
    const head = name === 'default' ? /^export default\b/m : new RegExp(`^export const ${name}\\b`, 'm')
    const start = source.search(head)
    if (start === -1) return null

    const rest = source.slice(start + 1)
    const next = rest.search(/^export (const|default)\b/m)
    return next === -1 ? rest : rest.slice(0, next)
}

/** Is this path gated — directly, or by the category that owns it? */
function isGated(path: string): boolean {
    const source = SOURCES[path]
    if (!source) return false
    if (hasGate(source)) return true

    const gate = CALLERS[path]
    if (gate && typeof gate !== 'string' && 'category' in gate) {
        const block = exportBlock(SOURCES[gate.category] ?? '', gate.exportName)
        return !!block && CATEGORY_GATE_PATTERN.test(block)
    }

    return false
}

/** Files that actually reference an admin-only request, requests/ itself aside. */
function findCallers(): string[] {
    return Object.entries(SOURCES)
        .filter(
            ([path]) =>
                !path.startsWith('/src/requests/') && !path.includes('__tests__') && !NOT_A_CALL_SITE.includes(path)
        )
        .filter(([, source]) => ADMIN_ONLY_REQUESTS.some(fn => new RegExp(`\\b${fn}\\b`).test(source)))
        .map(([path]) => path)
        .sort()
}

describe('admin-only actions', () => {
    it('sees the files it means to check', () => {
        // A source-scanning test goes silently green when its input breaks, so it
        // needs a guard on its own inputs (.claude/rules/testing.md).
        expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
        expect(findCallers()).toContain('/src/context_menus/album.ts')
    })

    it('every classified caller satisfies its gate', () => {
        for (const [file, gate] of Object.entries(CALLERS)) {
            expect(SOURCES[file], `${file} is listed as a caller but does not exist`).toBeDefined()

            if (gate === 'self') {
                expect(hasGate(SOURCES[file]), `${file} calls an admin-only endpoint without gating on the role`).toBe(
                    true
                )
                continue
            }

            if ('category' in gate) {
                const category = SOURCES[gate.category]
                expect(category, `${gate.category} (the category gating ${file}) does not exist`).toBeDefined()

                const block = exportBlock(category, gate.exportName)
                expect(block, `${gate.category} exports no "${gate.exportName}" to gate ${file}`).not.toBeNull()
                expect(
                    CATEGORY_GATE_PATTERN.test(block as string),
                    `${file} relies on the "${gate.exportName}" category, which has no "show_if: loggedInUserIsAdmin"`
                ).toBe(true)
                continue
            }

            // reachedVia: EVERY entry point must still be gated, or this file is exposed.
            for (const path of gate.reachedVia) {
                expect(SOURCES[path], `${path} (an entry point for ${file}) does not exist`).toBeDefined()
                expect(isGated(path), `${file} is only safe because ${path} is gated — and it no longer is`).toBe(true)
            }
        }
    })

    it('only the gated accounts screen turns Profile into an add-user form', () => {
        // `Profile.vue` calls `addNewUser` only when `adding_user` is set. It is
        // also rendered from the ungated profile category, which is harmless
        // precisely because that site passes no such prop — so the boundary here
        // is the prop, not the render site, and this is what has to hold.
        const setters = Object.entries(SOURCES)
            .filter(([path]) => !path.includes('__tests__'))
            .filter(([, source]) => /:adding_user\s*=/.test(source))
            .map(([path]) => path)

        expect(setters).toEqual(['/src/components/modals/settings/custom/Accounts.vue'])
    })

    it('no caller is unclassified', () => {
        const unknown = findCallers().filter(file => !(file in CALLERS))

        // Deliberately not auto-passing: a new call site is a decision about who
        // may see the control, and it belongs in CALLERS above with a reason.
        expect(unknown, 'new caller(s) of an admin-only endpoint — classify them in adminOnlyActions.test.ts').toEqual(
            []
        )
    })

    it('lists nothing that has gone away', () => {
        const actual = findCallers()

        // An entry point earns its place by being referenced, not by calling
        // anything itself — `backup.ts` declares the rows whose component makes
        // the requests. Only an entry nobody reaches AND nobody calls is stale.
        const referenced = new Set(
            Object.values(CALLERS).flatMap(gate => (typeof gate !== 'string' && 'reachedVia' in gate ? gate.reachedVia : []))
        )
        const stale = Object.keys(CALLERS).filter(file => !actual.includes(file) && !referenced.has(file))

        expect(stale, 'CALLERS lists files that neither call an admin-only endpoint nor gate one').toEqual([])
    })
})
