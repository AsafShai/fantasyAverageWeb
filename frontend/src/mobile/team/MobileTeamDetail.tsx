import DataDateBadge from '../../components/DataDateBadge'
import { ShareCardButton } from '../../components/share/ShareCardButton'
import { TeamScoreboard } from '../../components/team/TeamScoreboard'
import { averagesNote, liveSectionNote, startersNote, tonightGp, tonightPoints } from '../../utils/live'
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

const pct3 = (v: number) => (v * 100).toFixed(2) + '%'

/**
 * Phone Team page (mobile redesign step 4): header card (rank · points ·
 * change since yesterday, category points, ESPN, Share) and three tabs:
 * Team Statistics / Roster (Daily · Stats · Schedule) / Slots & coverage.
 * All state lives in TeamDetail; this only lays it out.
 */
export default function MobileTeamDetail(p: MobileTeamDetailProps) {
  const t = p.team
  const pointsTonight = tonightPoints(t.live, t.tonight)

  return (
    <div className="mr-root mr-page mr-tm-page" data-testid="mobile-team-page">
      <TeamScoreboard
        teamId={t.team.team_id}
        teamName={t.team.team_name}
        rank={t.ranking_stats.rank}
        totalPoints={t.ranking_stats.total_points}
        gp={t.raw_averages.gp}
        teamCount={p.teamCount}
        categories={t.category_ranks}
        espnUrl={t.espn_url}
        share={<ShareCardButton title={`${t.team.team_name} Report`} renderCard={p.shareCard} />}
        badge={t.data_date
          ? <DataDateBadge dataDate={t.data_date} />
          : <LiveBadgeMobile live={t.live} espnUpdatedAt={p.espnUpdatedAt} note={averagesNote(t.live, 'averages', true)} />}
        pointsTonight={pointsTonight}
        pointsDown={(t.tonight?.points ?? 0) < 0}
        gpTonight={tonightGp(t.live, t.tonight)}
        playingNote={startersNote(t.live, t.tonight)}
        liveNote={liveSectionNote(t.live, 'stats')}
      />

      <ManagerHintsTeamSection teamId={t.team.team_id} layout="desktop" teamDetail={t} />

      <Segmented label="Team page section" options={TAB_OPTIONS} value={p.tab} onChange={p.onTab} />

      {p.tab === 'stats' && (
        <>
          <Card title="Team statistics">
            <div>
              <div className="mr-kv"><span>Overall rank</span><b>#{t.ranking_stats.rank}</b></div>
              <div className="mr-kv">
                <span>Total points</span>
                <b>
                  {tonightPoints(t.live, t.tonight) && (
                    <span className={`mr-delta ${(t.tonight?.points ?? 0) < 0 ? 'mr-delta-down' : 'mr-delta-up'}`}>{tonightPoints(t.live, t.tonight)} </span>
                  )}
                  {t.ranking_stats.total_points}
                </b>
              </div>
              <div className="mr-kv">
                <span>Field goals</span>
                <b>{t.shot_chart.fgm}/{t.shot_chart.fga} ({pct3(t.shot_chart.fg_percentage)})</b>
              </div>
              <div className="mr-kv">
                <span>Free throws</span>
                <b>{t.shot_chart.ftm}/{t.shot_chart.fta} ({pct3(t.shot_chart.ft_percentage)})</b>
              </div>
              <div className="mr-kv">
                <span>Total Games Played</span>
                <b>
                  {t.raw_averages.gp}
                  {tonightGp(t.live, t.tonight) && <span className="mr-delta mr-delta-up">{tonightGp(t.live, t.tonight)}</span>}
                </b>
              </div>
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
