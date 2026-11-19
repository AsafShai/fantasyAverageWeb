import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DailyRecap } from '../../../utils/dailyRecap'
import { DailyRecapLoadingCard, DailyRecapShareCard } from '../DailyRecapShareCard'

const line = [
  { label: 'MIN', value: '36' }, { label: 'FG', value: '12-20' }, { label: '3PT', value: '4-8' },
  { label: 'FT', value: '4-4' }, { label: 'REB', value: '8' }, { label: 'AST', value: '4' },
  { label: 'STL', value: '1' }, { label: 'BLK', value: '0' }, { label: 'PTS', value: '32' },
]

const recap: DailyRecap = {
  best: { teamId: 1, name: 'Beta Squad', rank: 1, total: 92.5, gp: 8, categories: [{ category: 'PTS', points: 11 }, { category: 'REB', points: 8.5 }, { category: 'AST', points: 6 }] },
  worst: { teamId: 2, name: 'Cellar Dwellers', rank: 12, total: 18, gp: 7, categories: [{ category: 'STL', points: 1 }] },
  rise: { teamId: 1, name: 'Beta Squad', totalDelta: 4, rankDelta: 2, categories: [{ category: 'PTS', delta: 2 }, { category: 'REB', delta: -1 }] },
  fall: { teamId: 3, name: 'Sliding', totalDelta: -3.5, rankDelta: -1, categories: [{ category: 'AST', delta: -2 }] },
  lines: [{
    id: '1', name: 'Donovan Mitchell', nbaTeam: 'CLE', opponent: 'CHI', home: true,
    fantasyTeam: 'ABC', fantasyTeamName: 'Beta Squad', lineup: 'started', stats: line, z: 2.41,
  }, {
    id: '7', name: 'Bench Line', nbaTeam: 'DAL', opponent: 'SAS', home: false,
    fantasyTeam: 'XYZ', fantasyTeamName: 'Sliding', lineup: 'bench', stats: line, z: 1.8,
  }],
  freeAgents: [{
    id: '2', name: 'Nickeil Alexander-Walker', nbaTeam: 'ATL', opponent: 'IND', home: false,
    fantasyTeam: null, fantasyTeamName: null, lineup: null, stats: line, z: 1.2,
  }],
  started: {
    id: '3', name: 'Cold Starter', nbaTeam: 'LAL', opponent: 'BOS', home: true,
    fantasyTeam: 'ABC', fantasyTeamName: 'Beta Squad', lineup: 'started', stats: line, z: -1.84,
  },
  benched: {
    id: '4', name: 'Sat Star', nbaTeam: 'NYK', opponent: 'MIA', home: false,
    fantasyTeam: 'XYZ', fantasyTeamName: 'Sliding', lineup: 'bench', stats: line, z: 3.1,
  },
  boom: {
    shown: [{
      id: 5, name: 'Boom Guy', opponent: 'PHI', home: true, fantasyTeam: 'ABC', fantasyTeamName: 'Beta Squad',
      lineup: 'started', stats: [{ label: 'FG', value: '14-22' }, { label: 'PTS', value: '38' }], score: 3.4,
    }],
    total: 6,
    threshold: 2,
  },
  bust: {
    shown: [{
      id: 6, name: 'Bust Guy', opponent: 'DEN', home: false, fantasyTeam: 'XYZ', fantasyTeamName: 'Sliding',
      lineup: 'bench', stats: [{ label: 'PTS', value: '2' }], score: -2.8,
    }],
    total: 1,
    threshold: 2,
  },
}

/** The ten sections, in poster order: five rows of two. */
function sections(): Element[] {
  const card = document.querySelector('.share-card--recap')!
  return [...card.querySelectorAll(':scope > section')].flatMap(row => [...row.children])
}

describe('DailyRecapShareCard', () => {
  it('lays the ten sections out in five pairs and shows the night', () => {
    render(
      <DailyRecapShareCard
        dark={false}
        subtitle="Nov 18, 2026"
        recap={recap}
        highlight
        myTeam={{ team_id: 1, team_name: 'Beta Squad', abbrev: 'ABC' }}
      />,
    )

    const titles = [
      'Best team of the night', 'Worst team of the night',
      'Biggest rise', 'Biggest fall',
      'Lines of the night', 'FA of the night',
      'Worst starter performance', 'Best bench performance',
      'Boom', 'Bust',
    ]
    const tiles = sections()
    expect(tiles).toHaveLength(10)
    titles.forEach((title, index) => expect(tiles[index]).toHaveTextContent(title))
    // Drawn marks, never emoji: one per section.
    expect([...document.querySelectorAll('svg.drc-icon')].map(icon => icon.getAttribute('data-icon'))).toEqual(
      ['trophy', 'frost', 'rise', 'fall', 'flame', 'tag', 'down', 'bench', 'boom', 'bust'],
    )
    expect(document.querySelector('.drc-title')).toHaveTextContent('Fantasy Daily Recap')
    expect(screen.getByText('Nov 18, 2026')).not.toHaveClass('drc-date--long')

    const [best, worst, rise, fall, lines, freeAgents, started, benched, boom, bust] = tiles
    expect(best).toHaveTextContent('Beta Squad')
    expect(best.querySelector('.drc-total')).toHaveTextContent('92.5')
    expect(best.querySelector('.drc-place')).toHaveTextContent('#1')
    expect(best).toHaveTextContent('8 GP')
    expect(best.querySelector('.drc-strip')).toHaveTextContent('PTS11REB8.5AST6')
    expect(worst.querySelector('.drc-total')).toHaveTextContent('18')
    expect(worst.querySelector('.drc-place')).toHaveTextContent('#12')

    expect(rise.querySelector('.drc-team')).toHaveTextContent('Beta Squad')
    expect(rise.querySelector('.drc-delta')).toHaveTextContent('+4')
    expect(rise.querySelector('.drc-places')).toHaveTextContent('up 2 places')
    expect(screen.getByText('+2')).toHaveClass('drc-up')
    expect(screen.getByText('−1')).toHaveClass('drc-down')
    expect(fall.querySelector('.drc-delta')).toHaveTextContent('−3.5')
    expect(fall.querySelector('.drc-places')).toHaveTextContent('down 1 place')

    // The top line gets the big tile; the rest are numbered rows.
    expect(lines.querySelector('.drc-hero')).toHaveTextContent('Donovan Mitchell')
    expect(lines.querySelector('.drc-hero')).toHaveTextContent('CLE vs CHI · Beta Squad')
    expect(lines.querySelector('.drc-hero .drc-score')).toHaveTextContent('Night Z+2.41')
    expect(lines.querySelector('.drc-row')).toHaveTextContent('Bench Line')
    expect(lines.querySelector('.drc-row .drc-n')).toHaveTextContent('2')
    expect(lines.querySelector('.drc-strip')).toHaveTextContent('MIN36FG12-20')
    expect(lines).not.toHaveTextContent('TO')
    expect(freeAgents).toHaveClass('drc-panel--paper')
    expect(freeAgents).toHaveTextContent('ATL @ IND · FA')
    expect(started.querySelector('.drc-score span')).toHaveTextContent('−1.84')
    expect(started.querySelector('.drc-score span')).toHaveClass('drc-down')
    expect(benched.querySelector('.drc-score span')).toHaveTextContent('+3.10')

    // Boom and bust: the count on the band, no threshold caption.
    expect(boom.querySelector('.drc-band-count')).toHaveTextContent('6')
    expect(boom.querySelector('.drc-band-cap')).toHaveTextContent('top 1 of')
    expect(bust.querySelector('.drc-band-count')).toHaveTextContent('1')
    expect(bust.querySelector('.drc-band-cap')).toBeNull()
    expect(document.body).not.toHaveTextContent('score ≥')
    expect(document.body).not.toHaveTextContent('score ≤')
    expect(boom.querySelector('.drc-score')).toHaveTextContent('Surprise+3.4')
    expect(bust.querySelector('.drc-score')).toHaveTextContent('Surprise−2.8')
    expect(boom).toHaveTextContent('14-22')
    expect(boom.querySelector('img')?.getAttribute('src')).toContain('/5.png')
    expect(bust.querySelector('img')?.getAttribute('src')).toContain('/6.png')

    // The lineup light: a dot and a word, in its own row under the team.
    expect(lines.querySelector('.drc-hero .drc-tags .drc-pill--start')).toHaveTextContent('Started')
    expect(lines.querySelector('.drc-row .drc-tags .drc-pill--bench')).toHaveTextContent('Bench')
    expect(boom.querySelector('.drc-tags .drc-pill--start')).toBeInTheDocument()
    expect(bust.querySelector('.drc-tags .drc-pill--bench')).toBeInTheDocument()
    expect(freeAgents.querySelector('.drc-pill')).toBeNull()
    expect(started.querySelector('.drc-pill')).toBeNull()
    expect(benched.querySelector('.drc-pill')).toBeNull()

    // "My team" wherever team 1 / ABC shows up, and nowhere else.
    const marked = tiles.map(tile => tile.querySelectorAll('.drc-mine').length)
    expect(marked).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0])
  })

  it('marks nothing when highlighting is off, and shrinks a long date', () => {
    render(
      <DailyRecapShareCard
        dark
        subtitle="Nov 17, 2026 · lines Nov 18, 2026"
        recap={recap}
        highlight={false}
        myTeam={{ team_id: 1, team_name: 'Beta Squad', abbrev: 'ABC' }}
      />,
    )
    expect(document.querySelector('.drc-mine')).toBeNull()
    expect(screen.getByText('Nov 17, 2026 · lines Nov 18, 2026')).toHaveClass('drc-date--long')
  })

  it('leaves every section empty when the night had no games', () => {
    const empty: DailyRecap = {
      best: null, worst: null, rise: null, fall: null,
      lines: [], freeAgents: [], started: null, benched: null,
      boom: { shown: [], total: 0, threshold: 2 },
      bust: { shown: [], total: 0, threshold: 2 },
    }
    render(
      <DailyRecapShareCard dark={false} subtitle="Nov 19, 2026" recap={empty} highlight={false} myTeam={null} />,
    )
    expect(sections()).toHaveLength(10)
    expect(screen.getAllByText('No standings for this night')).toHaveLength(2)
    expect(screen.getByText('No team gained points')).toBeInTheDocument()
    expect(screen.getByText('No team lost points')).toBeInTheDocument()
    expect(screen.getByText('No lines yet')).toBeInTheDocument()
    expect(screen.getByText('No free agents')).toBeInTheDocument()
    expect(screen.getByText('No starter with a line')).toBeInTheDocument()
    expect(screen.getByText('No bench player with a line')).toBeInTheDocument()
    expect(screen.getAllByText('None cleared the bar')).toHaveLength(2)
    expect([...document.querySelectorAll('.drc-band-count')].map(count => count.textContent)).toEqual(['0', '0'])
  })

  it('carries its typefaces inside the card, so the exported image has them', () => {
    const css = "@font-face{font-family:'Anton';src:url(data:font/woff2;base64,AAAA) format('woff2')}"
    const { container, rerender } = render(<DailyRecapLoadingCard dark={false} fontCss={css} />)
    expect(container.querySelector('.share-card--recap > style')).toHaveTextContent(css)
    expect(screen.getByText('Loading last night')).toBeInTheDocument()
    rerender(<DailyRecapLoadingCard dark={false} />)
    expect(container.querySelector('style')).toBeNull()
  })
})
