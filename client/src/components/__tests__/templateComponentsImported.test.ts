import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// EVERY COMPONENT A TEMPLATE USES IS IMPORTED (or registered globally).
//
// `NowPlaying/Header.vue` rendered `<DevicesButton>` for phones between 660
// and 900 px and never imported it. Vue resolves an unknown tag to a plain
// element: no error in the build, a warning in the console, and on that screen
// simply no devices button — the one place a larger phone reaches group
// playback. Nothing failed, because nothing renders that width in a test.
//
// A source census: each PascalCase tag in a template must appear in the
// script (an import or a local registration), or be one of the components
// `main.ts` registers globally, or one of Vue's own.
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) {
            if (name !== '__tests__') out.push(...sources(path))
        } else if (name.endsWith('.vue')) out.push(path)
    }
    return out
}

/** Vue's built-ins and what `main.ts` registers with `app.component`. */
const MAIN = readFileSync('src/main.ts', 'utf-8')
const GLOBAL = new Set([
    'RouterLink',
    'RouterView',
    'Teleport',
    'Transition',
    'TransitionGroup',
    'KeepAlive',
    'Suspense',
    'Component',
    ...[...MAIN.matchAll(/app\.component\(\s*["'](\w+)["']/g)].map(m => m[1]),
])

function unresolved(source: string): string[] {
    const template = source.match(/<template>([\s\S]*)<\/template>/)
    if (!template) return []
    const markup = template[1].replace(/<!--[\s\S]*?-->/g, '')
    // Only the script blocks, without comments: the style block of Header.vue
    // named "DevicesButton" in a comment, and a census over the whole file
    // stayed green on exactly the bug it was written for.
    const script = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
        .map(m => m[1])
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
    const tags = new Set([...markup.matchAll(/<([A-Z][A-Za-z0-9]+)/g)].map(m => m[1]))
    return [...tags].filter(tag => !GLOBAL.has(tag) && !new RegExp(`\\b${tag}\\b`).test(script))
}

const FILES = sources('src').map(file => ({ file: file.split('\\').join('/'), source: readFileSync(file, 'utf-8') }))

describe('template components are imported', () => {
    it('reads its own inputs (guard)', () => {
        expect(FILES.length).toBeGreaterThan(100)
        expect(GLOBAL.has('RecycleScroller')).toBe(true)
        // The case this census was written for, as it stood.
        expect(unresolved('<template><DevicesButton /></template><script setup lang="ts"></script>')).toEqual([
            'DevicesButton',
        ])
        // A name in a comment or a style block is not an import.
        const commented =
            '<template><DevicesButton /></template><script setup lang="ts">// DevicesButton\n</script>' +
            '<style>/* DevicesButton.vue */</style>'
        expect(unresolved(commented)).toEqual(['DevicesButton'])
    })

    it.each(FILES)('$file', ({ source }) => {
        expect(unresolved(source)).toEqual([])
    })
})
