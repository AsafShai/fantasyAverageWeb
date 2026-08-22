import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout'
import GlobalLoadingBar from './components/GlobalLoadingBar'
import LoadingSpinner from './components/LoadingSpinner'
import { FF_PLAYER_RANKINGS, FF_FEATURE_STORE, FF_PROJECTIONS, FF_NAV_REORG, FF_DRAFT_REPORT, FF_TRENDS, FF_MINIGAMES, FF_SCHEDULE } from './config/featureFlags'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Rankings = lazy(() => import('./pages/Rankings'))
const Shots = lazy(() => import('./pages/Shots'))
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

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalLoadingBar />
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="rankings" element={<Rankings />} />
            {FF_NAV_REORG ? (
              <Route path="shots" element={<Navigate to="/analytics" replace />} />
            ) : (
              <Route path="shots" element={<Shots />} />
            )}
            <Route path="teams" element={<Teams />} />
            <Route path="team/:teamId" element={<TeamDetail />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="estimator" element={<Estimator />} />
            <Route path="trade" element={<Trade />} />
            <Route path="players" element={<Players />} />
            <Route path="injuries" element={<Injuries />} />
            <Route path="nba-teams" element={<NbaTeams />} />
            {FF_SCHEDULE && <Route path="schedule" element={<Schedule />} />}
            <Route path="player/:playerId" element={<PlayerProfile />} />
            {FF_FEATURE_STORE && <Route path="feature-store" element={<FeatureStore />} />}
            {/* <Route path="trade-suggestions" element={<TradeSuggestions />} /> */}
            {FF_PLAYER_RANKINGS && <Route path="player-rankings" element={<PlayerRankings />} />}
            {FF_PROJECTIONS && <Route path="projections" element={<Projections />} />}
            {FF_DRAFT_REPORT && <Route path="draft-report" element={<DraftReport />} />}
            <Route path="draft/adp" element={<AdpPage />} />
            <Route path="draft/board" element={<DraftBoardPage />} />
            <Route path="draft/rankings" element={<PreDraftRankingsPage />} />
            {FF_TRENDS && <Route path="trends" element={<Trends />} />}
            {FF_MINIGAMES && <Route path="minigames" element={<Minigames />} />}
            {FF_MINIGAMES && <Route path="minigames/hangman" element={<HangmanGame />} />}
            {FF_MINIGAMES && <Route path="minigames/who-he-play-for" element={<WhoHePlayForGame />} />}
            {FF_MINIGAMES && <Route path="minigames/who-am-i" element={<WhoAmIGame />} />}
            {FF_MINIGAMES && <Route path="minigames/now-you-see-me" element={<NowYouSeeMeGame />} />}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </div>
  )
}

export default App
