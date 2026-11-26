import { describe, expect, it } from 'vitest'

import { nextSortQuery } from '@/utils/sortMenu'

const TEXT = ['title', 'name']

describe('nextSortQuery', () => {
  it('flips the active key', () => {
    expect(nextSortQuery({ sortby: 'playcount', reverse: true }, 'playcount', TEXT)).toEqual({ sortby: 'playcount', reverse: '0' })
    expect(nextSortQuery({ sortby: 'title', reverse: false }, 'title', TEXT)).toEqual({ sortby: 'title', reverse: '1' })
  })

  it('starts a text key A to Z', () => {
    expect(nextSortQuery({ sortby: 'created_date', reverse: true }, 'title', TEXT)).toEqual({ sortby: 'title', reverse: '0' })
  })

  it('starts every other key with the most (or newest) first', () => {
    expect(nextSortQuery({ sortby: 'title', reverse: false }, 'trackcount', TEXT)).toEqual({ sortby: 'trackcount', reverse: '1' })
  })
})
