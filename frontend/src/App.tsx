import { Routes, Route } from 'react-router'
import Layout from './components/Layout'
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
import NotFound from './pages/NotFound'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
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
          {/* <Route path="trade-suggestions" element={<TradeSuggestions />} /> */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </div>
  )
}

export default App
