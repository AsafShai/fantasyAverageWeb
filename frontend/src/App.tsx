import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Rankings from './pages/Rankings'
import Shots from './pages/Shots'
import TeamDetail from './pages/TeamDetail'
import Analytics from './pages/Analytics'
import { Trade } from './pages/Trade'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="rankings" element={<Rankings />} />
          <Route path="shots" element={<Shots />} />
          <Route path="team/:teamId" element={<TeamDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="trade" element={<Trade />} />
        </Route>
      </Routes>
    </div>
  )
}

export default App
