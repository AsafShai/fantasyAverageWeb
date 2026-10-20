import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout'
import GlobalLoadingBar from './components/GlobalLoadingBar'
import LoadingSpinner from './components/LoadingSpinner'
import ErrorBoundary from './components/ErrorBoundary'
import { FF_FEATURE_STORE, FF_PROJECTIONS, FF_DRAFT_REPORT, FF_DRAFT_PAGES } from './config/featureFlags'
import { FF_LEAGUE_ACTIVITY } from './config/featureFlags'
import { MyTeamProvider } from './context/MyTeamContext'

const Today = lazy(() => import('./pages/Today'))
const Rankings = lazy(() => import('./pages/Rankings'))
const Teams = lazy(() => import('./pages/Teams'))
const TeamDetail = lazy(() => import('./pages/TeamDetail'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Estimator = lazy(() => import('./pages/Estimator'))
const Trade = lazy(() => import('./pages/Trade').then(m => ({ default: m.Trade })))
const Players = lazy(() => import('./pages/Players'))
const Injuries = lazy(() => import('./pages/Injuries'))
const NbaTeams = lazy(() => import('./pages/NbaTeams'))
const Schedule = lazy(() => import('./pages/Schedule'))
const FeatureStore = lazy(() => import('./pages/FeatureStore'))
const NotFound = lazy(() => import('./pages/NotFound'))
const PlayerRankings = lazy(() => import('./pages/PlayerRankings'))
const Projections = lazy(() => import('./pages/Projections'))
const DraftReport = lazy(() => import('./pages/DraftReport'))
const Trends = lazy(() => import('./pages/Trends'))
const Minigames = lazy(() => import('./pages/Minigames'))
const HangmanGame = lazy(() => import('./pages/minigames/HangmanGame'))
const WhoHePlayForGame = lazy(() => import('./pages/minigames/WhoHePlayForGame'))
const WhoAmIGame = lazy(() => import('./pages/minigames/WhoAmIGame'))
const NowYouSeeMeGame = lazy(() => import('./pages/minigames/NowYouSeeMeGame'))
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'))
const AdpPage = lazy(() => import('./pages/draft/AdpPage'))
const DraftBoardPage = lazy(() => import('./pages/draft/DraftBoardPage'))
const PreDraftRankingsPage = lazy(() => import('./pages/draft/PreDraftRankingsPage'))
const MockDraftPage = lazy(() => import('./pages/draft/MockDraftPage'))
const MoversPage = lazy(() => import('./pages/draft/MoversPage'))
const LeagueActivity = lazy(() => import('./pages/LeagueActivity'))

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalLoadingBar />
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner />}>
          <MyTeamProvider>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Today />} />
              <Route path="rankings" element={<Rankings />} />
              <Route path="shots" element={<Navigate to="/analytics" replace />} />
              <Route path="teams" element={<Teams />} />
              <Route path="team/:teamId" element={<TeamDetail />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="estimator" element={<Estimator />} />
              <Route path="trade" element={<Trade />} />
              <Route path="players" element={<Players />} />
              <Route path="injuries" element={<Injuries />} />
              <Route path="nba-teams" element={<NbaTeams />} />
              <Route path="schedule" element={<Schedule />} />
              <Route path="player/:playerId" element={<PlayerProfile />} />
              {FF_FEATURE_STORE && <Route path="feature-store" element={<FeatureStore />} />}
              {/* <Route path="trade-suggestions" element={<TradeSuggestions />} /> */}
              <Route path="player-rankings" element={<PlayerRankings />} />
              {FF_PROJECTIONS && <Route path="projections" element={<Projections />} />}
              {FF_DRAFT_REPORT && <Route path="draft-report" element={<DraftReport />} />}
              {FF_DRAFT_PAGES && <Route path="draft/rankings-adp" element={<AdpPage />} />}
              {FF_DRAFT_PAGES && <Route path="draft/adp" element={<Navigate to="/draft/rankings-adp" replace />} />}
              {FF_DRAFT_PAGES && <Route path="draft/board" element={<DraftBoardPage />} />}
              {FF_DRAFT_PAGES && <Route path="draft/rankings" element={<PreDraftRankingsPage />} />}
              {FF_DRAFT_PAGES && <Route path="draft/mock" element={<MockDraftPage />} />}
              {FF_DRAFT_PAGES && <Route path="draft/movers" element={<MoversPage />} />}
              <Route path="trends" element={<Trends />} />
              {FF_LEAGUE_ACTIVITY && <Route path="activity" element={<LeagueActivity />} />}
              <Route path="minigames" element={<Minigames />} />
              <Route path="minigames/hangman" element={<HangmanGame />} />
              <Route path="minigames/who-he-play-for" element={<WhoHePlayForGame />} />
              <Route path="minigames/who-am-i" element={<WhoAmIGame />} />
              <Route path="minigames/now-you-see-me" element={<NowYouSeeMeGame />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </MyTeamProvider>
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

export default App
