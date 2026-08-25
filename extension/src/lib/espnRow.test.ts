import { describe, expect, it } from 'vitest'
import { espnIdFromRowHints } from './reorder'

describe('espnIdFromRowHints', () => {
  it('reads the exclude checkbox data-idx, not the row index', () => {
    expect(
      espnIdFromRowHints({
        checkboxDataIdx: '5104157',
        rowDataIdx: '0',
        imgSrc: 'https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/5104157.png&w=96&h=70&cb=1',
      }),
    ).toBe(5104157)
  })

  it('falls back to the headshot URL', () => {
    expect(
      espnIdFromRowHints({
        rowDataIdx: '9',
        imgSrc: 'https://a.espncdn.com/i/headshots/nba/players/full/1966.png',
      }),
    ).toBe(1966)
  })

  it('does not treat the row data-idx as a player id', () => {
    expect(espnIdFromRowHints({ rowDataIdx: '0' })).toBeNull()
    expect(espnIdFromRowHints({ rowDataIdx: '47' })).toBeNull()
  })
})
