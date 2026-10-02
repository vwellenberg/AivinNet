import { describe, expect, it } from 'vitest'

import { FOLDER_GAUGE_MIN, folderGauge, folderLabel } from '../folderRow'

describe('folderLabel', () => {
  // Real names from a library sorted by numeric prefix.
  it.each([
    ['025-AI', '025', 'AI'],
    ['200-Filme_und_Serien', '200', 'Filme und Serien'],
    ['950-Hörbücher', '950', 'Hörbücher'],
    ['01 Intro', '01', 'Intro'],
    ['2024_Urlaub', '2024', 'Urlaub'],
  ])('splits %s', (name, ordinal, title) => {
    expect(folderLabel(name)).toEqual({ ordinal, title })
  })

  it.each([
    ['iTunes', 'iTunes'],
    ['sort', 'sort'],
    ['my_music', 'my music'],
    // A name that is ONLY a number, or nothing after the separator, keeps its
    // text: splitting would leave the row without a title.
    ['2024', '2024'],
    ['025-', '025-'],
    // Digits inside a name are not a prefix.
    ['Top 100', 'Top 100'],
    ['', ''],
  ])('leaves %s whole', (name, title) => {
    expect(folderLabel(name)).toEqual({ ordinal: '', title })
  })
})

describe('folderGauge', () => {
  const MAX = 7662 // the biggest folder of the list the design was made for

  it('fills completely for the biggest folder', () => {
    expect(folderGauge(MAX, MAX)).toBe(100)
  })

  it('separates orders of magnitude clearly (log scale)', () => {
    const small = folderGauge(30, MAX)
    const medium = folderGauge(300, MAX)
    const large = folderGauge(3000, MAX)
    expect(small).toBeLessThan(medium)
    expect(medium).toBeLessThan(large)
    // On a linear scale 300 of 7,662 would be ~4% — invisible next to 3,000.
    expect(medium).toBeGreaterThan(50)
    expect(large - small).toBeGreaterThan(40)
  })

  it('keeps a visible sliver for tiny folders', () => {
    // Against a huge sibling one file would round to ~4% — under the floor.
    expect(folderGauge(1, 10_000_000)).toBe(FOLDER_GAUGE_MIN)
    expect(folderGauge(1, MAX)).toBeGreaterThanOrEqual(FOLDER_GAUGE_MIN)
  })

  it('draws nothing for empty or unknown counts', () => {
    expect(folderGauge(0, MAX)).toBe(0)
    expect(folderGauge(NaN, MAX)).toBe(0)
    expect(folderGauge(-3, MAX)).toBe(0)
  })

  it('never overflows when the max is stale or missing', () => {
    expect(folderGauge(500, 100)).toBe(100)
    expect(folderGauge(500, 0)).toBe(100)
  })
})
