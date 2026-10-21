import { describe, expect, it } from 'vitest'
import { isLongName, nameCellWrapClass, wrapFriendlyName } from '../wrapName'

describe('wrapName', () => {
  it('treats names over 16 characters as long', () => {
    expect(isLongName('Alpha Squad')).toBe(false)
    expect(isLongName('Sixteen Chars Ok')).toBe(false)
    expect(isLongName('The Process Trusters')).toBe(true)
  })

  it('wraps long names on phones only, within a max width', () => {
    expect(nameCellWrapClass('The Process Trusters')).toBe('max-w-[38vw] whitespace-normal sm:max-w-none sm:whitespace-nowrap')
    expect(nameCellWrapClass('Alpha Squad')).toBe('whitespace-nowrap')
  })

  it('keeps hyphenated names together', () => {
    expect(wrapFriendlyName('Nickeil Alexander-Walker')).toBe('Nickeil Alexander‑Walker')
  })
})
