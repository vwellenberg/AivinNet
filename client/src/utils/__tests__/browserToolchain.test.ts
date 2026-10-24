import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { describe, expect, it } from 'vitest'

// The client bundles for the browser, where Node's built-ins do not exist. Until
// #581 a polyfill plugin quietly shipped crypto-browserify (elliptic, bn.js, a
// `stream` shim: ~600 kB) for one MD5. Without it, an import of a built-in
// type-checks (@types/node is in scope for the tests) and builds with only a
// warning, then throws "Module has been externalized" in the browser.
const SOURCES = import.meta.glob(['/src/**/*.ts', '/src/**/*.vue', '!/src/**/__tests__/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>

const BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith('_')))
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

describe('browser code', () => {
    it('reads the sources it claims to check', () => {
        expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
    })

    it('imports no Node built-in', () => {
        const found: string[] = []
        for (const [file, text] of Object.entries(SOURCES)) {
            for (const [, spec] of text.matchAll(IMPORT)) {
                const bare = spec.replace(/^node:/, '').split('/')[0]
                if (spec.startsWith('node:') || BUILTINS.has(bare)) found.push(`${file}: ${spec}`)
            }
        }
        expect(found).toEqual([])
    })
})

describe('vite version', () => {
    // vitest accepts several Vite majors; without the resolution yarn put the
    // newest one next to ours, and that one failed on our Sass (#581). Raising
    // one entry without the other would make the declared range a lie.
    it('pins the same major in devDependencies and resolutions', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
        const major = (range: string) => range.replace(/^[^\d]*/, '').split('.')[0]
        expect(pkg.resolutions?.vite).toBeTruthy()
        expect(major(pkg.resolutions.vite)).toBe(major(pkg.devDependencies.vite))
    })
})
