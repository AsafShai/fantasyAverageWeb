import { describe, expect, it } from 'vitest'
import { countingCategoriesOf, isGoodChange } from '../categoryTrends'

describe('categoryTrends', () => {
  it('keeps only measurable league categories, in display order', () => {
    expect(countingCategoriesOf(['FG%', 'PTS', 'FT%', 'REB', '3PM', 'TO'])).toEqual(['3PM', 'REB', 'TO', 'PTS'])
    // unknown league list -> the default 8, which has no TO
    expect(countingCategoriesOf(undefined)).toEqual(['3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS'])
    // a league without TO never gets a TO chip
    expect(countingCategoriesOf(['PTS', 'BLK', 'STL', 'AST', 'REB', '3PM', 'FG%', 'FT%'])).not.toContain('TO')
  })

  it('treats a drop as good for reverse categories', () => {
    const reverse = new Set(['TO'])
    expect(isGoodChange(-0.5, 'TO', reverse)).toBe(true)
    expect(isGoodChange(0.5, 'TO', reverse)).toBe(false)
    expect(isGoodChange(0.5, 'PTS', reverse)).toBe(true)
  })

})
