import { describe, expect, it } from 'vitest'
import { orderCategories } from '../statOrder'

describe('orderCategories', () => {
  it('puts ESPN settings order into the Players page order', () => {
    expect(orderCategories(['PTS', 'BLK', 'STL', 'AST', 'REB', '3PM', 'FG%', 'FT%', 'TO'])).toEqual([
      'FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PTS',
    ])
  })

  it('keeps categories it does not know after the known ones, in their own order', () => {
    expect(orderCategories(['DD', 'PTS', 'GP', 'FG%'])).toEqual(['FG%', 'PTS', 'DD', 'GP'])
  })
})
