import { Routes, Route } from 'react-router'
import Layout from './components/Layout'
import GlobalLoadingBar from './components/GlobalLoadingBar'
import Dashboard from './pages/Dashboard'
import Rankings from './pages/Rankings'
import Shots from './pages/Shots'
import Teams from './pages/Teams'
import TeamDetail from './pages/TeamDetail'
import Analytics from './pages/Analytics'
import Estimator from './pages/Estimator'
import { Trade } from './pages/Trade'
import Players from './pages/Players'
import Injuries from './pages/Injuries'
import NbaTeams from './pages/NbaTeams'
import FeatureStore from './pages/FeatureStore'
import NotFound from './pages/NotFound'
import PlayerRankings from './pages/PlayerRankings'
import Projections from './pages/Projections'
import { FF_PLAYER_RANKINGS, FF_FEATURE_STORE, FF_PROJECTIONS } from './config/featureFlags'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalLoadingBar />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="rankings" element={<Rankings />} />
          <Route path="shots" element={<Shots />} />
          <Route path="teams" element={<Teams />} />
          <Route path="team/:teamId" element={<TeamDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="estimator" element={<Estimator />} />
          <Route path="trade" element={<Trade />} />
          <Route path="players" element={<Players />} />
          <Route path="injuries" element={<Injuries />} />
          <Route path="nba-teams" element={<NbaTeams />} />
          {FF_FEATURE_STORE && <Route path="feature-store" element={<FeatureStore />} />}
          {/* <Route path="trade-suggestions" element={<TradeSuggestions />} /> */}
          {FF_PLAYER_RANKINGS && <Route path="player-rankings" element={<PlayerRankings />} />}
          {FF_PROJECTIONS && <Route path="projections" element={<Projections />} />}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </div>
  )
}

export default App
