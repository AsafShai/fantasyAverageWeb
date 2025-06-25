import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Rankings from './pages/Rankings'
import TeamDetail from './pages/TeamDetail'
import Analytics from './pages/Analytics'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="rankings" element={<Rankings />} />
          <Route path="team/:teamName" element={<TeamDetail />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>
      </Routes>
    </div>
  )
}

export default App
