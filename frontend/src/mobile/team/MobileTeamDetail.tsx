import { useNavigate } from 'react-router'
import { useGetRankChangesQuery } from '../../store/api/fantasyApi'
import { MyTeamMark } from '../../components/MyTeamMark'
import DataDateBadge from '../../components/DataDateBadge'
import { ShareCardButton } from '../../components/share/ShareCardButton'
import { orderCategories } from '../../utils/statOrder'
import { averagesNote, liveSectionNote } from '../../utils/live'
import { LiveBadgeMobile } from '../ui/LiveBadgeMobile'
import { Card, Segmented } from '../ui'
import MobileRoster from './MobileRoster'
import MobileRosterCoverage from './MobileRosterCoverage'
import type { MobileTeamDetailProps, TeamTab } from './types'
import { ManagerHintsTeamSection } from '../../components/hints/ManagerHintsCard'
import './team.css'

const TAB_OPTIONS: { value: TeamTab; label: string }[] = [
  { value: 'stats', label: 'Team Statistics' },
  { value: 'roster', label: 'Roster' },
  { value: 'slots', label: 'Slots & coverage' },
]

/** Category points strip: league-best is solid blue, top half light blue, bottom third orange. */
function catTone(points: number, teamCount: number): string {
  if (points >= teamCount) return 'mr-tm-cat-top'
  const share = points / Math.max(teamCount, 1)
  if (share >= 0.66) return 'mr-tm-cat-high'
  if (share > 0.33) return 'mr-tm-cat-mid'
  return 'mr-tm-cat-low'
}

const pct3 = (v: number) => (v * 100).toFixed(2) + '%'

/**
 * Phone Team page (mobile redesign step 4): header card (rank · points ·
 * change since yesterday, category points, ESPN, Share) and three tabs:
 * Team Statistics / Roster (Daily · Stats · Schedule) / Slots & coverage.
 * All state lives in TeamDetail; this only lays it out.
 */
export default function MobileTeamDetail(p: MobileTeamDetailProps) {
  const navigate = useNavigate()
  const t = p.team
  const { data: changes } = useGetRankChangesQuery('averages')
  const move = changes?.teams.find((c) => c.team_id === t.team.team_id)?.rank_delta
  const cats = orderCategories(Object.keys(t.category_ranks))

  return (
    <div className="mr-root mr-page" data-testid="mobile-team-page">
      <button type="button" className="mr-link mr-tm-back" onClick={() => navigate('/teams')}>
        ‹ Back to Teams
      </button>

      <Card as="section" aria-label="Team summary">
        <h1 className="mr-tm-title">
          {t.team.team_name}
          <MyTeamMark teamId={t.team.team_id} />
        </h1>
        <div className="mr-card-head">
          <span className="mr-tm-big">
            #{t.ranking_stats.rank ?? '—'} · {t.ranking_stats.total_points} pts
          </span>
          {typeof move === 'number' && (
            <span
              className={`mr-tm-move ${move > 0 ? 'mr-up' : move < 0 ? 'mr-down' : 'mr-same'}`}
              title="Rank change since yesterday (averages)"
            >
              {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '–'} since yesterday
            </span>
          )}
        </div>
        <div className="mr-tm-cats" role="list" aria-label="Category points">
          {cats.map((c) => (
            <div
              key={c}
              role="listitem"
              className={`mr-tm-cat ${catTone(t.category_ranks[c], p.teamCount)}`}
              aria-label={`${c}: ${t.category_ranks[c]} points`}
            >
              <span>{c}</span>
              <b>{t.category_ranks[c]}</b>
            </div>
          ))}
        </div>
        <div className="mr-tm-meta-row">
          <span className="mr-meta">Ranking summary (averages) · GP {t.raw_averages.gp}</span>
          {t.data_date ? <DataDateBadge dataDate={t.data_date} /> : <LiveBadgeMobile live={t.live} espnUpdatedAt={p.espnUpdatedAt} note={averagesNote(t.live, 'averages')} />}
        </div>
        <div className="mr-tm-actions">
          <a className="mr-tm-espn" href={t.espn_url} target="_blank" rel="noopener noreferrer">
            View on ESPN ↗
          </a>
          <span className="mr-tm-share">
            <ShareCardButton title={`${t.team.team_name} Report`} renderCard={p.shareCard} />
          </span>
        </div>
      </Card>

      <Card title="Manager hints" className="mr-hints-card" aria-label="Manager hints">
        <ManagerHintsTeamSection teamId={t.team.team_id} layout="mobile" teamDetail={t} />
      </Card>

      <Segmented label="Team page section" options={TAB_OPTIONS} value={p.tab} onChange={p.onTab} />

      {p.tab === 'stats' && (
        <>
          <Card title="Team statistics">
            {liveSectionNote(t.live, 'stats') && <span className="mr-meta">{liveSectionNote(t.live, 'stats')}</span>}
            <div>
              <div className="mr-kv"><span>Overall rank</span><b>#{t.ranking_stats.rank}</b></div>
              <div className="mr-kv"><span>Total points</span><b>{t.ranking_stats.total_points}</b></div>
              <div className="mr-kv">
                <span>Field goals</span>
                <b>{t.shot_chart.fgm}/{t.shot_chart.fga} ({pct3(t.shot_chart.fg_percentage)})</b>
              </div>
              <div className="mr-kv">
                <span>Free throws</span>
                <b>{t.shot_chart.ftm}/{t.shot_chart.fta} ({pct3(t.shot_chart.ft_percentage)})</b>
              </div>
              <div className="mr-kv"><span>Total Games Played</span><b>{t.raw_averages.gp}</b></div>
            </div>
          </Card>
          <Card title="Shot chart">
            <div className="mr-tiles mr-c3">
              {[
                ['FGM', t.shot_chart.fgm],
                ['FGA', t.shot_chart.fga],
                ['FG%', pct3(t.shot_chart.fg_percentage)],
                ['FTM', t.shot_chart.ftm],
                ['FTA', t.shot_chart.fta],
                ['FT%', pct3(t.shot_chart.ft_percentage)],
              ].map(([k, v]) => (
                <div key={k} className="mr-tile">
                  <span className="mr-tile-k">{k}</span>
                  <span className="mr-tile-v">{v}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Per-game averages">
            <div className="mr-tiles mr-c4">
              {p.perGameCategories.map((k) => (
                <div key={k} className="mr-tile" title={p.categoryNames[k] ?? k}>
                  <span className="mr-tile-k">{k}</span>
                  <span className="mr-tile-v">{(t.raw_averages.stats?.[k] ?? 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {p.tab === 'roster' && <MobileRoster {...p} />}

      {p.tab === 'slots' && (
        <>
          {t.slot_usage && Object.keys(t.slot_usage).length > 0 && (
            <Card title="Slot usage">
              {liveSectionNote(t.live, 'slots') && <span className="mr-meta">{liveSectionNote(t.live, 'slots')}</span>}
              {p.slotMeta}
              <div className="mr-tm-slots">{p.slotUsageNode}</div>
            </Card>
          )}
          <MobileRosterCoverage
            players={t.players ?? []}
            horizon={p.horizon}
            onHorizonChange={p.onHorizon}
            selectedDate={p.coverageDate}
            onSelectDate={p.onCoverageDate}
          />
        </>
      )}
    </div>
  )
}
